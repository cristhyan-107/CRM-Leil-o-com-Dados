import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { EvolutionApiError, getEvolutionUrl, sendEvolutionMessage } from '@/lib/evolution';
import {
  extractPhoneFromJid,
  isLidJid,
  normalizeWhatsAppJid,
  resolveContactIdentity,
  resolveSendJid,
  stableMessageId,
} from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function friendlySendError(error: unknown, sendReason?: string | null) {
  if (error instanceof EvolutionApiError) {
    if (error.status === 401 || error.status === 403) return 'API key da Evolution invalida.';
    if (error.status === 404) return 'Instancia nao encontrada ou endpoint de envio incorreto.';
    if (error.status === 400 && sendReason) return sendReason;
    return `Evolution retornou erro HTTP ${error.status}.`;
  }
  const message = error instanceof Error ? error.message : String(error || '');
  return message || 'Erro ao enviar mensagem.';
}

async function findChat(admin: ReturnType<typeof createAdminClient>, userId: string, chatId?: string, remoteJid?: string) {
  if (chatId && !chatId.startsWith('synthetic_') && !chatId.startsWith('new_')) {
    const { data, error } = await admin
      .from('whatsapp_chats')
      .select('*')
      .eq('user_id', userId)
      .eq('id', chatId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (remoteJid) {
    const { data, error } = await admin
      .from('whatsapp_chats')
      .select('*')
      .eq('user_id', userId)
      .eq('remote_jid', remoteJid)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  return null;
}

async function findContact(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  instanceName: string,
  remoteJid: string
) {
  const { data: direct, error } = await admin
    .from('whatsapp_contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (direct) return direct;

  return null;
}

async function findAltPhone(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  instanceName: string,
  remoteJid: string
) {
  const { data, error } = await admin
    .from('whatsapp_messages')
    .select('raw_payload, phone_normalized')
    .eq('user_id', userId)
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .not('raw_payload', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  for (const row of data || []) {
    const alt = extractPhoneFromJid((row as any)?.raw_payload?.key?.remoteJidAlt);
    if (alt) return alt;
  }

  return null;
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || '');
  const remoteJidInput = normalizeWhatsAppJid(body.remoteJid);
  const text = String(body.text || '').trim();
  if (!remoteJidInput && !chatId) {
    return NextResponse.json({ success: false, stage: 'frontendPayload', error: 'chatId ou remoteJid obrigatorio.' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ success: false, stage: 'frontendPayload', error: 'Mensagem vazia.' }, { status: 400 });

  const admin = createAdminClient();
  let chat: any = null;
  let contact: any = null;
  let instanceName = '';
  let remoteJid = remoteJidInput;
  let phone: string | null = null;

  try {
    chat = await findChat(admin, user.id, chatId, remoteJidInput);
    remoteJid = chat?.remote_jid || remoteJidInput;
    const resolution = chat?.instance_name
      ? { resolvedInstanceName: chat.instance_name }
      : await resolveWhatsAppInstance(remoteJid);
    instanceName = resolution.resolvedInstanceName;

    const altPhone = remoteJid ? await findAltPhone(admin, user.id, instanceName, remoteJid) : null;
    contact = await findContact(admin, user.id, instanceName, remoteJid);
    const identity = resolveContactIdentity({
      contact: contact ? { ...contact, phone_number: contact.phone_number || altPhone } : { phone_number: altPhone },
      chat,
      remoteJid,
    });
    phone = identity.phoneNumber || altPhone || null;
    const send = resolveSendJid({ remoteJid, phoneNumber: phone });
    const diagnostics = {
      chatId: chat?.id || chatId || null,
      chatFound: Boolean(chat),
      contactFound: Boolean(contact),
      instanceName,
      remoteJid,
      resolvedSendJid: send.sendJid,
      phoneNumber: phone,
      isLid: isLidJid(remoteJid),
      sendStrategy: send.sendStrategy,
      canSend: send.canSendMessage,
      evolutionEndpoint: getEvolutionUrl(`/message/sendText/${instanceName}`),
      message: send.reason,
    };

    if (!send.canSendMessage || !send.sendTarget) {
      return NextResponse.json({
        success: false,
        stage: 'resolveSendJid',
        ...diagnostics,
        error: send.reason || 'Nao foi possivel resolver destinatario de envio.',
      }, { status: 400 });
    }

    console.log('[whatsapp-send] sending', diagnostics);
    const response = await sendEvolutionMessage(instanceName, send.sendStrategy === 'phone_jid' ? (phone || '') : send.sendTarget, text, {
      remoteJid: send.sendStrategy === 'phone_jid' ? undefined : send.sendTarget,
    });

    const now = new Date().toISOString();
    const messageId =
      response?.key?.id ||
      response?.message?.key?.id ||
      response?.id ||
      stableMessageId([instanceName, remoteJid, now, true, text]);

    const row = {
      user_id: user.id,
      instance_name: instanceName,
      remote_jid: remoteJid,
      message_id: messageId,
      message_key: messageId,
      from_me: true,
      sender_jid: null,
      sender_name: 'Voce',
      push_name: 'Voce',
      message_type: 'conversation',
      content: text,
      text,
      status: 'sent',
      sent_at: now,
      created_at: now,
      updated_at: now,
      message_timestamp: now,
      phone_normalized: phone,
      direction: 'outbound',
      provider: 'evolution',
      raw_payload: response,
    };

    const { error: messageError, data: saved } = await admin
      .from('whatsapp_messages')
      .upsert(row, { onConflict: 'user_id,instance_name,remote_jid,message_id', ignoreDuplicates: false })
      .select('*')
      .maybeSingle();
    if (messageError) throw messageError;

    const chatPhoneNumber = isLidJid(remoteJid) ? null : phone;
    const chatPatch = {
      user_id: user.id,
      instance_name: instanceName,
      remote_jid: remoteJid,
      phone_number: chatPhoneNumber,
      chat_name: identity.displayName,
      push_name: identity.displayName,
      profile_pic_url: identity.profilePicUrl,
      last_message: text,
      last_message_text: text,
      last_message_at: now,
      unread_count: 0,
      is_group: identity.isGroup,
      pipeline_stage: chat?.pipeline_stage || 'new',
      updated_at: now,
    };

    const { error: chatError } = await admin
      .from('whatsapp_chats')
      .upsert(chatPatch, { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false });
    if (chatError) throw chatError;

    return NextResponse.json({
      success: true,
      stage: 'sent',
      diagnostics,
      message: saved,
      evolutionResponse: {
        keyId: response?.key?.id || response?.message?.key?.id || null,
        status: response?.status || null,
      },
    });
  } catch (error: any) {
    const isEvolution = error instanceof EvolutionApiError;
    const sendReason = isLidJid(remoteJid)
      ? 'Nao foi possivel enviar: contato sem telefone real associado ao identificador @lid.'
      : null;
    console.error('[whatsapp-send] failed', {
      instanceName,
      remoteJid,
      chatId,
      status: error?.status,
      message: error?.message,
    });

    return NextResponse.json({
      success: false,
      stage: isEvolution ? 'evolutionSend' : 'databaseSave',
      chatId: chat?.id || chatId || null,
      remoteJid,
      resolvedSendJid: phone ? `${phone}@s.whatsapp.net` : remoteJid || null,
      phoneNumber: phone,
      isLid: isLidJid(remoteJid),
      sendStrategy: phone ? 'phone_jid' : isLidJid(remoteJid) ? 'lid_direct' : 'failed',
      instanceName,
      evolutionEndpoint: instanceName ? getEvolutionUrl(`/message/sendText/${instanceName}`) : null,
      evolutionStatusCode: isEvolution ? error.status : null,
      evolutionResponse: isEvolution ? safeJson(error.body) : null,
      databaseError: isEvolution ? null : {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      },
      error: friendlySendError(error, sendReason),
    }, { status: isEvolution ? 502 : 500 });
  }
}
