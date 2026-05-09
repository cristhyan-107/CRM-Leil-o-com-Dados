import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractMessageText, getEvolutionMessages } from '@/lib/evolution';
import { extractPhoneFromJid, stableMessageId } from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mode = body.mode || 'selectedChat';
  const limitPerChat = Math.min(Number(body.limitPerChat || 500), 500);
  const admin = createAdminClient();
  const instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;
  let chats: Array<{ id: string; remote_jid: string }> = [];

  if (mode === 'selectedChat' && body.chatId) {
    const { data } = await admin.from('whatsapp_chats').select('id, remote_jid').eq('id', body.chatId).maybeSingle();
    if (data) chats = [data];
  } else {
    const { data } = await admin
      .from('whatsapp_chats')
      .select('id, remote_jid')
      .eq('user_id', user.id)
      .eq('instance_name', instanceName)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(mode === 'allChats' ? 10 : 5);
    chats = data || [];
  }

  let imported = 0;
  const errors: Array<{ remoteJid: string; error: string }> = [];
  for (const chat of chats) {
    try {
      const messages = await getEvolutionMessages(instanceName, chat.remote_jid, limitPerChat);
      const rows = messages.map((msg: any) => {
        const remoteJid = msg.key?.remoteJid || chat.remote_jid;
        const content = extractMessageText(msg.message);
        const sentAt = msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString();
        const messageId = msg.key?.id || stableMessageId([instanceName, remoteJid, sentAt, msg.key?.fromMe, content]);
        return {
          user_id: user.id,
          instance_name: instanceName,
          remote_jid: remoteJid,
          message_id: messageId,
          message_key: messageId,
          from_me: Boolean(msg.key?.fromMe),
          push_name: msg.pushName || null,
          message_type: msg.messageType || 'conversation',
          content,
          text: content || null,
          status: msg.status || 'sent',
          sent_at: sentAt,
          created_at: sentAt,
          updated_at: new Date().toISOString(),
          message_timestamp: sentAt,
          phone_normalized: extractPhoneFromJid(remoteJid) || null,
          direction: msg.key?.fromMe ? 'outbound' : 'inbound',
          provider: 'evolution',
          raw_payload: msg,
        };
      });
      if (rows.length) {
        const { data, error } = await admin
          .from('whatsapp_messages')
          .upsert(rows, { onConflict: 'user_id,instance_name,remote_jid,message_id', ignoreDuplicates: false })
          .select('id');
        if (error) throw error;
        imported += data?.length || rows.length;
      }
    } catch (error: any) {
      errors.push({ remoteJid: chat.remote_jid, error: error?.message || 'Erro ao sincronizar histórico' });
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    mode,
    chatsProcessed: chats.length,
    imported,
    message: imported > 0 ? `Foram importadas ${imported} mensagens antigas.` : 'Não há mais mensagens disponíveis pela Evolution API.',
    errors,
  });
}
