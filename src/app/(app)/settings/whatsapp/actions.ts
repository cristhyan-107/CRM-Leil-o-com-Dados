'use server';

import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  EvolutionApiError,
  getEvolutionInstanceStatus,
  getEvolutionQRCode,
  logoutEvolutionInstance,
  updateEvolutionWebhook,
  getEvolutionChats,
  getEvolutionContacts,
  getEvolutionMessages,
  sendEvolutionMessage,
  extractMessageText,
  getEvolutionUrl,
  jidToPhone,
  type EvolutionChat,
  type EvolutionContact,
  type EvolutionMessage,
} from '@/lib/evolution';

// ============================================================
// Helpers de instância
// ============================================================

/**
 * Retorna o nome da instância derivado do userId logado.
 * NÃO usar diretamente — pode não corresponder à instância real conectada.
 * Usar getActiveInstanceName() em vez disso.
 */
async function getInstanceName() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  return `crm_${user.id.replace(/-/g, '')}`;
}

/**
 * Retorna o instance_name real conectado, na seguinte ordem de prioridade:
 * 1. Se remoteJid for passado: busca em whatsapp_chats pelo remoteJid (mais recente)
 * 2. Registro mais recente em whatsapp_chats (instância ativa do sistema)
 * 3. Única instância open da Evolution API
 * 4. Fallback: derivar do userId (legado — pode falhar em multi-tenant)
 */
export type InstanceResolutionSource = 'database' | 'env' | 'fallback';

export type InstanceResolution = {
  resolvedInstanceName: string;
  source: InstanceResolutionSource;
  warning?: string;
};

async function evolutionInstanceExists(instanceName: string): Promise<boolean> {
  const status = await getEvolutionInstanceStatus(instanceName);
  const state = status?.instance?.state || status?.state || status?.status;
  return Boolean(state && !['not_found', 'NOT_FOUND'].includes(String(state)));
}

async function warnInvalidEnvInstanceIfNeeded(realInstanceName: string) {
  const envInstance = process.env.EVOLUTION_INSTANCE_NAME;
  if (!envInstance || envInstance === realInstanceName) return;

  const exists = await evolutionInstanceExists(envInstance);
  if (!exists) {
    console.warn(
      `EVOLUTION_INSTANCE_NAME aponta para uma instância inexistente: ${envInstance}. ` +
      `Usando instância real encontrada no banco: ${realInstanceName}.`
    );
  }
}

export async function resolveWhatsAppInstance(remoteJid?: string): Promise<InstanceResolution> {
  const admin = createAdminClient();
  const fallback = await getInstanceName();
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // 1. Por remoteJid específico
  if (remoteJid) {
    const { data: rows } = await admin
      .from('whatsapp_chats')
      .select('instance_name')
      .eq('remote_jid', remoteJid)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (rows?.[0]?.instance_name) {
      console.log(`[instance] ✅ via remoteJid (${remoteJid}):`, rows[0].instance_name);
      const resolution = { resolvedInstanceName: rows[0].instance_name, source: 'database' as const };
      console.log('[instance] resolved', { ...resolution, remoteJid });
      return resolution;
    }
  }

  // 2. Registro explicito da instancia do usuario, se a tabela existir
  if (user) {
    const { data: crmInstance, error } = await admin
      .from('whatsapp_instances')
      .select('instance_name, status, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && crmInstance?.instance_name) {
      await warnInvalidEnvInstanceIfNeeded(crmInstance.instance_name);
      const resolution = { resolvedInstanceName: crmInstance.instance_name, source: 'database' as const };
      console.log('[instance] resolved', resolution);
      return resolution;
    }

    if (error && error.code !== '42P01') {
      console.warn('[instance] whatsapp_instances lookup failed:', error.message);
    }

    const { data: latestUserChat, error: chatError } = await admin
      .from('whatsapp_chats')
      .select('instance_name')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!chatError && latestUserChat?.instance_name) {
      await warnInvalidEnvInstanceIfNeeded(latestUserChat.instance_name);
      const resolution = {
        resolvedInstanceName: latestUserChat.instance_name,
        source: 'database' as const,
      };
      console.log('[instance] resolved', resolution);
      return resolution;
    }

    if (chatError && chatError.code !== '42P01') {
      console.warn('[instance] whatsapp_chats lookup failed:', chatError.message);
    }
  }

  // 3. Variavel de ambiente configurada para a instancia real da Evolution
  if (process.env.EVOLUTION_INSTANCE_NAME) {
    const envInstance = process.env.EVOLUTION_INSTANCE_NAME;
    const exists = await evolutionInstanceExists(envInstance);
    if (!exists) {
      console.warn(
        `[instance] EVOLUTION_INSTANCE_NAME aponta para uma instância inexistente: ${envInstance}.`
      );
    } else {
      const resolution = {
        resolvedInstanceName: envInstance,
        source: 'env' as const,
      };
      console.log('[instance] resolved', resolution);
      return resolution;
    }
  }

  /*
   * Intentionally do not fall back to the latest global whatsapp_chats row.
   * That can cross users and can override an invalid EVOLUTION_INSTANCE_NAME
   * with another account's instance.
   */
  if (false) return { resolvedInstanceName: fallback, source: 'fallback' as const };

  // 4. Registro mais recente no banco
  const { data: latest } = await admin
    .from('whatsapp_chats')
    .select('instance_name')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (false && latest?.[0]?.instance_name) {
    // @ts-ignore legacy branch disabled by instance resolution priority.
    console.log('[instance] ✅ via whatsapp_chats mais recente:', latest[0].instance_name);
    return { resolvedInstanceName: latest?.[0]?.instance_name || fallback, source: 'database' as const };
  }

  // 5. Fallback: userId (legado)
  console.warn('[instance] ⚠️ fallback userId (banco vazio):', fallback);
  return { resolvedInstanceName: fallback, source: 'fallback' as const };
}

export async function getActiveInstanceName(remoteJid?: string): Promise<string> {
  const resolution = await resolveWhatsAppInstance(remoteJid);
  return resolution.resolvedInstanceName;
}


// ============================================================
// Status
// ============================================================

export async function checkWhatsAppStatus() {
  try {
    const instanceName = await getActiveInstanceName();
    const status = await getEvolutionInstanceStatus(instanceName);
    const state = status?.instance?.state || status?.state || 'close';
    return { success: true, state, instanceName };
  } catch (error: any) {
    return { success: false, state: 'error', error: error.message };
  }
}

// ============================================================
// Connect / Disconnect
// ============================================================

export async function connectWhatsApp() {
  try {
    const instanceName = await getActiveInstanceName();
    const qrData = await getEvolutionQRCode(instanceName);

    if (qrData.alreadyConnected) {
      return { success: true, alreadyConnected: true };
    }

    return { success: true, qr: qrData.base64 || qrData.qrcode };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function disconnectWhatsApp() {
  try {
    const instanceName = await getActiveInstanceName();
    await logoutEvolutionInstance(instanceName);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// Webhook — atualizar URL para Vercel
// ============================================================

export async function updateWebhookUrl() {
  try {
    const instanceName = await getActiveInstanceName();
    await updateEvolutionWebhook(instanceName);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// FASE 3 — Carga inicial: sync de chats/mensagens
// ============================================================

function logSync(step: string, data: Record<string, unknown> = {}) {
  console.log(`[whatsapp-sync] ${step}`, data);
}

function logSyncError(step: string, error: unknown, data: Record<string, unknown> = {}) {
  console.error(`[whatsapp-sync] ${step}`, data);
  console.error(error);
  if (error instanceof Error && error.stack) console.error(error.stack);
}

function getChatDisplayName(chat: EvolutionChat) {
  const phone = jidToPhone(chat.remoteJid);
  return chat.pushName || phone || chat.remoteJid;
}

function chatToRow(userId: string, instanceName: string, chat: EvolutionChat) {
  const lastMsgText = extractMessageText(chat.lastMessage?.message);
  const lastMsgAt = chat.lastMessage?.messageTimestamp
    ? new Date(chat.lastMessage.messageTimestamp * 1000).toISOString()
    : chat.updatedAt || new Date().toISOString();
  const phone = jidToPhone(chat.remoteJid);

  return {
    user_id: userId,
    instance_name: instanceName,
    remote_jid: chat.remoteJid,
    push_name: getChatDisplayName(chat),
    profile_pic_url: chat.profilePicUrl || null,
    last_message: lastMsgText || null,
    last_message_at: lastMsgAt,
    unread_count: chat.unreadCount || 0,
    is_group: chat.remoteJid.endsWith('@g.us'),
    updated_at: new Date().toISOString(),
  };
}

function contactToRow(userId: string, instanceName: string, contact: EvolutionContact) {
  const phone = contact.phoneNumber || jidToPhone(contact.remoteJid);
  const name = contact.displayName || contact.pushName || contact.verifiedName || phone;

  return {
    user_id: userId,
    instance_name: instanceName,
    remote_jid: contact.remoteJid,
    phone_number: phone,
    display_name: name,
    push_name: contact.pushName || null,
    verified_name: contact.verifiedName || null,
    profile_pic_url: contact.profilePicUrl || null,
    is_business: contact.isBusiness || false,
    is_group: contact.isGroup || contact.remoteJid.endsWith('@g.us'),
    raw_payload: contact.raw || contact,
    updated_at: new Date().toISOString(),
  };
}

function messageToRow(
  userId: string,
  instanceName: string,
  msg: EvolutionMessage,
  fallbackRemoteJid?: string
) {
  const remoteJid = msg.key?.remoteJid || fallbackRemoteJid || '';
  const messageId =
    msg.key?.id ||
    `fallback_${remoteJid}_${msg.messageTimestamp || Date.now()}_${msg.key?.fromMe ? 'out' : 'in'}`;
  const content = extractMessageText(msg.message);
  const sentAt = msg.messageTimestamp
    ? new Date(msg.messageTimestamp * 1000).toISOString()
    : new Date().toISOString();

  return {
    user_id: userId,
    instance_name: instanceName,
    message_key: messageId,
    remote_jid: remoteJid,
    from_me: msg.key?.fromMe ?? false,
    push_name: msg.pushName || null,
    message_type: msg.messageType || 'conversation',
    content,
    sent_at: sentAt,
    created_at: sentAt,
    status: normalizeStatus(msg.status),
    raw_payload: msg as any,
    message_id: messageId,
    phone_normalized: jidToPhone(remoteJid),
    direction: msg.key?.fromMe ? 'outbound' : 'inbound',
    provider: 'evolution',
  };
}

async function saveSyncError(instanceName: string, errorMessage: string) {
  const admin = createAdminClient();
  await admin
    .from('whatsapp_instances')
    .update({
      sync_status: 'error',
      sync_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('instance_name', instanceName)
    .then(({ error }) => {
      if (error && error.code !== '42P01') {
        console.warn('[whatsapp-sync] failed to persist sync_error:', error.message);
      }
    });
}

async function saveChatRows(admin: ReturnType<typeof createAdminClient>, rows: ReturnType<typeof chatToRow>[]) {
  if (!rows.length) return 0;

  const { error, data } = await admin
    .from('whatsapp_chats')
    .upsert(rows, { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false })
    .select('id');

  if (!error) return data?.length || rows.length;

  const missingConflict =
    error.message?.includes('no unique or exclusion constraint') ||
    error.code === '42P10';

  if (!missingConflict) throw error;

  logSync('chat upsert fallback - unique constraint unavailable', { rows: rows.length });

  let saved = 0;
  for (const row of rows) {
    const { data: existing, error: lookupError } = await admin
      .from('whatsapp_chats')
      .select('id')
      .eq('user_id', row.user_id)
      .eq('instance_name', row.instance_name)
      .eq('remote_jid', row.remote_jid)
      .limit(1)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing?.id) {
      const { error: updateError } = await admin
        .from('whatsapp_chats')
        .update(row)
        .eq('id', existing.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await admin
        .from('whatsapp_chats')
        .insert(row);
      if (insertError) throw insertError;
    }
    saved += 1;
  }

  return saved;
}

async function saveMessageRows(admin: ReturnType<typeof createAdminClient>, rows: ReturnType<typeof messageToRow>[]) {
  if (!rows.length) return 0;

  const { error, data } = await admin
    .from('whatsapp_messages')
    .upsert(rows, { onConflict: 'user_id,instance_name,remote_jid,message_id', ignoreDuplicates: false })
    .select('id');

  if (!error) return data?.length || rows.length;

  const missingConflict =
    error.message?.includes('no unique or exclusion constraint') ||
    error.code === '42P10';

  if (!missingConflict) throw error;

  logSync('message upsert fallback - unique constraint unavailable', { rows: rows.length });

  let saved = 0;
  for (const row of rows) {
    const { data: existing, error: lookupError } = await admin
      .from('whatsapp_messages')
      .select('id')
      .eq('user_id', row.user_id)
      .eq('instance_name', row.instance_name)
      .eq('remote_jid', row.remote_jid)
      .eq('message_id', row.message_id)
      .limit(1)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing?.id) {
      const { error: updateError } = await admin
        .from('whatsapp_messages')
        .update(row)
        .eq('id', existing.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await admin
        .from('whatsapp_messages')
        .insert(row);
      if (insertError) throw insertError;
    }
    saved += 1;
  }

  return saved;
}

async function saveContactRows(admin: ReturnType<typeof createAdminClient>, rows: ReturnType<typeof contactToRow>[]) {
  if (!rows.length) return 0;

  const { error, data } = await admin
    .from('whatsapp_contacts')
    .upsert(rows, { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false })
    .select('id');

  if (!error) return data?.length || rows.length;
  if (error.code === '42P01' || error.code === 'PGRST205') {
    logSync('contacts skipped - whatsapp_contacts unavailable', { message: error.message });
    return 0;
  }

  const missingConflict =
    error.message?.includes('no unique or exclusion constraint') ||
    error.code === '42P10';

  if (!missingConflict) throw error;

  logSync('contact upsert fallback - unique constraint unavailable', { rows: rows.length });

  let saved = 0;
  for (const row of rows) {
    const { data: existing, error: lookupError } = await admin
      .from('whatsapp_contacts')
      .select('id')
      .eq('user_id', row.user_id)
      .eq('instance_name', row.instance_name)
      .eq('remote_jid', row.remote_jid)
      .limit(1)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing?.id) {
      const { error: updateError } = await admin
        .from('whatsapp_contacts')
        .update(row)
        .eq('id', existing.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await admin
        .from('whatsapp_contacts')
        .insert(row);
      if (insertError) throw insertError;
    }
    saved += 1;
  }

  return saved;
}

export async function syncWhatsAppChats(): Promise<{
  success: boolean;
  count?: number;
  status?: 'completed' | 'partial' | 'error';
  summary?: {
    resolvedInstanceName: string;
    instanceNameSource: InstanceResolutionSource;
    chatsFound: number;
    chatsImported: number;
    contactsImported: number;
    messagesImported: number;
    savedChatsFound: number;
    duplicatesSkipped: number;
  };
  stage?: string;
  instanceName?: string;
  statusCode?: number;
  details?: string;
  error?: string;
}> {
  let instanceName = '';
  let instanceNameSource: InstanceResolutionSource = 'fallback';
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Unauthorized' };

    const resolution = await resolveWhatsAppInstance();
    instanceName = resolution.resolvedInstanceName;
    instanceNameSource = resolution.source;
    const admin = createAdminClient();
    const userId = user.id;

    logSync('start', {
      userId,
      resolvedInstanceName: instanceName,
      source: instanceNameSource,
      chatsUrl: getEvolutionUrl(`/chat/findChats/${instanceName}`),
      contactsUrl: getEvolutionUrl(`/chat/findContacts/${instanceName}`),
      messagesUrl: getEvolutionUrl(`/chat/findMessages/${instanceName}`),
    });

    const status = await getEvolutionInstanceStatus(instanceName);
    const state = status?.instance?.state || status?.state || status?.status;
    logSync('instance status', { instanceName, state });

    const chats = await getEvolutionChats(instanceName);
    logSync('chats fetched', { count: chats.length });

    const contacts = await getEvolutionContacts(instanceName).catch((err) => {
      logSyncError('contacts fetch failed - continuing partial sync', err, { instanceName });
      return [] as EvolutionContact[];
    });
    logSync('contacts fetched', { count: contacts.length });

    const chatRows = chats.map((chat) => chatToRow(userId, instanceName, chat));
    const chatsImported = await saveChatRows(admin, chatRows);
    logSync('chats saved', { count: chatsImported });

    const contactRows = contacts.map((contact) => contactToRow(userId, instanceName, contact));
    const contactsImported = await saveContactRows(admin, contactRows);
    logSync('contacts saved', { count: contactsImported });

    const messageRows: any[] = [];
    for (const chat of chats.slice(0, 50)) {
      const messages = await getEvolutionMessages(instanceName, chat.remoteJid, 20).catch((err) => {
        logSyncError('messages fetch failed for chat - continuing', err, {
          instanceName,
          remoteJid: chat.remoteJid,
        });
        return [] as EvolutionMessage[];
      });
      logSync('messages fetched for chat', { remoteJid: chat.remoteJid, count: messages.length });
      messageRows.push(
        ...messages
          .map((msg) => messageToRow(userId, instanceName, msg, chat.remoteJid))
          .filter((row) => row.remote_jid && row.message_key)
      );
    }

    let messagesImported = 0;
    if (messageRows.length) {
      messagesImported = await saveMessageRows(admin, messageRows);
    }
    logSync('messages saved', { count: messagesImported });

    for (const row of messageRows) {
      await admin
        .from('whatsapp_chats')
        .update({
          last_message: row.content || row.caption || null,
          last_message_at: row.sent_at,
          updated_at: new Date().toISOString(),
        })
        .eq('instance_name', instanceName)
        .eq('remote_jid', row.remote_jid);
    }

    await admin.from('whatsapp_instances').upsert(
      {
        user_id: userId,
        instance_name: instanceName,
        status: String(state || 'open'),
        last_sync_at: new Date().toISOString(),
        sync_status: 'completed',
        sync_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,instance_name', ignoreDuplicates: false }
    ).then(({ error }) => {
      if (error && error.code !== '42P01') {
        console.warn('[whatsapp-sync] failed to update whatsapp_instances:', error.message);
      }
    });

    const { data: savedChats, error: savedChatsError } = await admin
      .from('whatsapp_chats')
      .select('id')
      .eq('instance_name', instanceName)
      .limit(1000);
    if (savedChatsError) throw savedChatsError;

    const summary = {
      resolvedInstanceName: instanceName,
      instanceNameSource,
      chatsFound: chats.length,
      chatsImported,
      contactsImported,
      messagesImported,
      savedChatsFound: savedChats?.length || 0,
      duplicatesSkipped: Math.max(0, messageRows.length - messagesImported),
    };

    logSync('completed', { instanceName, ...summary });
    return { success: true, status: 'completed', count: chatsImported, summary };
  } catch (error: any) {
    const message = error?.message || 'Erro desconhecido na sincronizacao';
    logSyncError('failed', error, { instanceName });
    if (instanceName) await saveSyncError(instanceName, message);
    return {
      success: false,
      status: 'error',
      stage: 'sync',
      instanceName,
      statusCode: typeof error?.status === 'number' ? error.status : undefined,
      error: 'Erro na sincronização. Verifique os detalhes nos logs do servidor.',
      details: message,
    };
  }
}

// ============================================================
// Inbox — listar conversas (de whatsapp_chats, já sincronizado)
// ============================================================

export async function syncMessagesForChat(
  instanceName: string,
  remoteJid: string,
  options: {
    limit: number;
    page?: number;
    cursor?: string;
    direction?: 'older' | 'newer';
    userId?: string;
  }
) {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(options.limit || 50, 1), 200);
  const userId = options.userId || await (await createServerSupabase()).auth.getUser()
    .then(({ data }) => data.user?.id);

  if (!userId) throw new Error('Unauthorized');

  try {
    const messages = await getEvolutionMessages(instanceName, remoteJid, limit);
    const rows = messages
      .map((msg) => messageToRow(userId, instanceName, msg, remoteJid))
      .filter((row) => row.remote_jid && row.message_id);

    const imported = await saveMessageRows(admin, rows);
    logSync('chat messages synced', {
      instanceName,
      remoteJid,
      requestedLimit: limit,
      found: messages.length,
      imported,
      page: options.page,
      cursor: options.cursor,
      direction: options.direction,
    });

    return { success: true, remoteJid, found: messages.length, imported };
  } catch (error: any) {
    logSyncError('chat messages sync failed', error, { instanceName, remoteJid });
    return {
      success: false,
      remoteJid,
      imported: 0,
      error: error?.message || 'Erro ao sincronizar mensagens da conversa',
    };
  }
}

export async function syncRecentMessagesForAllChats(instanceName?: string) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const resolved = instanceName || (await getActiveInstanceName());
  const admin = createAdminClient();
  const { data: chats, error } = await admin
    .from('whatsapp_chats')
    .select('remote_jid')
    .eq('user_id', user.id)
    .eq('instance_name', resolved)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(10);

  if (error) throw error;

  let imported = 0;
  const errors: Array<{ remoteJid: string; error: string }> = [];

  for (const chat of chats || []) {
    const result = await syncMessagesForChat(resolved, chat.remote_jid, {
      limit: 50,
      userId: user.id,
    });
    if (result.success) {
      imported += result.imported;
    } else {
      errors.push({ remoteJid: chat.remote_jid, error: result.error || 'Erro desconhecido' });
    }
  }

  return {
    success: errors.length === 0,
    instanceName: resolved,
    chatsProcessed: chats?.length || 0,
    messagesImported: imported,
    errors,
  };
}

export async function getInboxContacts(): Promise<any[]> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const instanceName = await getActiveInstanceName();

    const { data, error } = await createAdminClient()
      .from('whatsapp_chats')
      .select('*')
      .eq('instance_name', instanceName)
      .eq('is_group', false)
      .order('last_message_at', { ascending: false })
      .limit(100);

    if (error || !data) return [];


    // Mapear para formato esperado pelo ChatInterface
    return data.map((chat) => ({
      id: chat.id,
      phone: jidToPhone(chat.remote_jid),
      remoteJid: chat.remote_jid,
      name: chat.push_name || jidToPhone(chat.remote_jid),
      lastMessage: chat.last_message || '',
      timestamp: chat.last_message_at || chat.updated_at,
      unreadCount: chat.unread_count || 0,
      profilePicUrl: chat.profile_pic_url || null,
      isLead: false, // TODO: cross-reference with leads table
    }));
  } catch (error: any) {
    console.error('[getInboxContacts]', error.message);
    return [];
  }
}

// ============================================================
// Histórico de mensagens de uma conversa
// ============================================================

export async function getChatHistory(remoteJid: string): Promise<any[]> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    // Busca a instância real da conversa (corrige bug de user_id diferente do dono da instância)
    const instanceName = await getActiveInstanceName(remoteJid);

    // Isso evita o bug onde mensagens inbound chegam sem user_id correto via webhook
    const adminClient = createAdminClient();
    const { data: cached } = await adminClient
      .from('whatsapp_messages')
      .select('*')
      .eq('instance_name', instanceName)
      .eq('remote_jid', remoteJid)
      .order('sent_at', { ascending: true, nullsFirst: false })
      .limit(150);

    if (cached && cached.length > 0) {
      return cached.map(normalizeMessage);
    }

    // Fallback: buscar direto da Evolution e persistir
    const evMsgs = await getEvolutionMessages(instanceName, remoteJid, 50);
    if (!evMsgs.length) return [];

    const rows = evMsgs.map((msg: EvolutionMessage) => ({
      user_id: user.id,
      instance_name: instanceName,
      message_key: msg.key.id,
      remote_jid: remoteJid,
      from_me: msg.key.fromMe ?? false,
      push_name: msg.pushName || null,
      message_type: msg.messageType || 'conversation',
      content: extractMessageText(msg.message),
      status: normalizeStatus(msg.status),
      sent_at: msg.messageTimestamp
        ? new Date(msg.messageTimestamp * 1000).toISOString()
        : null,
      created_at: msg.messageTimestamp
        ? new Date(msg.messageTimestamp * 1000).toISOString()
        : new Date().toISOString(),
      raw_payload: msg as any,
      message_id: msg.key.id,
      phone_normalized: jidToPhone(remoteJid),
      direction: msg.key.fromMe ? 'outbound' : 'inbound',
      provider: 'evolution',
    }));

    // Persiste sem lançar erro se já existir (ignoreDuplicates)
    await adminClient
      .from('whatsapp_messages')
      .upsert(rows, { onConflict: 'user_id,instance_name,remote_jid,message_id', ignoreDuplicates: true });

    return rows.map(normalizeMessage);
  } catch (error: any) {
    console.error('[getChatHistory]', error.message);
    return [];
  }
}

// ============================================================
// Marcar conversa como lida
// ============================================================

export async function markChatAsRead(remoteJid: string) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const instanceName = await getActiveInstanceName(remoteJid);

    await supabase
      .from('whatsapp_messages')
      .update({ status: 'read' })
      .eq('user_id', user.id)
      .eq('instance_name', instanceName)
      .eq('remote_jid', remoteJid)
      .eq('from_me', false)
      .neq('status', 'read');

    // Zerar unread_count no chat
    await supabase
      .from('whatsapp_chats')
      .update({ unread_count: 0 })
      .eq('user_id', user.id)
      .eq('instance_name', instanceName)
      .eq('remote_jid', remoteJid);
  } catch (error: any) {
    console.error('[markChatAsRead]', error.message);
  }
}

// ============================================================
// Enviar mensagem
// ============================================================

// Converte QUALQUER valor capturado em string legível e serializável pelo Next.js.
// Regra crítica: JSON.stringify(new Error("x")) === "{}" — nunca usar JSON.stringify em Error diretamente.
function safeStr(e: unknown, fallback = 'Erro desconhecido no envio'): string {
  if (!e) return fallback;
  if (typeof e === 'string') return e.trim() || fallback;
  // Error padrão: usar name + message
  if (e instanceof Error) {
    return [e.name !== 'Error' ? e.name : '', e.message].filter(Boolean).join(': ') || fallback;
  }
  // Objeto com campos comuns
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const msg =
      (typeof o.message === 'string' ? o.message : '') ||
      (typeof o.error === 'string' ? o.error : '') ||
      (typeof o.code === 'string' ? o.code : '') ||
      (typeof o.details === 'string' ? o.details : '');
    if (msg) return msg;
    try { return JSON.stringify(e); } catch { return fallback; }
  }
  return String(e) || fallback;
}

export async function sendChatMessage(
  remoteJid: string,
  content: string
): Promise<{
  success: boolean;
  messageKey?: string;
  error?: string;
  details?: Record<string, string | number | null>;
}> {
  const diagnostics: Record<string, string | number | null> = {
    remoteJid,
    instanceName: null,
    phone: null,
    endpoint: null,
    httpStatus: null,
    responseBody: null,
  };

  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Usuário não autenticado' };

    // CORREÇÃO: buscar instance_name real do banco via remoteJid.
    // getInstanceName() usa o user_id do usuário LOGADO, que pode diferir
    // do usuário que conectou o WhatsApp — causando 404 na Evolution API.
    // Se houver mais de um registro para o mesmo remoteJid, usa o mais recente.
    const adminClient = createAdminClient();
    let instanceName: string;

    const { data: chatRows } = await adminClient
      .from('whatsapp_chats')
      .select('instance_name, updated_at')
      .eq('remote_jid', remoteJid)
      .order('updated_at', { ascending: false })
      .limit(1);

    const chatRow = chatRows?.[0];

    if (chatRow?.instance_name) {
      instanceName = chatRow.instance_name;
      console.log('[sendChatMessage] ✅ instance_name do banco:', instanceName);
    } else {
      // Fallback: remoteJid ainda não tem chat no banco (nova conversa)
      instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;
      console.log('[sendChatMessage] ⚠️  instance_name fallback (userId — remoteJid não encontrado no banco):', instanceName);
    }


    const phone = jidToPhone(remoteJid);
    const endpoint = `/message/sendText/${instanceName}`;

    diagnostics.instanceName = instanceName;
    diagnostics.phone = phone;
    diagnostics.endpoint = endpoint;

    console.log('[sendChatMessage] iniciando envio', {
      instanceName,
      phone,
      remoteJid,
      endpoint,
      contentLen: content.length,
    });


    console.log('\n=== [ENVIO TEMPORÁRIO] Iniciando Envio ===');
    console.log(`Instância a ser usada: ${instanceName}`);
    console.log(`RemoteJid destino: ${remoteJid}`);
    console.log(`Endpoint esperado: ${endpoint}`);

    // Enviar via Evolution API
    let sendRes: any;
    try {
      sendRes = await sendEvolutionMessage(instanceName, phone, content);
      console.log(`[ENVIO TEMPORÁRIO] Sucesso na chamada à Evolution API.`);
      console.log('==========================================\n');
    } catch (apiErr: unknown) {
      const errMsg = safeStr(apiErr);
      console.error('\n[ENVIO TEMPORÁRIO] ERRO na Evolution API:');
      console.error(`Status ou Mensagem: ${errMsg}`);
      console.error('==========================================\n');
      
      diagnostics.error = errMsg;
      let userFriendlyError = errMsg;
      if (errMsg.includes('404') || errMsg.includes('not exist')) {
          userFriendlyError = 'Instância não encontrada (404). Verifique se o WhatsApp está conectado e se o nome da instância está correto na Evolution API.';
      } else if (errMsg.includes('401') || errMsg.includes('403')) {
          userFriendlyError = 'Não autorizado (401/403). Verifique a EVOLUTION_API_KEY no arquivo .env.local.';
      } else if (errMsg.includes('fetch')) {
          userFriendlyError = 'Falha de rede. O CRM não conseguiu se conectar à Evolution API.';
      }

      return { success: false, error: userFriendlyError, details: diagnostics };
    }

    // Persistir no Supabase
    const msgKey = sendRes?.key?.id || `local_${Date.now()}`;
    const { error: dbErr } = await supabase.from('whatsapp_messages').insert({
      user_id: user.id,
      instance_name: instanceName,
      message_key: msgKey,
      remote_jid: remoteJid,
      from_me: true,
      message_type: 'conversation',
      content,
      status: 'sent',
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      message_id: msgKey,
      phone_normalized: phone,
      direction: 'outbound',
      provider: 'evolution',
    });

    if (dbErr) {
      // Erro no DB não impede o sucesso do envio (já foi enviado no WhatsApp)
      console.warn('[sendChatMessage] DB insert warn:', dbErr.message);
    }

    // Atualizar last_message no chat (best-effort, não bloqueia)
    supabase.from('whatsapp_chats').update({
      last_message: content,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
      .eq('instance_name', instanceName)
      .eq('remote_jid', remoteJid)
      .then(() => {});

    return { success: true, messageKey: msgKey };

  } catch (error: unknown) {
    const errMsg = safeStr(error);
    console.error('[sendChatMessage] ERRO INESPERADO (object):', error);
    console.error('[sendChatMessage] ERRO INESPERADO (string):', errMsg);
    diagnostics.error = errMsg;
    return { success: false, error: errMsg, details: diagnostics };
  }
}


// ============================================================
// Iniciar nova conversa com qualquer número
// ============================================================

export async function startNewConversation(
  phone: string
): Promise<{ success: boolean; remoteJid?: string; error?: string }> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Unauthorized' };

    const instanceName = await getActiveInstanceName();

    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8) return { success: false, error: 'Número inválido' };
    const fullNumber = digits.startsWith('55') ? digits : `55${digits}`;
    const remoteJid = `${fullNumber}@s.whatsapp.net`;

    // Garantir que o chat existe na tabela para aparecer no inbox
    await supabase.from('whatsapp_chats').upsert(
      {
        user_id: user.id,
        instance_name: instanceName,
        remote_jid: remoteJid,
        push_name: phone,
        is_group: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: true }
    );

    return { success: true, remoteJid };
  } catch (error: any) {
    console.error('[startNewConversation]', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================
// Helpers internos
// ============================================================

function normalizeMessage(msg: any) {
  return {
    id: msg.id || msg.message_key,
    message_id: msg.message_key || msg.message_id,
    content: msg.content || '',
    direction: msg.from_me ? 'outbound' : (msg.direction || 'inbound'),
    status: msg.status || 'sent',
    created_at: msg.created_at || msg.sent_at || new Date().toISOString(),
    push_name: msg.push_name,
    remote_jid: msg.remote_jid,
  };
}

function normalizeStatus(evStatus?: string): string {
  const map: Record<string, string> = {
    DELIVERY_ACK: 'delivered',
    READ: 'read',
    PLAYED: 'read',
    ERROR: 'failed',
    PENDING: 'pending',
    SERVER_ACK: 'sent',
  };
  return (evStatus && map[evStatus]) || 'sent';
}
