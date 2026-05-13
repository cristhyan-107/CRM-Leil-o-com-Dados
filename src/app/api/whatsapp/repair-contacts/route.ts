import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractPhoneFromJid,
  formatBrazilianPhone,
  isLidJid,
  isLikelyHumanName,
  isLikelyLidNumber,
  isValidPhoneNumber,
} from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

type Change = {
  table: 'whatsapp_chats' | 'whatsapp_contacts';
  id: string;
  remoteJid: string;
  field: 'phone_number' | 'display_name' | 'chat_name' | 'push_name' | 'profile_pic_url';
  from: string | null;
  to: string | null;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
};

function cleanPhone(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function hasUsablePhone(value: unknown, remoteJid: string) {
  const phone = cleanPhone(value);
  return Boolean(phone && isValidPhoneNumber(phone) && !isLikelyLidNumber(phone, remoteJid));
}

function pushChange(changes: Change[], change: Change) {
  changes.push(change);
}

function duplicateGroups(rows: any[], field: 'phone_number' | 'profile_pic_url') {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const value = String(row[field] || '').trim();
    if (!value) continue;
    const list = groups.get(value) || [];
    list.push(row);
    groups.set(value, list);
  }

  return [...groups.entries()]
    .map(([value, list]) => ({
      value,
      count: list.length,
      remoteJids: [...new Set(list.map((row) => row.remote_jid))],
      examples: list.slice(0, 5).map((row) => ({
        id: row.id,
        remoteJid: row.remote_jid,
        name: row.chat_name || row.display_name || row.push_name || null,
      })),
    }))
    .filter((group) => group.remoteJids.length > 1);
}

async function applyChange(admin: ReturnType<typeof createAdminClient>, change: Change) {
  const patch: Record<string, unknown> = {
    [change.field]: change.to,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from(change.table).update(patch).eq('id', change.id);
  if (error) throw error;
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;
  const admin = createAdminClient();
  const instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;
  const errors: string[] = [];

  const { data: chats, error: chatsError } = await admin
    .from('whatsapp_chats')
    .select('id, remote_jid, phone_number, chat_name, push_name, profile_pic_url, updated_at')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .limit(2000);
  if (chatsError) return NextResponse.json({ success: false, dryRun, error: chatsError.message }, { status: 500 });

  const { data: contacts, error: contactsError } = await admin
    .from('whatsapp_contacts')
    .select('id, remote_jid, phone_number, display_name, push_name, verified_name, business_name, profile_pic_url, updated_at')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .limit(5000);
  if (contactsError) return NextResponse.json({ success: false, dryRun, error: contactsError.message }, { status: 500 });

  const allRows = [...(chats || []), ...(contacts || [])];
  const duplicatePhoneGroups = duplicateGroups(allRows, 'phone_number');
  const duplicateProfilePicGroups = duplicateGroups(allRows, 'profile_pic_url');
  const duplicatedProfilePics = new Set(duplicateProfilePicGroups.map((group) => group.value));
  const changes: Change[] = [];

  for (const contact of contacts || []) {
    const jid = contact.remote_jid;
    const extractedPhone = extractPhoneFromJid(jid);
    const currentPhone = cleanPhone(contact.phone_number);

    if (extractedPhone && currentPhone !== extractedPhone) {
      pushChange(changes, {
        table: 'whatsapp_contacts',
        id: contact.id,
        remoteJid: jid,
        field: 'phone_number',
        from: contact.phone_number || null,
        to: extractedPhone,
        reason: 'phone_from_same_remote_jid',
        confidence: 'high',
      });
    } else if (isLidJid(jid) && currentPhone) {
      pushChange(changes, {
        table: 'whatsapp_contacts',
        id: contact.id,
        remoteJid: jid,
        field: 'phone_number',
        from: contact.phone_number,
        to: null,
        reason: hasUsablePhone(currentPhone, jid) ? 'lid_phone_not_trusted_for_identity' : 'lid_identifier_or_invalid_phone',
        confidence: 'high',
      });
    }

    const currentNameIsRaw = !isLikelyHumanName(contact.display_name, {
      remoteJid: jid,
      phoneNumber: extractedPhone || currentPhone,
    });
    if (currentNameIsRaw && contact.display_name && contact.display_name !== 'Contato WhatsApp') {
      pushChange(changes, {
        table: 'whatsapp_contacts',
        id: contact.id,
        remoteJid: jid,
        field: 'display_name',
        from: contact.display_name,
        to: 'Contato WhatsApp',
        reason: 'display_name_would_leak_raw_identifier',
        confidence: 'high',
      });
    }

    if (isLidJid(jid) && contact.profile_pic_url && duplicatedProfilePics.has(contact.profile_pic_url)) {
      pushChange(changes, {
        table: 'whatsapp_contacts',
        id: contact.id,
        remoteJid: jid,
        field: 'profile_pic_url',
        from: contact.profile_pic_url,
        to: null,
        reason: 'duplicate_profile_pic_on_lid_suspicious',
        confidence: 'high',
      });
    }
  }

  for (const chat of chats || []) {
    const jid = chat.remote_jid;
    const extractedPhone = extractPhoneFromJid(jid);
    const currentPhone = cleanPhone(chat.phone_number);

    if (extractedPhone && currentPhone !== extractedPhone) {
      pushChange(changes, {
        table: 'whatsapp_chats',
        id: chat.id,
        remoteJid: jid,
        field: 'phone_number',
        from: chat.phone_number || null,
        to: extractedPhone,
        reason: 'phone_from_same_remote_jid',
        confidence: 'high',
      });
    } else if (isLidJid(jid) && currentPhone) {
      pushChange(changes, {
        table: 'whatsapp_chats',
        id: chat.id,
        remoteJid: jid,
        field: 'phone_number',
        from: chat.phone_number,
        to: null,
        reason: hasUsablePhone(currentPhone, jid) ? 'lid_phone_not_trusted_for_identity' : 'lid_identifier_or_invalid_phone',
        confidence: 'high',
      });
    }

    const currentChatNameIsRaw = !isLikelyHumanName(chat.chat_name, {
      remoteJid: jid,
      phoneNumber: extractedPhone || currentPhone,
    });
    if (currentChatNameIsRaw && chat.chat_name && chat.chat_name !== 'Contato WhatsApp') {
      pushChange(changes, {
        table: 'whatsapp_chats',
        id: chat.id,
        remoteJid: jid,
        field: 'chat_name',
        from: chat.chat_name,
        to: extractedPhone ? formatBrazilianPhone(extractedPhone) : 'Contato WhatsApp',
        reason: 'chat_name_would_leak_raw_identifier',
        confidence: 'high',
      });
    }

    if (isLidJid(jid) && chat.profile_pic_url && duplicatedProfilePics.has(chat.profile_pic_url)) {
      pushChange(changes, {
        table: 'whatsapp_chats',
        id: chat.id,
        remoteJid: jid,
        field: 'profile_pic_url',
        from: chat.profile_pic_url,
        to: null,
        reason: 'duplicate_profile_pic_on_lid_suspicious',
        confidence: 'high',
      });
    }
  }

  const safeChanges = changes.filter((change) => change.confidence === 'high');
  const changed: Change[] = [];

  if (!dryRun) {
    for (const change of safeChanges) {
      try {
        await applyChange(admin, change);
        changed.push(change);
      } catch (error: any) {
        errors.push(`${change.table}:${change.id}:${change.field}:${error?.message || 'erro desconhecido'}`);
      }
    }
  }

  const phoneChanges = safeChanges.filter((change) => change.field === 'phone_number');
  const profilePicChanges = safeChanges.filter((change) => change.field === 'profile_pic_url');
  const nameChanges = safeChanges.filter((change) => change.field === 'display_name' || change.field === 'chat_name' || change.field === 'push_name');

  return NextResponse.json({
    success: errors.length === 0,
    dryRun,
    contactsProcessed: contacts?.length || 0,
    chatsProcessed: chats?.length || 0,
    phonesFixed: phoneChanges.filter((change) => change.to).length,
    phonesClearedAsSuspicious: phoneChanges.filter((change) => !change.to).length,
    profilePicsFixed: 0,
    profilePicsClearedAsSuspicious: profilePicChanges.length,
    namesUpdated: nameChanges.length,
    duplicatePhoneGroupsFound: duplicatePhoneGroups.length,
    duplicateProfilePicGroupsFound: duplicateProfilePicGroups.length,
    rawJidFixed: nameChanges.length,
    wouldChange: safeChanges.slice(0, 100),
    changed: changed.slice(0, 100),
    errors,
  });
}
