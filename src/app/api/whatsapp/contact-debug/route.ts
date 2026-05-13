import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveContactIdentity } from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

function hasRawJid(value: unknown) {
  const text = String(value || '');
  return (
    text.includes('@s.whatsapp.net') ||
    text.includes('@c.us') ||
    text.includes('@g.us') ||
    text.includes('@lid') ||
    text.includes('@broadcast')
  );
}

function buildDuplicateGroups(items: any[], key: 'phoneNumber' | 'profilePicUrl') {
  const groups = new Map<string, any[]>();
  for (const item of items) {
    const value = String(item[key] || '').trim();
    if (!value) continue;
    const list = groups.get(value) || [];
    list.push(item);
    groups.set(value, list);
  }

  return [...groups.entries()]
    .map(([value, list]) => ({
      value,
      count: list.length,
      distinctRemoteJids: [...new Set(list.map((item) => item.chatRemoteJid))],
      classification: list.some((item) => item.isLid) ? 'medium confidence suspicious' : 'low confidence, do not touch',
      examples: list.slice(0, 5).map((item) => ({
        chatId: item.chatId,
        chatRemoteJid: item.chatRemoteJid,
        contactRemoteJid: item.contactRemoteJid,
        displayName: item.displayName,
      })),
    }))
    .filter((group) => group.distinctRemoteJids.length > 1);
}

export async function GET(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') || 30), 100);
  const admin = createAdminClient();
  const instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;

  const { data: chats, error } = await admin
    .from('whatsapp_chats')
    .select('id, instance_name, remote_jid, phone_number, chat_name, push_name, profile_pic_url, updated_at')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .or('archived.is.false,archived.is.null')
    .is('deleted_at', null)
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

  let rawJidWouldBeShown = 0;
  let lidWithoutPhone = 0;
  let chatsWithoutPhone = 0;
  let chatsWithProfilePic = 0;
  let lowConfidenceIdentities = 0;

  const items = (chats || []).map((chat: any) => {
    const contact = contactByJid.get(chat.remote_jid);
    const identity = resolveContactIdentity({ contact, chat, remoteJid: chat.remote_jid });
    const uiWouldShowPrimary = identity.displayName;
    const uiWouldShowSecondary = identity.formattedPhone || (identity.isLid ? 'Telefone nao identificado' : '');
    const wouldShowRaw = hasRawJid(uiWouldShowPrimary) || hasRawJid(uiWouldShowSecondary);

    if (wouldShowRaw) rawJidWouldBeShown += 1;
    if (identity.isLid && !identity.phoneNumber) lidWithoutPhone += 1;
    if (!identity.phoneNumber) chatsWithoutPhone += 1;
    if (identity.profilePicUrl) chatsWithProfilePic += 1;
    if (identity.identityConfidence === 'low') lowConfidenceIdentities += 1;

    return {
      chatId: chat.id,
      chatRemoteJid: chat.remote_jid,
      contactRemoteJid: contact?.remote_jid || null,
      isSameRemoteJid: Boolean(contact?.remote_jid && contact.remote_jid === chat.remote_jid),
      isLid: identity.isLid,
      displayName: identity.displayName,
      displayNameSource: identity.displayNameSource,
      formattedPhone: identity.formattedPhone,
      phoneNumber: identity.phoneNumber,
      profilePicUrl: identity.profilePicUrl,
      identityConfidence: identity.identityConfidence,
      identitySource: identity.identitySource,
      possibleWrongPhone: identity.possibleWrongPhone,
      possibleWrongProfilePic: identity.possibleWrongProfilePic,
      uiWouldShowPrimary,
      uiWouldShowSecondary,
      rawJidWouldBeShown: wouldShowRaw,
    };
  });

  const duplicatePhoneGroups = buildDuplicateGroups(items, 'phoneNumber');
  const duplicateProfilePicGroups = buildDuplicateGroups(items, 'profilePicUrl');

  return NextResponse.json({
    success: true,
    instanceName,
    summary: {
      total: items.length,
      rawJidWouldBeShown,
      duplicatePhoneGroups,
      duplicateProfilePicGroups,
      lidWithoutPhone,
      chatsWithoutPhone,
      chatsWithProfilePic,
      lowConfidenceIdentities,
    },
    items,
  });
}
