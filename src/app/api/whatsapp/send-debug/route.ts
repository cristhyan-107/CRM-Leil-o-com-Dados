import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEvolutionUrl, sendEvolutionMessage, EvolutionApiError } from '@/lib/evolution';
import {
  extractPhoneFromJid,
  isLidJid,
  normalizeWhatsAppJid,
  resolveContactIdentity,
  formatBrazilianPhone,
  stableMessageId,
} from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = body.chatId;
  const remoteJidInput = body.remoteJid;
  const text = String(body.text || 'teste debug').trim();
  const dryRun = body.dryRun !== false; // default to dryRun=true for safety

  const admin = createAdminClient();
  const instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;

  // Find chat
  let chat: any = null;
  if (chatId) {
    const { data } = await admin.from('whatsapp_chats').select('*').eq('id', chatId).maybeSingle();
    chat = data;
  } else if (remoteJidInput) {
    const normalized = normalizeWhatsAppJid(remoteJidInput);
    const { data } = await admin
      .from('whatsapp_chats')
      .select('*')
      .eq('instance_name', instanceName)
      .eq('remote_jid', normalized)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    chat = data;
  }

  const remoteJid = chat?.remote_jid || normalizeWhatsAppJid(remoteJidInput) || '';
  if (!remoteJid) {
    return NextResponse.json({ success: false, error: 'Nenhum chat ou remoteJid fornecido.' }, { status: 400 });
  }

  // Find contact
  const { data: contact } = await admin
    .from('whatsapp_contacts')
    .select('*')
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const identity = resolveContactIdentity({ contact, chat, remoteJid });

  // Resolve send JID
  const phone = contact?.phone_number || chat?.phone_number || extractPhoneFromJid(remoteJid);
  const isLid = isLidJid(remoteJid);
  let sendJid = identity.sendJid;
  let sendStrategy = 'failed';

  if (phone) {
    sendJid = `${phone}@s.whatsapp.net`;
    sendStrategy = 'phone_jid';
  } else if (!isLid && (remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@c.us'))) {
    sendJid = remoteJid;
    sendStrategy = 'remote_jid';
  } else if (isLid) {
    sendJid = remoteJid;
    sendStrategy = 'lid_direct';
  }

  const endpoint = getEvolutionUrl(`/message/sendText/${instanceName}`);
  const canSend = Boolean(sendJid);

  // Build payload preview (without API key)
  const payloadPreview = {
    number: sendJid || '(não resolvido)',
    text,
    textMessage: { text },
    options: { delay: 1200, presence: 'composing', linkPreview: false },
  };

  const result: any = {
    success: true,
    dryRun,
    instanceName,
    chatFound: Boolean(chat),
    contactFound: Boolean(contact),
    remoteJid,
    isLid,
    phoneNumber: phone || null,
    formattedPhone: phone ? formatBrazilianPhone(phone) : null,
    displayName: identity.displayName,
    displayNameSource: identity.displayNameSource,
    resolvedSendJid: sendJid,
    sendStrategy,
    canSend,
    evolutionEndpoint: endpoint,
    evolutionPayloadPreview: payloadPreview,
  };

  if (dryRun) {
    return NextResponse.json(result);
  }

  // Real send
  if (!sendJid) {
    return NextResponse.json({ ...result, success: false, error: 'Nenhum JID resolvido para envio.' }, { status: 400 });
  }

  try {
    const response = await sendEvolutionMessage(instanceName, phone || '', text, {
      remoteJid: phone ? undefined : sendJid,
    });

    const now = new Date().toISOString();
    const messageId = response?.key?.id || response?.id || stableMessageId([instanceName, remoteJid, now, true, text]);

    // Save message
    await admin.from('whatsapp_messages').upsert({
      user_id: user.id,
      instance_name: instanceName,
      remote_jid: remoteJid,
      message_id: messageId,
      message_key: messageId,
      from_me: true,
      message_type: 'conversation',
      content: text,
      text,
      status: 'sent',
      sent_at: now,
      created_at: now,
      updated_at: now,
      phone_normalized: phone || null,
      direction: 'outbound',
      provider: 'evolution',
    }, { onConflict: 'user_id,instance_name,remote_jid,message_id', ignoreDuplicates: false });

    return NextResponse.json({
      ...result,
      dryRun: false,
      sent: true,
      message: { id: messageId, text, fromMe: true, status: 'sent' },
      evolutionResponse: { keyId: response?.key?.id, status: response?.status },
    });
  } catch (error: any) {
    return NextResponse.json({
      ...result,
      dryRun: false,
      sent: false,
      error: error instanceof EvolutionApiError
        ? `Evolution HTTP ${error.status}: ${error.message}`
        : error?.message || 'Erro ao enviar',
      evolutionStatusCode: error instanceof EvolutionApiError ? error.status : null,
    }, { status: error instanceof EvolutionApiError ? 502 : 500 });
  }
}
