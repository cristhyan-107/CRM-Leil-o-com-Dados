import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEvolutionMessage } from '@/lib/evolution';
import { formatBrazilianPhone, resolveContactIdentity } from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawPhone = String(body.phoneNumber || '').replace(/\D/g, '');
  const message = String(body.message || '').trim();

  if (rawPhone.length < 10) {
    return NextResponse.json({ success: false, error: 'Número inválido. Mínimo 10 dígitos (DDD + número).' }, { status: 400 });
  }

  const fullNumber = rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`;
  if (fullNumber.length < 12 || fullNumber.length > 13) {
    return NextResponse.json({ success: false, error: 'Número inválido. Verifique DDD e número.' }, { status: 400 });
  }

  const remoteJid = `${fullNumber}@s.whatsapp.net`;
  const formattedPhone = formatBrazilianPhone(fullNumber);
  const now = new Date().toISOString();
  const admin = createAdminClient();
  const instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;

  // Upsert chat
  const { error: chatError } = await admin.from('whatsapp_chats').upsert(
    {
      user_id: user.id,
      instance_name: instanceName,
      remote_jid: remoteJid,
      phone_number: fullNumber,
      chat_name: formattedPhone,
      push_name: formattedPhone,
      is_group: false,
      last_message_text: message || '',
      last_message_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
  );

  if (chatError) {
    return NextResponse.json({ success: false, error: `Erro ao criar conversa: ${chatError.message}` }, { status: 500 });
  }

  // Upsert contact
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
  let sendResult: any = null;
  let sendError: string | null = null;
  if (message) {
    try {
      sendResult = await sendEvolutionMessage(instanceName, fullNumber, message);
    } catch (err: any) {
      sendError = err?.message || 'Erro ao enviar mensagem';
    }
  }

  // Fetch created chat
  const { data: createdChat } = await admin
    .from('whatsapp_chats')
    .select('id')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .eq('remote_jid', remoteJid)
    .maybeSingle();

  const identity = resolveContactIdentity({
    chat: { remote_jid: remoteJid, phone_number: fullNumber, chat_name: formattedPhone },
    remoteJid,
  });

  return NextResponse.json({
    success: true,
    chat: {
      id: createdChat?.id || `new_${remoteJid}`,
      remoteJid,
      sendJid: remoteJid,
      displayName: identity.displayName,
      displayNameSource: identity.displayNameSource,
      phoneNumber: fullNumber,
      formattedPhone,
      profilePicUrl: null,
      avatarFallback: identity.avatarFallback,
      canSendMessage: true,
    },
    messageSent: message ? !sendError : null,
    sendError,
  });
}
