import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { evolutionFetch } from '@/lib/evolution';
import { extractPhoneFromJid, isValidPhoneNumber } from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

function pickPictureUrl(payload: any) {
  return payload?.profilePictureUrl || payload?.profilePicUrl || payload?.url || payload?.picture || null;
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit || 50), 100);
  const onlyMissing = body.onlyMissing !== false;
  const instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;
  const admin = createAdminClient();

  let query = admin
    .from('whatsapp_chats')
    .select('id, remote_jid, phone_number, profile_pic_url')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (onlyMissing) query = query.is('profile_pic_url', null);

  const { data: chats, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const remoteJids = (chats || []).map((chat: any) => chat.remote_jid).filter(Boolean);
  const { data: contacts } = await admin
    .from('whatsapp_contacts')
    .select('remote_jid, phone_number, profile_pic_url')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .in('remote_jid', remoteJids.length ? remoteJids : ['']);
  const contactByJid = new Map((contacts || []).map((contact: any) => [contact.remote_jid, contact]));

  let processed = 0;
  let updated = 0;
  let notFound = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const chat of chats || []) {
    processed += 1;
    const contact = contactByJid.get(chat.remote_jid);
    const existingUrl = contact?.profile_pic_url || chat.profile_pic_url;
    if (existingUrl) {
      if (!chat.profile_pic_url) {
        await admin.from('whatsapp_chats').update({ profile_pic_url: existingUrl, updated_at: new Date().toISOString() }).eq('id', chat.id);
        updated += 1;
      }
      continue;
    }

    const phone = chat.phone_number || contact?.phone_number || extractPhoneFromJid(chat.remote_jid);
    const target = isValidPhoneNumber(phone) ? phone : chat.remote_jid;

    try {
      const payload = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instanceName}`, {
        method: 'POST',
        body: JSON.stringify({ number: target }),
      });
      const url = pickPictureUrl(payload);
      if (!url) {
        notFound += 1;
        continue;
      }

      await admin.from('whatsapp_chats').update({ profile_pic_url: url, updated_at: new Date().toISOString() }).eq('id', chat.id);
      await admin
        .from('whatsapp_contacts')
        .upsert(
          {
            user_id: user.id,
            instance_name: instanceName,
            remote_jid: chat.remote_jid,
            phone_number: isValidPhoneNumber(phone) ? phone : null,
            profile_pic_url: url,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,instance_name,remote_jid', ignoreDuplicates: false }
        );
      updated += 1;
    } catch (err: any) {
      failed += 1;
      if (errors.length < 10) errors.push(err?.message || 'Erro ao buscar foto');
    }
  }

  return NextResponse.json({ success: failed === 0, processed, updated, notFound, failed, errors });
}
