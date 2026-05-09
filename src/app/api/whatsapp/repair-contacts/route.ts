import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractPhoneFromJid,
  isLidJid,
  resolveContactDisplayName,
} from '@/lib/whatsapp-normalize';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const errors: string[] = [];
  let contactsProcessed = 0;
  let chatsProcessed = 0;
  let namesUpdated = 0;
  let phonesUpdated = 0;
  let profilePicturesUpdated = 0;
  let lidSkipped = 0;

  const { data: chats } = await admin
    .from('whatsapp_chats')
    .select('*')
    .eq('user_id', user.id)
    .limit(1000);

  const { data: contacts } = await admin
    .from('whatsapp_contacts')
    .select('*')
    .eq('user_id', user.id)
    .limit(2000);

  const contactByJid = new Map((contacts || []).map((contact: any) => [contact.remote_jid, contact]));
  const { data: altRows } = await admin
    .from('whatsapp_messages')
    .select('remote_jid, raw_payload')
    .eq('user_id', user.id)
    .not('raw_payload', 'is', null)
    .limit(5000);
  const phoneByJid = new Map<string, string>();
  for (const row of altRows || []) {
    const alt = (row as any)?.raw_payload?.key?.remoteJidAlt;
    const phone = extractPhoneFromJid(alt);
    if (phone && !phoneByJid.has((row as any).remote_jid)) phoneByJid.set((row as any).remote_jid, phone);
  }

  for (const contact of contacts || []) {
    contactsProcessed += 1;
    const phone = contact.phone_number || phoneByJid.get(contact.remote_jid) || extractPhoneFromJid(contact.remote_jid);
    if (isLidJid(contact.remote_jid) && !phone) lidSkipped += 1;
    const displayName = resolveContactDisplayName({ contact: { ...contact, phone_number: phone }, remoteJid: contact.remote_jid });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (phone && phone !== contact.phone_number) {
      patch.phone_number = phone;
      phonesUpdated += 1;
    }
    if (displayName && displayName !== contact.display_name) {
      patch.display_name = displayName;
      namesUpdated += 1;
    }
    if (Object.keys(patch).length > 1) {
      const { error } = await admin.from('whatsapp_contacts').update(patch).eq('id', contact.id);
      if (error) errors.push(`contact ${contact.id}: ${error.message}`);
    }
  }

  for (const chat of chats || []) {
    chatsProcessed += 1;
    const contact = contactByJid.get(chat.remote_jid);
    const phone = chat.phone_number || contact?.phone_number || phoneByJid.get(chat.remote_jid) || extractPhoneFromJid(chat.remote_jid);
    if (isLidJid(chat.remote_jid) && !phone) lidSkipped += 1;
    const displayName = resolveContactDisplayName({ contact, chat: { ...chat, phone_number: phone }, remoteJid: chat.remote_jid });
    const profilePic = contact?.profile_pic_url || chat.profile_pic_url || null;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (phone && phone !== chat.phone_number) {
      patch.phone_number = phone;
      phonesUpdated += 1;
    }
    if (displayName && displayName !== chat.chat_name) {
      patch.chat_name = displayName;
      patch.push_name = displayName;
      namesUpdated += 1;
    }
    if (profilePic && profilePic !== chat.profile_pic_url) {
      patch.profile_pic_url = profilePic;
      profilePicturesUpdated += 1;
    }
    if (Object.keys(patch).length > 1) {
      const { error } = await admin.from('whatsapp_chats').update(patch).eq('id', chat.id);
      if (error) errors.push(`chat ${chat.id}: ${error.message}`);
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    contactsProcessed,
    chatsProcessed,
    namesUpdated,
    phonesUpdated,
    profilePicturesUpdated,
    lidSkipped,
    errors,
  });
}
