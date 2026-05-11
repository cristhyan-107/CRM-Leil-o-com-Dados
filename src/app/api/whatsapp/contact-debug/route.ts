import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveContactIdentity } from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') || 30), 100);
  const admin = createAdminClient();
  const instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;

  const { data: chats, error } = await admin
    .from('whatsapp_chats')
    .select('id, instance_name, remote_jid, phone_number, chat_name, push_name, profile_pic_url, updated_at')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const remoteJids = (chats || []).map((chat: any) => chat.remote_jid).filter(Boolean);
  const { data: contacts } = await admin
    .from('whatsapp_contacts')
    .select('remote_jid, phone_number, display_name, push_name, verified_name, business_name, profile_pic_url')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .in('remote_jid', remoteJids.length ? remoteJids : ['']);
  const contactByJid = new Map((contacts || []).map((c: any) => [c.remote_jid, c]));

  let lidCount = 0;
  let groupCount = 0;
  let withPhone = 0;
  let withDisplayName = 0;
  let withProfilePic = 0;
  let canSendMessageCount = 0;
  let rawJidWouldBeShown = 0;

  const items = (chats || []).map((chat: any) => {
    const contact = contactByJid.get(chat.remote_jid);
    const identity = resolveContactIdentity({ contact, chat, remoteJid: chat.remote_jid });

    if (identity.isLid) lidCount++;
    if (identity.isGroup) groupCount++;
    if (identity.phoneNumber) withPhone++;
    if (identity.displayNameSource !== 'fallback' && identity.displayNameSource !== 'jid_phone') withDisplayName++;
    if (identity.profilePicUrl) withProfilePic++;
    if (identity.canSendMessage) canSendMessageCount++;

    // Check if raw JID would leak into UI
    const wouldShowRaw =
      identity.displayName.includes('@s.whatsapp.net') ||
      identity.displayName.includes('@c.us') ||
      identity.displayName.includes('@g.us') ||
      identity.displayName.includes('@lid') ||
      identity.displayName.includes('@broadcast');
    if (wouldShowRaw) rawJidWouldBeShown++;

    return {
      chatId: chat.id,
      remoteJid: chat.remote_jid,
      isLid: identity.isLid,
      isGroup: identity.isGroup,
      displayName: identity.displayName,
      displayNameSource: identity.displayNameSource,
      phoneNumber: identity.phoneNumber,
      formattedPhone: identity.formattedPhone,
      profilePicUrl: identity.profilePicUrl,
      sendJid: identity.sendJid,
      canSendMessage: identity.canSendMessage,
      avatarFallback: identity.avatarFallback,
      uiWouldShowPrimary: identity.displayName,
      uiWouldShowSecondary: identity.formattedPhone || '',
      rawJidWouldBeShown: wouldShowRaw,
    };
  });

  return NextResponse.json({
    success: true,
    items,
    summary: {
      total: items.length,
      lidCount,
      groupCount,
      withPhone,
      withDisplayName,
      withProfilePic,
      canSendMessage: canSendMessageCount,
      rawJidWouldBeShown,
    },
  });
}
