import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { EvolutionApiError, getEvolutionUrl, sendEvolutionMessage } from '@/lib/evolution';
import {
  extractPhoneFromJid,
  isLidJid,
  normalizeWhatsAppJid,
  stableMessageId,
} from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

function friendlySendError(error: unknown) {
  if (error instanceof EvolutionApiError) {
    if (error.status === 401 || error.status === 403) return 'API key da Evolution inválida.';
    if (error.status === 404) return 'Instância não encontrada ou endpoint de envio incorreto.';
    return `Evolution retornou erro HTTP ${error.status}.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes('remotejid')) return 'remoteJid inválido.';
  return message || 'Erro ao enviar mensagem.';
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const remoteJid = normalizeWhatsAppJid(body.remoteJid);
  const text = String(body.text || '').trim();
  if (!remoteJid) return NextResponse.json({ success: false, error: 'remoteJid inválido' }, { status: 400 });
  if (!text) return NextResponse.json({ success: false, error: 'Mensagem vazia' }, { status: 400 });

  const admin = createAdminClient();
  const { data: chat } = await admin
    .from('whatsapp_chats')
    .select('id, user_id, instance_name, remote_jid, phone_number')
    .eq('remote_jid', remoteJid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const instanceName = chat?.instance_name || (await resolveWhatsAppInstance(remoteJid)).resolvedInstanceName;
  const { data: contact } = await admin
    .from('whatsapp_contacts')
    .select('phone_number')
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: altMessage } = await admin
    .from('whatsapp_messages')
    .select('raw_payload')
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .order('created_at', { ascending: false })
    .limit(20);

  const altJid = (altMessage || [])
    .map((row: any) => row?.raw_payload?.key?.remoteJidAlt)
    .find(Boolean) || '';
  const phone = contact?.phone_number || chat?.phone_number || extractPhoneFromJid(altJid) || extractPhoneFromJid(remoteJid);
  const diagnostics = {
    stage: 'evolutionSend',
    endpoint: getEvolutionUrl(`/message/sendText/${instanceName}`),
    instanceName,
    remoteJid,
    resolvedSendJid: altJid || remoteJid,
    phoneNumber: phone || null,
    isLid: isLidJid(remoteJid),
    phoneResolved: Boolean(phone),
  };

  if (!phone) {
    return NextResponse.json(
      {
        success: false,
        stage: 'normalizeRemoteJid',
        instanceName,
        remoteJid,
        resolvedSendJid: altJid || remoteJid,
        phoneNumber: null,
        isLid: isLidJid(remoteJid),
        evolutionEndpoint: diagnostics.endpoint,
        evolutionStatusCode: null,
        evolutionResponse: null,
        databaseError: null,
        error: 'Não foi possível identificar telefone real para este contato.',
        details: diagnostics,
      },
      { status: 400 }
    );
  }

  try {
    console.log('[whatsapp-send] sending', diagnostics);
    const response = await sendEvolutionMessage(instanceName, phone, text);
    const now = new Date().toISOString();
    const messageId =
      response?.key?.id ||
      response?.id ||
      stableMessageId([instanceName, remoteJid, now, true, text]);

    const row = {
      user_id: chat?.user_id || user.id,
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

    const { error: chatError } = await admin
      .from('whatsapp_chats')
      .upsert(
        {
          user_id: row.user_id,
          instance_name: instanceName,
          remote_jid: remoteJid,
          phone_number: phone,
          last_message: text,
          last_message_text: text,
          last_message_at: now,
          unread_count: 0,
          pipeline_stage: 'new',
          updated_at: now,
        },
        { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
      );
    if (chatError) throw chatError;

    return NextResponse.json({ success: true, message: saved, diagnostics });
  } catch (error: any) {
    console.error('[whatsapp-send] failed', {
      ...diagnostics,
      status: error?.status,
      message: error?.message,
    });
    return NextResponse.json(
      {
        success: false,
        stage: error instanceof EvolutionApiError ? 'evolutionSend' : 'databaseSave',
        instanceName,
        remoteJid,
        resolvedSendJid: altJid || remoteJid,
        phoneNumber: phone || null,
        isLid: isLidJid(remoteJid),
        evolutionEndpoint: diagnostics.endpoint,
        evolutionStatusCode: error?.status || null,
        evolutionResponse: error instanceof EvolutionApiError ? safeJson(error.body) : null,
        databaseError: error instanceof EvolutionApiError ? null : {
          code: error?.code,
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
        },
        error: friendlySendError(error),
        details: {
          ...diagnostics,
          statusCode: error?.status || null,
          response: error instanceof EvolutionApiError ? error.body : error?.message,
        },
      },
      { status: error instanceof EvolutionApiError ? 502 : 500 }
    );
  }
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
