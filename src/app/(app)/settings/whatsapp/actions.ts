'use server';

import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
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
export async function getActiveInstanceName(remoteJid?: string): Promise<string> {
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
      return rows[0].instance_name;
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
      console.log('[instance] via whatsapp_instances:', crmInstance.instance_name);
      return crmInstance.instance_name;
    }

    if (error && error.code !== '42P01') {
      console.warn('[instance] whatsapp_instances lookup failed:', error.message);
    }
  }

  // 3. Variavel de ambiente configurada para a instancia real da Evolution
  if (process.env.EVOLUTION_INSTANCE_NAME) {
    console.log('[instance] via EVOLUTION_INSTANCE_NAME');
    return process.env.EVOLUTION_INSTANCE_NAME;
  }

  // 4. Registro mais recente no banco
  const { data: latest } = await admin
    .from('whatsapp_chats')
    .select('instance_name')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (latest?.[0]?.instance_name) {
    console.log('[instance] ✅ via whatsapp_chats mais recente:', latest[0].instance_name);
    return latest[0].instance_name;
  }

  // 5. Fallback: userId (legado)
  console.warn('[instance] ⚠️ fallback userId (banco vazio):', fallback);
  return fallback;
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
    phone_number: phone,
    push_name: getChatDisplayName(chat),
    chat_name: getChatDisplayName(chat),
    profile_pic_url: chat.profilePicUrl || null,
    last_message: lastMsgText || null,
    last_message_text: lastMsgText || null,
    last_message_at: lastMsgAt,
    unread_count: chat.unreadCount || 0,
    is_group: chat.remoteJid.endsWith('@g.us'),
    raw_payload: chat as any,
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
    sender_jid: msg.key?.participant || (msg.key?.fromMe ? null : remoteJid),
    sender_name: msg.pushName || null,
    push_name: msg.pushName || null,
    message_type: msg.messageType || 'conversation',
    text: content || null,
    caption: msg.message?.imageMessage?.caption || msg.message?.documentMessage?.title || null,
    content,
    has_media: Boolean(msg.message?.imageMessage || msg.message?.audioMessage || msg.message?.documentMessage),
    message_timestamp: sentAt,
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

export async function syncWhatsAppChats(): Promise<{
  success: boolean;
  count?: number;
  status?: 'completed' | 'partial' | 'error';
  summary?: {
    chatsImported: number;
    contactsImported: number;
    messagesImported: number;
    duplicatesSkipped: number;
  };
  error?: string;
}> {
  let instanceName = '';
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Unauthorized' };

    instanceName = await getActiveInstanceName();
    const admin = createAdminClient();
    const userId = user.id;

    logSync('start', {
      userId,
      instanceName,
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
    let chatsImported = 0;
    if (chatRows.length) {
      const { error, data } = await admin
        .from('whatsapp_chats')
        .upsert(chatRows, { onConflict: 'instance_name,remote_jid', ignoreDuplicates: false })
        .select('id');
      if (error) throw error;
      chatsImported = data?.length || chatRows.length;
    }
    logSync('chats saved', { count: chatsImported });

    const contactRows = contacts.map((contact) => contactToRow(userId, instanceName, contact));
    let contactsImported = 0;
    if (contactRows.length) {
      const { error, data } = await admin
        .from('whatsapp_contacts')
        .upsert(contactRows, { onConflict: 'instance_name,remote_jid', ignoreDuplicates: false })
        .select('id');
      if (error) throw error;
      contactsImported = data?.length || contactRows.length;
    }
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
      const { error, data } = await admin
        .from('whatsapp_messages')
        .upsert(messageRows, { onConflict: 'instance_name,remote_jid,message_id', ignoreDuplicates: false })
        .select('id');
      if (error) throw error;
      messagesImported = data?.length || messageRows.length;
    }
    logSync('messages saved', { count: messagesImported });

    for (const row of messageRows) {
      await admin
        .from('whatsapp_chats')
        .update({
          last_message: row.content || row.caption || null,
          last_message_text: row.content || row.caption || null,
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
      { onConflict: 'instance_name', ignoreDuplicates: false }
    ).then(({ error }) => {
      if (error && error.code !== '42P01') {
        console.warn('[whatsapp-sync] failed to update whatsapp_instances:', error.message);
      }
    });

    const summary = {
      chatsImported,
      contactsImported,
      messagesImported,
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
      error: 'Erro na sincronização. Verifique os detalhes nos logs do servidor.',
    };
  }
}

// ============================================================
// Inbox — listar conversas (de whatsapp_chats, já sincronizado)
// ============================================================

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
      .upsert(rows, { onConflict: 'message_key', ignoreDuplicates: true });

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
      instanceName = await getInstanceName();
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
      { onConflict: 'instance_name,remote_jid', ignoreDuplicates: true }
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
