import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractMessageTextFromPayload,
  extractPhoneFromJid,
  formatBrazilianPhone,
  getMessageMediaInfo,
  isBroadcastJid,
  isGroupJid,
  normalizeEvolutionEventName,
  normalizeWhatsAppJid,
  resolveContactDisplayName,
  stableMessageId,
} from '@/lib/whatsapp-normalize';

export const dynamic = 'force-dynamic';

type WebhookProcessResult = {
  processed: boolean;
  savedContact: boolean;
  savedChat: boolean;
  savedMessage: boolean;
  remoteJid?: string;
  messageId?: string;
  fromMe?: boolean;
  error?: string;
};

export async function POST(req: Request) {
  const supabase = createAdminClient();
  const receivedAt = new Date().toISOString();
  let payload: any = null;
  let auditId: string | null = null;

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const url = new URL(req.url);
  const headerSecret =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('webhook-secret') ||
    req.headers.get('x-evolution-secret');
  const querySecret = url.searchParams.get('secret');
  const configuredSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  const secretValid = !configuredSecret || headerSecret === configuredSecret || querySecret === configuredSecret;

  const eventRaw = payload?.event || payload?.type || payload?.eventName || '';
  const eventNormalized = normalizeEvolutionEventName(eventRaw);
  const instanceName = payload?.instance || payload?.instanceName || payload?.data?.instance || '';

  const initialMessage = extractMessages(payload)[0];
  const initialRemoteJid = normalizeWhatsAppJid(initialMessage?.key?.remoteJid || payload?.data?.remoteJid || '');
  const initialMessageId = initialMessage?.key?.id || payload?.data?.key?.id || null;

  const auditInsert = await supabase
    .from('whatsapp_webhook_events')
    .insert({
      received_at: receivedAt,
      instance_name: instanceName,
      event_raw: String(eventRaw || ''),
      event_normalized: eventNormalized,
      remote_jid: initialRemoteJid || null,
      message_id: initialMessageId,
      from_me: initialMessage?.key?.fromMe ?? null,
      secret_valid: secretValid,
      processed: false,
      raw_payload: payload,
    })
    .select('id')
    .maybeSingle();

  auditId = auditInsert.data?.id || null;

  if (!secretValid) {
    await updateAudit(supabase, auditId, {
      processed: false,
      error_message: 'Invalid webhook secret',
    });
    return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
  }

  try {
    let result: WebhookProcessResult = {
      processed: false,
      savedContact: false,
      savedChat: false,
      savedMessage: false,
    };

    if (eventNormalized === 'messages.upsert' || eventNormalized === 'send.message') {
      result = await processEvolutionMessageEvent(supabase, payload);
    } else if (eventNormalized === 'messages.update') {
      result = await processMessageUpdates(supabase, payload);
    } else if (eventNormalized === 'messages.delete') {
      result = await processMessageDeletes(supabase, payload);
    } else if (eventNormalized === 'contacts.upsert' || eventNormalized === 'contacts.update') {
      result = await processContactEvents(supabase, payload);
    } else if (eventNormalized === 'chats.upsert' || eventNormalized === 'chats.update') {
      result = await processChatEvents(supabase, payload);
    }

    await updateAudit(supabase, auditId, {
      remote_jid: result.remoteJid || initialRemoteJid || null,
      message_id: result.messageId || initialMessageId,
      from_me: result.fromMe ?? initialMessage?.key?.fromMe ?? null,
      processed: result.processed,
      saved_contact: result.savedContact,
      saved_chat: result.savedChat,
      saved_message: result.savedMessage,
      error_message: result.error || null,
    });

    return NextResponse.json({
      success: true,
      event: eventNormalized,
      processed: result.processed,
      savedMessage: result.savedMessage,
    });
  } catch (error: any) {
    console.error('[Webhook] failed', {
      eventRaw,
      eventNormalized,
      instanceName,
      message: error?.message,
    });
    if (error?.stack) console.error(error.stack);
    await updateAudit(supabase, auditId, {
      processed: false,
      error_message: error?.message || 'Unhandled webhook error',
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function processEvolutionMessageEvent(supabase: any, payload: any): Promise<WebhookProcessResult> {
  const instanceName = payload?.instance || payload?.instanceName || payload?.data?.instance || '';
  const messages = extractMessages(payload);
  if (!instanceName || messages.length === 0) {
    return { processed: false, savedContact: false, savedChat: false, savedMessage: false, error: 'No message payload' };
  }

  let lastResult: WebhookProcessResult = {
    processed: false,
    savedContact: false,
    savedChat: false,
    savedMessage: false,
  };

  for (const message of messages) {
    lastResult = await saveEvolutionMessage(supabase, instanceName, message, payload?.event || '');
  }

  return lastResult;
}

function extractMessages(payload: any) {
  const data = payload?.data;
  const candidates = [
    data?.messages,
    payload?.messages,
    data?.key ? data : null,
    payload?.key ? payload : null,
    data?.message?.key ? data.message : null,
    payload?.message?.key ? payload.message : null,
    Array.isArray(data) ? data : null,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    return Array.isArray(candidate) ? candidate : [candidate];
  }

  return [];
}

async function saveEvolutionMessage(
  supabase: any,
  instanceName: string,
  message: any,
  event: string
): Promise<WebhookProcessResult> {
  const remoteJid = normalizeWhatsAppJid(message?.key?.remoteJid || message?.remoteJid);
  if (!remoteJid || isBroadcastJid(remoteJid)) {
    return { processed: true, savedContact: false, savedChat: false, savedMessage: false, error: 'Ignored broadcast/empty jid' };
  }

  const fromMe = Boolean(message?.key?.fromMe);
  const text = extractMessageTextFromPayload(message?.message);
  const media = getMessageMediaInfo(message?.message);
  const mediaNode =
    message?.message?.imageMessage ||
    message?.message?.videoMessage ||
    message?.message?.audioMessage ||
    message?.message?.documentMessage ||
    message?.message?.stickerMessage;
  const messageType = message?.messageType || Object.keys(message?.message || {})[0] || 'conversation';
  const timestamp = message?.messageTimestamp
    ? new Date(Number(message.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString();
  const messageId =
    message?.key?.id ||
    stableMessageId([instanceName, remoteJid, timestamp, fromMe, messageType, text, media.mimetype]);
  const phone = extractPhoneFromJid(message?.key?.remoteJidAlt || remoteJid);
  const senderName = message?.pushName || message?.senderName || null;

  const userId = await resolveUserIdForInstance(supabase, instanceName);
  if (!userId) {
    return { processed: false, savedContact: false, savedChat: false, savedMessage: false, remoteJid, messageId, fromMe, error: 'No user for instance' };
  }

  const displayName = resolveContactDisplayName({
    contact: { push_name: senderName, phone_number: phone },
    message,
    remoteJid,
  });

  const contact = await supabase.from('whatsapp_contacts').upsert(
    {
      user_id: userId,
      instance_name: instanceName,
      remote_jid: remoteJid,
      phone_number: phone || null,
      display_name: displayName,
      push_name: senderName,
      is_group: isGroupJid(remoteJid),
      raw_payload: message,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
  );
  if (contact.error) throw contact.error;

  const savedMessage = await supabase.from('whatsapp_messages').upsert(
    {
      user_id: userId,
      instance_name: instanceName,
      remote_jid: remoteJid,
      message_id: messageId,
      message_key: messageId,
      from_me: fromMe,
      sender_jid: message?.key?.participant || (fromMe ? null : remoteJid),
      sender_name: senderName,
      push_name: senderName,
      message_type: messageType,
      content: text,
      text: text || null,
      caption: message?.message?.imageMessage?.caption || message?.message?.videoMessage?.caption || null,
      has_media: media.hasMedia,
      media_mimetype: media.mimetype,
      media_filename: media.filename,
      media_url: mediaNode?.url || null,
      message_timestamp: timestamp,
      status: fromMe ? 'sent' : 'delivered',
      sent_at: timestamp,
      created_at: timestamp,
      updated_at: new Date().toISOString(),
      raw_payload: message,
      phone_normalized: phone || null,
      direction: fromMe ? 'outbound' : 'inbound',
      provider: 'evolution',
      event_type: event,
      contact_name: senderName,
    },
    { onConflict: 'user_id,instance_name,remote_jid,message_id', ignoreDuplicates: false }
  );
  if (savedMessage.error) throw savedMessage.error;

  const lastMessageText = text || media.filename || (media.hasMedia ? messageType : '');
  const savedChat = await supabase.from('whatsapp_chats').upsert(
    {
      user_id: userId,
      instance_name: instanceName,
      remote_jid: remoteJid,
      phone_number: phone || null,
      chat_name: displayName,
      push_name: displayName,
      last_message: lastMessageText || null,
      last_message_text: lastMessageText || null,
      last_message_at: timestamp,
      unread_count: fromMe ? 0 : 1,
      is_group: isGroupJid(remoteJid),
      pipeline_stage: 'new',
      raw_payload: message,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
  );
  if (savedChat.error) throw savedChat.error;

  return {
    processed: true,
    savedContact: true,
    savedChat: true,
    savedMessage: true,
    remoteJid,
    messageId,
    fromMe,
  };
}

async function processMessageUpdates(supabase: any, payload: any): Promise<WebhookProcessResult> {
  const updates = Array.isArray(payload?.data) ? payload.data : [payload?.data || payload];
  for (const update of updates) {
    const messageId = update?.key?.id;
    if (!messageId) continue;
    const statusMap: Record<number, string> = { 1: 'pending', 2: 'sent', 3: 'delivered', 4: 'read' };
    const status = statusMap[update?.update?.status] || update?.status;
    if (status) {
      await supabase.from('whatsapp_messages').update({ status, updated_at: new Date().toISOString() }).eq('message_id', messageId);
    }
  }
  return { processed: true, savedContact: false, savedChat: false, savedMessage: false };
}

async function processMessageDeletes(supabase: any, payload: any): Promise<WebhookProcessResult> {
  const keys = payload?.data?.keys || payload?.data?.key || payload?.keys || [];
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    if (key?.id) {
      await supabase.from('whatsapp_messages').update({ content: '[Mensagem apagada]', updated_at: new Date().toISOString() }).eq('message_id', key.id);
    }
  }
  return { processed: true, savedContact: false, savedChat: false, savedMessage: false };
}

async function processContactEvents(supabase: any, payload: any): Promise<WebhookProcessResult> {
  const instanceName = payload?.instance || payload?.instanceName || '';
  const userId = await resolveUserIdForInstance(supabase, instanceName);
  const contacts = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
  if (!userId) return { processed: false, savedContact: false, savedChat: false, savedMessage: false, error: 'No user for instance' };

  for (const contact of contacts) {
    const remoteJid = normalizeWhatsAppJid(contact?.remoteJid || contact?.id || contact?.jid);
    if (!remoteJid) continue;
    const phone = extractPhoneFromJid(remoteJid);
    const displayName = resolveContactDisplayName({ contact: { ...contact, phone_number: phone }, remoteJid });
    await supabase.from('whatsapp_contacts').upsert(
      {
        user_id: userId,
        instance_name: instanceName,
        remote_jid: remoteJid,
        phone_number: phone || null,
        display_name: displayName,
        push_name: contact?.pushName || null,
        verified_name: contact?.verifiedName || null,
        profile_pic_url: contact?.profilePicUrl || contact?.profilePictureUrl || null,
        is_business: Boolean(contact?.isBusiness),
        is_group: isGroupJid(remoteJid),
        raw_payload: contact,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
    );
  }

  return { processed: true, savedContact: contacts.length > 0, savedChat: false, savedMessage: false };
}

async function processChatEvents(supabase: any, payload: any): Promise<WebhookProcessResult> {
  const instanceName = payload?.instance || payload?.instanceName || '';
  const userId = await resolveUserIdForInstance(supabase, instanceName);
  const chats = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
  if (!userId) return { processed: false, savedContact: false, savedChat: false, savedMessage: false, error: 'No user for instance' };

  for (const chat of chats) {
    const remoteJid = normalizeWhatsAppJid(chat?.remoteJid || chat?.id || chat?.jid);
    if (!remoteJid || isBroadcastJid(remoteJid)) continue;
    const phone = extractPhoneFromJid(remoteJid);
    const displayName = resolveContactDisplayName({ chat: { ...chat, phone_number: phone }, remoteJid });
    const lastMessageText = extractMessageTextFromPayload(chat?.lastMessage?.message);
    const lastAt = chat?.lastMessage?.messageTimestamp
      ? new Date(Number(chat.lastMessage.messageTimestamp) * 1000).toISOString()
      : new Date().toISOString();

    await supabase.from('whatsapp_chats').upsert(
      {
        user_id: userId,
        instance_name: instanceName,
        remote_jid: remoteJid,
        phone_number: phone || null,
        chat_name: displayName,
        push_name: displayName,
        profile_pic_url: chat?.profilePicUrl || chat?.profilePictureUrl || null,
        last_message: lastMessageText || null,
        last_message_text: lastMessageText || null,
        last_message_at: lastAt,
        unread_count: Number(chat?.unreadCount || 0),
        is_group: isGroupJid(remoteJid),
        pipeline_stage: 'new',
        raw_payload: chat,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
    );
  }

  return { processed: true, savedContact: false, savedChat: chats.length > 0, savedMessage: false };
}

async function updateAudit(supabase: any, auditId: string | null, patch: Record<string, unknown>) {
  if (!auditId) return;
  await supabase.from('whatsapp_webhook_events').update(patch).eq('id', auditId);
}

async function resolveUserIdForInstance(supabase: any, instance: string): Promise<string | null> {
  if (!instance) return null;

  const { data: instanceRow } = await supabase
    .from('whatsapp_instances')
    .select('user_id')
    .eq('instance_name', instance)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (instanceRow?.user_id) return instanceRow.user_id;

  const { data: chatRow } = await supabase
    .from('whatsapp_chats')
    .select('user_id')
    .eq('instance_name', instance)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (chatRow?.user_id) return chatRow.user_id;

  const stripped = instance.startsWith('crm_') ? instance.replace('crm_', '') : '';
  if (stripped.length === 32) {
    return `${stripped.slice(0, 8)}-${stripped.slice(8, 12)}-${stripped.slice(12, 16)}-${stripped.slice(16, 20)}-${stripped.slice(20)}`;
  }

  return null;
}
