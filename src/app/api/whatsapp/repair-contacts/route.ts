import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractPhoneFromJid,
  isLidJid,
  isLikelyLidNumber,
  isLikelyHumanName,
  isValidPhoneNumber,
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
    const currentPhone = String(contact.phone_number || '').replace(/\D/g, '');
    const phone = (
      isValidPhoneNumber(currentPhone) && !isLikelyLidNumber(currentPhone, contact.remote_jid)
        ? currentPhone
        : ''
    ) || crossPhone || extractPhoneFromJid(contact.remote_jid);
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
    } else if (!phone && contact.phone_number && isLikelyLidNumber(contact.phone_number, contact.remote_jid)) {
      patch.phone_number = null;
      phonesUpdated += 1;
    }

    // Only update name if it's better than current (not a JID)
    const currentNameIsRaw = !isLikelyHumanName(contact.display_name, {
      remoteJid: contact.remote_jid,
      phoneNumber: phone,
    });
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
    const currentChatPhone = String(chat.phone_number || '').replace(/\D/g, '');
    const currentContactPhone = String(contact?.phone_number || '').replace(/\D/g, '');
    const phone = (
      isValidPhoneNumber(currentChatPhone) && !isLikelyLidNumber(currentChatPhone, chat.remote_jid)
        ? currentChatPhone
        : ''
    ) || (
      isValidPhoneNumber(currentContactPhone) && !isLikelyLidNumber(currentContactPhone, chat.remote_jid)
        ? currentContactPhone
        : ''
    ) || crossPhone || extractPhoneFromJid(chat.remote_jid);
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
    } else if (!phone && chat.phone_number && isLikelyLidNumber(chat.phone_number, chat.remote_jid)) {
      patch.phone_number = null;
      phonesUpdated += 1;
    }

    // Name — only fix if current is raw or empty
    const currentChatNameIsRaw = !isLikelyHumanName(chat.chat_name, {
      remoteJid: chat.remote_jid,
      phoneNumber: phone,
    });
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
