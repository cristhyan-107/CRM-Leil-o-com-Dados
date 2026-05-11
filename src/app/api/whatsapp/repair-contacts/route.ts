import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractPhoneFromJid,
  isLidJid,
  resolveContactIdentity,
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
  let rawJidFixed = 0;

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

  // Cross-reference phone numbers from messages raw_payload
  const { data: altRows } = await admin
    .from('whatsapp_messages')
    .select('remote_jid, raw_payload')
    .eq('user_id', user.id)
    .not('raw_payload', 'is', null)
    .limit(5000);
  const phoneByJid = new Map<string, string>();
  for (const row of altRows || []) {
    const alt = (row as any)?.raw_payload?.key?.remoteJidAlt;
    const participant = (row as any)?.raw_payload?.key?.participant;
    const phone = extractPhoneFromJid(alt) || extractPhoneFromJid(participant);
    if (phone && !phoneByJid.has((row as any).remote_jid)) {
      phoneByJid.set((row as any).remote_jid, phone);
    }
  }

  // Fix contacts
  for (const contact of contacts || []) {
    contactsProcessed += 1;
    const crossPhone = phoneByJid.get(contact.remote_jid);
    const phone = contact.phone_number || crossPhone || extractPhoneFromJid(contact.remote_jid);
    if (isLidJid(contact.remote_jid) && !phone) {
      lidSkipped += 1;
    }

    const identity = resolveContactIdentity({
      contact: { ...contact, phone_number: phone },
      remoteJid: contact.remote_jid,
    });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Only update phone if we found one and it's different
    if (phone && phone !== contact.phone_number) {
      patch.phone_number = phone;
      phonesUpdated += 1;
    }

    // Only update name if it's better than current (not a JID)
    const currentNameIsRaw = !contact.display_name ||
      contact.display_name.includes('@s.whatsapp.net') ||
      contact.display_name.includes('@lid') ||
      contact.display_name.includes('@c.us') ||
      contact.display_name.includes('@g.us');
    if (identity.displayName && identity.displayNameSource !== 'fallback' && currentNameIsRaw) {
      patch.display_name = identity.displayName;
      namesUpdated += 1;
      if (currentNameIsRaw && contact.display_name) rawJidFixed += 1;
    }

    if (Object.keys(patch).length > 1) {
      const { error } = await admin.from('whatsapp_contacts').update(patch).eq('id', contact.id);
      if (error) errors.push(`contact ${contact.id}: ${error.message}`);
    }
  }

  // Fix chats
  for (const chat of chats || []) {
    chatsProcessed += 1;
    const contact = contactByJid.get(chat.remote_jid);
    const crossPhone = phoneByJid.get(chat.remote_jid);
    const phone = chat.phone_number || contact?.phone_number || crossPhone || extractPhoneFromJid(chat.remote_jid);
    if (isLidJid(chat.remote_jid) && !phone) {
      lidSkipped += 1;
    }

    const identity = resolveContactIdentity({
      contact,
      chat: { ...chat, phone_number: phone },
      remoteJid: chat.remote_jid,
    });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Phone
    if (phone && phone !== chat.phone_number) {
      patch.phone_number = phone;
      phonesUpdated += 1;
    }

    // Name — only fix if current is raw or empty
    const currentChatNameIsRaw = !chat.chat_name ||
      chat.chat_name.includes('@s.whatsapp.net') ||
      chat.chat_name.includes('@lid') ||
      chat.chat_name.includes('@c.us') ||
      chat.chat_name.includes('@g.us');
    if (identity.displayName && identity.displayNameSource !== 'fallback' && currentChatNameIsRaw) {
      patch.chat_name = identity.displayName;
      patch.push_name = identity.displayName;
      namesUpdated += 1;
      if (currentChatNameIsRaw && chat.chat_name) rawJidFixed += 1;
    }

    // Profile pic — never overwrite good with null
    if (contact?.profile_pic_url && !chat.profile_pic_url) {
      patch.profile_pic_url = contact.profile_pic_url;
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
    rawJidFixed,
    errors,
  });
}
