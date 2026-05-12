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
import {
  avatarFallback,
  extractPhoneFromJid,
  formatBrazilianPhone,
  getMessageMediaInfo,
  isLidJid,
  isLikelyHumanName,
  isValidPhoneNumber,
  normalizeBrazilianPhoneNumber,
  normalizeWhatsAppJid,
  resolveContactDisplayName,
  resolveContactIdentity,
  resolveProfilePicture,
  resolveSendJid,
} from '@/lib/whatsapp-normalize';

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

type SanitizedSupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type SyncStepSummary = {
  stage: string;
  success: boolean;
  found: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  error: null | {
    failedTable: string;
    failedOperation: string;
    supabaseError: SanitizedSupabaseError;
    constraint?: string;
    missingFields?: string[];
    sample?: Record<string, unknown>;
  };
};

class SyncDatabaseError extends Error {
  stage: string;
  failedTable: string;
  failedOperation: string;
  supabaseError: SanitizedSupabaseError;
  constraint?: string;
  missingFields?: string[];
  sample?: Record<string, unknown>;

  constructor(params: {
    stage: string;
    failedTable: string;
    failedOperation: string;
    supabaseError: SanitizedSupabaseError;
    constraint?: string;
    missingFields?: string[];
    sample?: Record<string, unknown>;
  }) {
    super(params.supabaseError.message || `Erro de escrita em ${params.failedTable}`);
    this.name = 'SyncDatabaseError';
    this.stage = params.stage;
    this.failedTable = params.failedTable;
    this.failedOperation = params.failedOperation;
    this.supabaseError = params.supabaseError;
    this.constraint = params.constraint;
    this.missingFields = params.missingFields;
    this.sample = params.sample;
  }
}

function getFriendlyEvolutionError(error: unknown, fallback = 'Erro ao consultar Evolution API') {
  if (error instanceof SyncDatabaseError) return 'Evolution conectada, mas houve erro ao salvar dados no Supabase.';
  if (!process.env.EVOLUTION_API_KEY) return 'EVOLUTION_API_KEY ausente ou inválida';

  const status = error instanceof EvolutionApiError
    ? error.status
    : typeof (error as any)?.status === 'number'
    ? (error as any).status
    : undefined;
  const details = [
    error instanceof EvolutionApiError ? error.message : '',
    error instanceof EvolutionApiError ? error.body : '',
    error instanceof Error ? error.message : '',
    typeof error === 'string' ? error : '',
  ].join(' ').toLowerCase();

  if (status === 401 || status === 403 || details.includes('unauthorized') || details.includes('forbidden')) {
    return 'EVOLUTION_API_KEY ausente ou inválida';
  }
  if (status === 404 || details.includes('not found') || details.includes('not exist')) {
    return 'Instância não encontrada na Evolution';
  }
  if (
    details.includes('fetch failed') ||
    details.includes('econnrefused') ||
    details.includes('enotfound') ||
    details.includes('timeout') ||
    details.includes('network')
  ) {
    return 'Evolution API fora do ar ou inacessível';
  }

  return fallback;
}

function sanitizeSupabaseError(error: any): SanitizedSupabaseError {
  return {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
  };
}

function sampleRow(row: Record<string, any> | undefined) {
  if (!row) return undefined;
  return {
    user_id: row.user_id,
    instance_name: row.instance_name,
    remote_jid: row.remote_jid,
    message_id: row.message_id,
    message_type: row.message_type,
    has_raw_payload: Boolean(row.raw_payload),
  };
}

function missingFields(row: Record<string, any>, fields: string[]) {
  return fields.filter((field) => !row[field]);
}

function dedupeRows<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, T>();
  let duplicates = 0;
  for (const row of rows) {
    const key = getKey(row);
    if (map.has(key)) duplicates += 1;
    map.set(key, row);
  }
  return { rows: Array.from(map.values()), duplicates };
}

function successStep(stage: string, found: number, imported: number, skipped = 0): SyncStepSummary {
  return {
    stage,
    success: true,
    found,
    imported,
    updated: imported,
    skipped,
    failed: 0,
    error: null,
  };
}

function stableHash(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

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
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Unauthorized' };

    const instanceName = await getActiveInstanceName();
    
    // 1. Logout from Evolution API
    let evolutionError: string | null = null;
    try {
      await logoutEvolutionInstance(instanceName);
    } catch (err: any) {
      // Even if Evolution fails, we still update DB to reflect user intent
      evolutionError = err?.message || 'Erro ao desconectar da Evolution API';
      console.warn('[disconnectWhatsApp] Evolution logout error (continuing):', evolutionError);
    }

    // 2. Update whatsapp_instances in database
    const admin = createAdminClient();
    const now = new Date().toISOString();
    await admin.from('whatsapp_instances').upsert(
      {
        user_id: user.id,
        instance_name: instanceName,
        status: 'disconnected',
        sync_status: 'idle',
        sync_error: null,
        updated_at: now,
      },
      { onConflict: 'user_id,instance_name', ignoreDuplicates: false }
    );

    return {
      success: true,
      instanceName,
      evolutionError,
    };
  } catch (error: any) {
    console.error('[disconnectWhatsApp] failed:', error?.message);
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
  if (isLikelyHumanName(chat.pushName, { remoteJid: chat.remoteJid, phoneNumber: phone })) {
    return chat.pushName;
  }
  return phone ? formatBrazilianPhone(phone) : 'Contato WhatsApp';
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
    chat_name: getChatDisplayName(chat),
    push_name: getChatDisplayName(chat),
    profile_pic_url: chat.profilePicUrl || null,
    last_message: lastMsgText || null,
    last_message_text: lastMsgText || null,
    last_message_at: lastMsgAt,
    unread_count: chat.unreadCount || 0,
    is_group: chat.remoteJid.endsWith('@g.us'),
    raw_payload: chat as any,
    pipeline_stage: 'new',
    updated_at: new Date().toISOString(),
  };
}

function contactToRow(userId: string, instanceName: string, contact: EvolutionContact) {
  const phone = contact.phoneNumber || jidToPhone(contact.remoteJid);
  const identity = resolveContactIdentity({
    contact: {
      ...contact,
      phone_number: phone,
      display_name: contact.displayName,
      push_name: contact.pushName,
      verified_name: contact.verifiedName,
      business_name: contact.businessName,
      profile_pic_url: contact.profilePicUrl,
      remote_jid: contact.remoteJid,
    },
    remoteJid: contact.remoteJid,
  });

  return {
    user_id: userId,
    instance_name: instanceName,
    remote_jid: contact.remoteJid,
    phone_number: identity.phoneNumber || phone || null,
    display_name: identity.displayName,
    push_name: contact.pushName || null,
    verified_name: contact.verifiedName || null,
    business_name: contact.businessName || null,
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
    `fallback_${stableHash([
      instanceName,
      remoteJid,
      msg.messageTimestamp || '',
      msg.key?.fromMe ? 'out' : 'in',
      msg.messageType || '',
      extractMessageText(msg.message),
    ].join('|'))}`;
  const content = extractMessageText(msg.message);
  const sentAt = msg.messageTimestamp
    ? new Date(msg.messageTimestamp * 1000).toISOString()
    : new Date().toISOString();
  const media = getMessageMediaInfo(msg.message);
  const phone = extractPhoneFromJid((msg.key as any)?.remoteJidAlt) || jidToPhone(remoteJid);

  return {
    user_id: userId,
    instance_name: instanceName,
    message_key: messageId,
    remote_jid: remoteJid,
    from_me: msg.key?.fromMe ?? false,
    push_name: msg.pushName || null,
    message_type: msg.messageType || media.type || 'conversation',
    content,
    text: content || null,
    caption: media.caption || null,
    has_media: media.hasMedia,
    media_mimetype: media.mimetype,
    media_filename: media.filename,
    media_url: media.url,
    message_timestamp: sentAt,
    sender_jid: msg.key?.participant || (msg.key?.fromMe ? null : remoteJid),
    sender_name: isLikelyHumanName(msg.pushName, { remoteJid, phoneNumber: phone }) ? msg.pushName : null,
    sent_at: sentAt,
    created_at: sentAt,
    status: normalizeStatus(msg.status),
    raw_payload: msg as any,
    message_id: messageId,
    phone_normalized: phone || null,
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
  const { rows: uniqueRows, duplicates } = dedupeRows(
    rows.filter((row) => row.remote_jid),
    (row) => `${row.user_id}|${row.instance_name}|${row.remote_jid}`
  );

  const { error, data } = await admin
    .from('whatsapp_chats')
    .upsert(uniqueRows, { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false })
    .select('id');

  void duplicates;
  if (!error) return data?.length || uniqueRows.length;

  const missingConflict =
    error.message?.includes('no unique or exclusion constraint') ||
    error.code === '42P10';

  if (!missingConflict) {
    throw new SyncDatabaseError({
      stage: 'syncChats',
      failedTable: 'whatsapp_chats',
      failedOperation: 'upsert',
      supabaseError: sanitizeSupabaseError(error),
      constraint: 'user_id,instance_name,remote_jid',
      missingFields: missingFields(uniqueRows[0] as any, ['user_id', 'instance_name', 'remote_jid']),
      sample: sampleRow(uniqueRows[0] as any),
    });
  }

  logSync('chat upsert fallback - unique constraint unavailable', { rows: rows.length });

  let saved = 0;
  for (const row of uniqueRows) {
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
  const { rows: uniqueRows, duplicates } = dedupeRows(
    rows.filter((row) => row.remote_jid && row.message_id),
    (row) => `${row.user_id}|${row.instance_name}|${row.remote_jid}|${row.message_id}`
  );

  const { error, data } = await admin
    .from('whatsapp_messages')
    .upsert(uniqueRows, { onConflict: 'user_id,instance_name,remote_jid,message_id', ignoreDuplicates: false })
    .select('id');

  void duplicates;
  if (!error) return data?.length || uniqueRows.length;

  const missingConflict =
    error.message?.includes('no unique or exclusion constraint') ||
    error.code === '42P10';

  if (!missingConflict) {
    throw new SyncDatabaseError({
      stage: 'syncMessages',
      failedTable: 'whatsapp_messages',
      failedOperation: 'upsert',
      supabaseError: sanitizeSupabaseError(error),
      constraint: 'user_id,instance_name,remote_jid,message_id',
      missingFields: missingFields(uniqueRows[0] as any, ['user_id', 'instance_name', 'remote_jid', 'message_id']),
      sample: sampleRow(uniqueRows[0] as any),
    });
  }

  logSync('message upsert fallback - unique constraint unavailable', { rows: rows.length });

  let saved = 0;
  for (const row of uniqueRows) {
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
  const { rows: uniqueRows, duplicates } = dedupeRows(
    rows.filter((row) => row.remote_jid),
    (row) => `${row.user_id}|${row.instance_name}|${row.remote_jid}`
  );

  const { error, data } = await admin
    .from('whatsapp_contacts')
    .upsert(uniqueRows, { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false })
    .select('id');

  void duplicates;
  if (!error) return data?.length || uniqueRows.length;
  if (error.code === '42P01' || error.code === 'PGRST205') {
    logSync('contacts skipped - whatsapp_contacts unavailable', { message: error.message });
    return 0;
  }

  const missingConflict =
    error.message?.includes('no unique or exclusion constraint') ||
    error.code === '42P10';

  if (!missingConflict) {
    throw new SyncDatabaseError({
      stage: 'syncContacts',
      failedTable: 'whatsapp_contacts',
      failedOperation: 'upsert',
      supabaseError: sanitizeSupabaseError(error),
      constraint: 'user_id,instance_name,remote_jid',
      missingFields: missingFields(uniqueRows[0] as any, ['user_id', 'instance_name', 'remote_jid']),
      sample: sampleRow(uniqueRows[0] as any),
    });
  }

  logSync('contact upsert fallback - unique constraint unavailable', { rows: rows.length });

  let saved = 0;
  for (const row of uniqueRows) {
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

async function upsertInstanceSyncStatus(
  admin: ReturnType<typeof createAdminClient>,
  row: {
    user_id: string;
    instance_name: string;
    status: string;
    last_sync_at?: string;
    sync_status: string;
    sync_error: string | null;
    updated_at: string;
  }
) {
  const { error } = await admin.from('whatsapp_instances').upsert(
    row,
    { onConflict: 'user_id,instance_name', ignoreDuplicates: false }
  );

  if (error) {
    throw new SyncDatabaseError({
      stage: 'testWriteInstance',
      failedTable: 'whatsapp_instances',
      failedOperation: 'upsert',
      supabaseError: sanitizeSupabaseError(error),
      constraint: 'user_id,instance_name',
      missingFields: missingFields(row as any, ['user_id', 'instance_name']),
      sample: sampleRow(row as any),
    });
  }
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
    steps?: Record<string, SyncStepSummary>;
  };
  stage?: string;
  failedTable?: string;
  failedOperation?: string;
  supabaseError?: SanitizedSupabaseError;
  instanceName?: string;
  statusCode?: number;
  details?: string;
  error?: string;
  userMessage?: string;
}> {
  let instanceName = '';
  let instanceNameSource: InstanceResolutionSource = 'fallback';
  const steps: Record<string, SyncStepSummary> = {};
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

    await upsertInstanceSyncStatus(admin, {
      user_id: userId,
      instance_name: instanceName,
      status: String(state || 'open'),
      last_sync_at: new Date().toISOString(),
      sync_status: 'running',
      sync_error: null,
      updated_at: new Date().toISOString(),
    });
    steps.testWriteInstance = successStep('testWriteInstance', 1, 1);

    const chats = await getEvolutionChats(instanceName);
    logSync('chats fetched', { count: chats.length });

    const contacts = await getEvolutionContacts(instanceName).catch((err) => {
      logSyncError('contacts fetch failed - continuing partial sync', err, { instanceName });
      return [] as EvolutionContact[];
    });
    logSync('contacts fetched', { count: contacts.length });

    const chatRows = chats.map((chat) => chatToRow(userId, instanceName, chat));
    const chatsImported = await saveChatRows(admin, chatRows);
    steps.syncChats = successStep('syncChats', chats.length, chatsImported, chats.length - chatRows.length);
    logSync('chats saved', { count: chatsImported });

    const contactRows = contacts.map((contact) => contactToRow(userId, instanceName, contact));
    const contactsImported = await saveContactRows(admin, contactRows);
    steps.syncContacts = successStep('syncContacts', contacts.length, contactsImported, contacts.length - contactRows.length);
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
    steps.syncMessages = successStep('syncMessages', messageRows.length, messagesImported);
    logSync('messages saved', { count: messagesImported });

    let chatLastMessageUpdates = 0;
    for (const row of messageRows) {
      const { error: updateChatError } = await admin
        .from('whatsapp_chats')
        .update({
          last_message: row.content || row.caption || null,
          last_message_at: row.sent_at,
          updated_at: new Date().toISOString(),
        })
        .eq('instance_name', instanceName)
        .eq('remote_jid', row.remote_jid);
      if (updateChatError) {
        throw new SyncDatabaseError({
          stage: 'updateChatLastMessage',
          failedTable: 'whatsapp_chats',
          failedOperation: 'update',
          supabaseError: sanitizeSupabaseError(updateChatError),
          sample: sampleRow(row as any),
        });
      }
      chatLastMessageUpdates += 1;
    }
    steps.updateChatLastMessage = successStep('updateChatLastMessage', messageRows.length, chatLastMessageUpdates);

    await upsertInstanceSyncStatus(admin, {
      user_id: userId,
      instance_name: instanceName,
      status: String(state || 'open'),
      last_sync_at: new Date().toISOString(),
      sync_status: 'completed',
      sync_error: null,
      updated_at: new Date().toISOString(),
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
      steps,
    };

    logSync('completed', { instanceName, ...summary });
    return { success: true, status: 'completed', count: chatsImported, summary };
  } catch (error: any) {
    const message = error?.message || 'Erro desconhecido na sincronizacao';
    const userMessage = getFriendlyEvolutionError(error);
    logSyncError('failed', error, { instanceName });
    if (instanceName) await saveSyncError(instanceName, message);
    return {
      success: false,
      status: 'error',
      stage: error instanceof SyncDatabaseError ? 'database.write' : 'sync',
      failedTable: error instanceof SyncDatabaseError ? error.failedTable : undefined,
      failedOperation: error instanceof SyncDatabaseError ? error.failedOperation : undefined,
      supabaseError: error instanceof SyncDatabaseError ? error.supabaseError : undefined,
      instanceName,
      statusCode: typeof error?.status === 'number' ? error.status : undefined,
      error: 'Erro na sincronização. Verifique os detalhes nos logs do servidor.',
      userMessage,
      details: message,
      summary: {
        resolvedInstanceName: instanceName,
        instanceNameSource,
        chatsFound: 0,
        chatsImported: 0,
        contactsImported: 0,
        messagesImported: 0,
        savedChatsFound: 0,
        duplicatesSkipped: 0,
        steps,
      },
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

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('whatsapp_chats')
      .select('*')
      .eq('user_id', user.id)
      .eq('instance_name', instanceName)
      .eq('is_group', false)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100);

    if (error || !data) return [];
    const remoteJids = data.map((chat) => chat.remote_jid).filter(Boolean);
    const { data: contacts, error: contactsError } = await admin
      .from('whatsapp_contacts')
      .select('remote_jid, display_name, push_name, verified_name, business_name, phone_number, profile_pic_url')
      .eq('user_id', user.id)
      .eq('instance_name', instanceName)
      .in('remote_jid', remoteJids.length ? remoteJids : ['']);
    if (contactsError) {
      console.error('[getInboxContacts] contacts lookup failed:', contactsError.message);
    }
    const contactByJid = new Map((contacts || []).map((contact: any) => [contact.remote_jid, contact]));

    // For @lid chats: build a broader contact lookup by phone number
    // Since @lid chats have contacts stored under @s.whatsapp.net JIDs,
    // we need to cross-reference via phone_number
    const lidChats = data.filter((chat: any) => chat.remote_jid?.endsWith('@lid'));
    let contactByPhone = new Map<string, any>();
    const phoneByLid = new Map<string, string>();
    const profilePicByLid = new Map<string, string>();
    
    if (lidChats.length > 0) {
      // Fetch push_names from messages for @lid chats (the best identity hint we have)
      const lidJids = lidChats.map((c: any) => c.remote_jid);
      const { data: lidMsgNames } = await admin
        .from('whatsapp_messages')
        .select('remote_jid, push_name, sender_name, phone_normalized, raw_payload')
        .eq('user_id', user.id)
        .eq('instance_name', instanceName)
        .in('remote_jid', lidJids)
        .eq('from_me', false)
        .not('push_name', 'is', null)
        .order('created_at', { ascending: false })
        .limit(lidChats.length * 2);
      
      // Map LID jid -> best push_name (not a LID number)
      const lidPushNames = new Map<string, string>();
      for (const msg of lidMsgNames || []) {
        const jid = msg.remote_jid;
        if (!jid || lidPushNames.has(jid)) continue;
        const name = msg.push_name || msg.sender_name;
        if (isLikelyHumanName(name, { remoteJid: jid, phoneNumber: msg.phone_normalized })) {
          lidPushNames.set(jid, name);
        }
        const altPhone = extractPhoneFromJid((msg as any)?.raw_payload?.key?.remoteJidAlt);
        const normalizedPhone = String((msg as any).phone_normalized || '').replace(/\D/g, '');
        const phone = altPhone || (
          isValidPhoneNumber(normalizedPhone) && !normalizedPhone.includes(jid.split('@')[0])
            ? normalizedPhone
            : ''
        );
        if (phone && !phoneByLid.has(jid)) phoneByLid.set(jid, phone);
      }

      // Build phone-to-contact map for ALL contacts in this instance
      const { data: allContacts, error: allContactsError } = await admin
        .from('whatsapp_contacts')
        .select('remote_jid, display_name, push_name, verified_name, business_name, phone_number, profile_pic_url')
        .eq('user_id', user.id)
        .eq('instance_name', instanceName)
        .not('phone_number', 'is', null);
      if (allContactsError) {
        console.error('[getInboxContacts] all contacts lookup failed:', allContactsError.message);
      }
      
      for (const c of allContacts || []) {
        const phone = String(c.phone_number || '').replace(/\D/g, '');
        if (phone && isValidPhoneNumber(phone)) contactByPhone.set(phone, c);
      }

      // Enrich @lid chats with push_name from messages
      for (const chat of lidChats) {
        const pushName = lidPushNames.get(chat.remote_jid);
        const mappedPhone = phoneByLid.get(chat.remote_jid);
        if (mappedPhone && !chat.phone_number) chat.phone_number = mappedPhone;
        const mappedContact = mappedPhone ? contactByPhone.get(mappedPhone) : null;
        if (mappedContact?.profile_pic_url) profilePicByLid.set(chat.remote_jid, mappedContact.profile_pic_url);
        if (pushName && (!chat.chat_name || !isLikelyHumanName(chat.chat_name, { remoteJid: chat.remote_jid, phoneNumber: mappedPhone }))) {
          chat.chat_name = pushName;
          chat.push_name = pushName;
        }
      }
    }

    return data.map((chat: any) => {
      let contact = contactByJid.get(chat.remote_jid);
      
      // For @lid chats without a direct contact match, try phone-based lookup
      if (!contact && chat.remote_jid?.endsWith('@lid')) {
        const mappedPhone = phoneByLid.get(chat.remote_jid);
        if (mappedPhone) contact = contactByPhone.get(mappedPhone);
        // Try to find contact by matching push_name/chat_name
        if (!contact) {
          for (const [, c] of contactByPhone) {
            if (c.display_name && chat.chat_name && c.display_name === chat.chat_name) {
              contact = c;
              break;
            }
            if (c.push_name && chat.push_name && c.push_name === chat.push_name) {
              contact = c;
              break;
            }
          }
        }
      }
      
      const identity = resolveContactIdentity({ contact, chat, remoteJid: chat.remote_jid });
      const profilePicUrl = identity.profilePicUrl || profilePicByLid.get(chat.remote_jid) || null;
      return {
        id: chat.id,
        phone: identity.formattedPhone || '',
        phoneNumber: identity.phoneNumber || '',
        formattedPhone: identity.formattedPhone || '',
        remoteJid: chat.remote_jid,
        displayName: identity.displayName,
        displayNameSource: identity.displayNameSource,
        name: identity.displayName,
        avatarFallback: identity.avatarFallback,
        lastMessage: chat.last_message_text || chat.last_message || '',
        lastMessageText: chat.last_message_text || chat.last_message || '',
        timestamp: chat.last_message_at || chat.updated_at,
        lastMessageAt: chat.last_message_at || chat.updated_at,
        unreadCount: chat.unread_count || 0,
        profilePicUrl,
        isLead: false,
        isLid: identity.isLid,
        isGroup: identity.isGroup,
        canSendMessage: identity.canSendMessage,
        sendJid: identity.sendJid,
      };
    });
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
    const isLid = phone ? false : true; // jidToPhone returns empty-ish for @lid
    const endpoint = `/message/sendText/${instanceName}`;

    diagnostics.instanceName = instanceName;
    diagnostics.phone = phone || null;
    diagnostics.endpoint = endpoint;

    console.log('[sendChatMessage] iniciando envio', {
      instanceName,
      phone: phone || '(lid/unavailable)',
      remoteJid,
      endpoint,
      contentLen: content.length,
      sendStrategy: phone ? 'phone' : 'remoteJid',
    });

    // Enviar via Evolution API
    let sendRes: any;
    try {
      sendRes = await sendEvolutionMessage(instanceName, phone, content, {
        remoteJid: phone ? undefined : remoteJid,
      });
    } catch (apiErr: unknown) {
      const errMsg = safeStr(apiErr);
      console.error('[sendChatMessage] Evolution API error:', errMsg);
      
      diagnostics.error = errMsg;
      let userFriendlyError = errMsg;
      if (errMsg.includes('404') || errMsg.includes('not exist')) {
          userFriendlyError = 'Instância não encontrada (404). Verifique se o WhatsApp está conectado.';
      } else if (errMsg.includes('401') || errMsg.includes('403')) {
          userFriendlyError = 'Não autorizado. Verifique a EVOLUTION_API_KEY.';
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
      phone_normalized: phone || null,
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
  phone: string,
  initialMessage?: string
): Promise<{ success: boolean; remoteJid?: string; chat?: any; error?: string }> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Unauthorized' };

    const instanceName = await getActiveInstanceName();

    // Normalize phone
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return { success: false, error: 'Número inválido. Mínimo 10 dígitos (DDD + número).' };
    const fullNumber = normalizeBrazilianPhoneNumber(digits);
    if (fullNumber.length < 12 || fullNumber.length > 13) {
      return { success: false, error: 'Número inválido. Verifique DDD e número.' };
    }
    const remoteJid = `${fullNumber}@s.whatsapp.net`;
    const formattedPhone = formatBrazilianPhone(fullNumber);
    const now = new Date().toISOString();

    // Use admin client to bypass RLS
    const admin = createAdminClient();
    const { error: upsertError } = await admin.from('whatsapp_chats').upsert(
      {
        user_id: user.id,
        instance_name: instanceName,
        remote_jid: remoteJid,
        phone_number: fullNumber,
        chat_name: formattedPhone,
        push_name: formattedPhone,
        is_group: false,
        last_message_text: initialMessage || '',
        last_message_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
    );

    if (upsertError) {
      console.error('[startNewConversation] upsert error:', upsertError);
      return { success: false, error: `Erro ao criar conversa: ${upsertError.message}` };
    }

    // Also upsert contact
    await admin.from('whatsapp_contacts').upsert(
      {
        user_id: user.id,
        instance_name: instanceName,
        remote_jid: remoteJid,
        phone_number: fullNumber,
        display_name: formattedPhone,
        push_name: formattedPhone,
        updated_at: now,
      },
      { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
    );

    // Send initial message if provided
    if (initialMessage?.trim()) {
      try {
        await sendEvolutionMessage(instanceName, fullNumber, initialMessage.trim());
      } catch (sendErr: any) {
        console.warn('[startNewConversation] send failed:', sendErr?.message);
        // Don't fail the whole operation — chat was created
      }
    }

    // Fetch the created chat to return its ID
    const { data: createdChat } = await admin
      .from('whatsapp_chats')
      .select('id')
      .eq('user_id', user.id)
      .eq('instance_name', instanceName)
      .eq('remote_jid', remoteJid)
      .maybeSingle();

    return {
      success: true,
      remoteJid,
      chat: {
        id: createdChat?.id || `new_${remoteJid}`,
        remoteJid,
        sendJid: remoteJid,
        displayName: formattedPhone,
        displayNameSource: 'phone',
        phoneNumber: fullNumber,
        formattedPhone,
        profilePicUrl: null,
        avatarFallback: fullNumber.slice(-2),
        canSendMessage: true,
      },
    };
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
