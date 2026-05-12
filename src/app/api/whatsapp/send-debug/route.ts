import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEvolutionUrl, sendEvolutionMessage, EvolutionApiError } from '@/lib/evolution';
import {
  extractPhoneFromJid,
  formatBrazilianPhone,
  isLidJid,
  normalizeWhatsAppJid,
  resolveContactIdentity,
  resolveSendJid,
  stableMessageId,
} from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || '');
  const remoteJidInput = normalizeWhatsAppJid(body.remoteJid);
  const text = String(body.text || 'teste debug').trim();
  const dryRun = body.dryRun !== false;
  const admin = createAdminClient();

  let chat: any = null;
  if (chatId && !chatId.startsWith('synthetic_') && !chatId.startsWith('new_')) {
    const { data, error } = await admin
      .from('whatsapp_chats')
      .select('*')
      .eq('user_id', user.id)
      .eq('id', chatId)
      .maybeSingle();
    if (error) return NextResponse.json({ success: false, stage: 'resolveChat', error: error.message }, { status: 500 });
    chat = data;
  }

  const remoteJid = chat?.remote_jid || remoteJidInput;
  if (!remoteJid) {
    return NextResponse.json({ success: false, stage: 'frontendPayload', error: 'Nenhum chat ou remoteJid fornecido.' }, { status: 400 });
  }

  const instanceName = chat?.instance_name || (await resolveWhatsAppInstance(remoteJid)).resolvedInstanceName;
  const { data: altRows } = await admin
    .from('whatsapp_messages')
    .select('raw_payload')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .not('raw_payload', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  const altPhone = (altRows || [])
    .map((row: any) => extractPhoneFromJid(row?.raw_payload?.key?.remoteJidAlt))
    .find(Boolean) || null;

  const { data: contact } = await admin
    .from('whatsapp_contacts')
    .select('*')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const identity = resolveContactIdentity({
    contact: contact ? { ...contact, phone_number: contact.phone_number || altPhone } : { phone_number: altPhone },
    chat,
    remoteJid,
  });
  const send = resolveSendJid({ remoteJid, phoneNumber: identity.phoneNumber || altPhone });
  const endpoint = getEvolutionUrl(`/message/sendText/${instanceName}`);

  const result: any = {
    success: true,
    dryRun,
    instanceName,
    chatFound: Boolean(chat),
    contactFound: Boolean(contact),
    remoteJid,
    isLid: isLidJid(remoteJid),
    phoneNumber: identity.phoneNumber || altPhone,
    formattedPhone: identity.phoneNumber ? formatBrazilianPhone(identity.phoneNumber) : null,
    displayName: identity.displayName,
    displayNameSource: identity.displayNameSource,
    resolvedSendJid: send.sendJid,
    sendStrategy: send.sendStrategy,
    canSend: send.canSendMessage,
    reason: send.reason,
    endpoint,
    payloadPreview: {
      number: send.sendTarget || '(nao resolvido)',
      text,
      textMessage: { text },
      options: { delay: 1200, presence: 'composing', linkPreview: false },
    },
  };

  if (dryRun) return NextResponse.json(result);
  if (!send.canSendMessage || !send.sendTarget) {
    return NextResponse.json({ ...result, success: false, error: send.reason || 'Destinatario nao resolvido.' }, { status: 400 });
  }

  try {
    const response = await sendEvolutionMessage(instanceName, send.sendStrategy === 'phone_jid' ? (identity.phoneNumber || '') : send.sendTarget, text, {
      remoteJid: send.sendStrategy === 'phone_jid' ? undefined : send.sendTarget,
    });
    const now = new Date().toISOString();
    const messageId = response?.key?.id || response?.message?.key?.id || response?.id || stableMessageId([instanceName, remoteJid, now, true, text]);
    return NextResponse.json({
      ...result,
      dryRun: false,
      sent: true,
      message: { id: messageId, text, fromMe: true, status: 'sent' },
      evolutionResponse: { keyId: response?.key?.id || response?.message?.key?.id || null, status: response?.status || null },
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
