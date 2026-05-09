import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isLidJid } from '@/lib/whatsapp-normalize';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') || 20), 100);
  const admin = createAdminClient();
  const { data: chats, error } = await admin
    .from('whatsapp_chats')
    .select('id, instance_name, remote_jid, phone_number, chat_name, push_name, profile_pic_url, raw_payload, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const remoteJids = (chats || []).map((chat) => chat.remote_jid);
  const { data: contacts } = await admin
    .from('whatsapp_contacts')
    .select('remote_jid, phone_number, display_name, push_name, verified_name, profile_pic_url, raw_payload')
    .eq('user_id', user.id)
    .in('remote_jid', remoteJids.length ? remoteJids : ['']);
  const contactByJid = new Map((contacts || []).map((contact: any) => [contact.remote_jid, contact]));

  return NextResponse.json({
    success: true,
    items: (chats || []).map((chat: any) => {
      const contact: any = contactByJid.get(chat.remote_jid) || {};
      return {
        chatId: chat.id,
        remoteJid: chat.remote_jid,
        isLid: isLidJid(chat.remote_jid),
        phoneNumber: contact.phone_number || chat.phone_number || null,
        displayName: contact.display_name || chat.chat_name || null,
        pushName: contact.push_name || chat.push_name || null,
        verifiedName: contact.verified_name || null,
        businessName: contact.raw_payload?.businessName || contact.raw_payload?.business_name || null,
        profilePicUrl: contact.profile_pic_url || chat.profile_pic_url || null,
        rawKeys: Array.from(new Set([
          ...Object.keys(chat.raw_payload || {}),
          ...Object.keys(contact.raw_payload || {}),
        ])).slice(0, 40),
      };
    }),
  });
}
