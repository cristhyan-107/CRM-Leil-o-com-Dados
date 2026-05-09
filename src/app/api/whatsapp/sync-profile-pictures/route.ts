import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { evolutionFetch } from '@/lib/evolution';
import { extractPhoneFromJid, isLidJid } from '@/lib/whatsapp-normalize';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

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

  let processed = 0;
  let updated = 0;
  let notFound = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const chat of chats || []) {
    processed += 1;
    const phone = chat.phone_number || extractPhoneFromJid(chat.remote_jid);
    if (!phone || isLidJid(chat.remote_jid)) {
      notFound += 1;
      continue;
    }
    try {
      const payload = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instanceName}`, {
        method: 'POST',
        body: JSON.stringify({ number: phone }),
      });
      const url = payload?.profilePictureUrl || payload?.profilePicUrl || payload?.url || payload?.picture || null;
      if (!url) {
        notFound += 1;
        continue;
      }
      await admin.from('whatsapp_chats').update({ profile_pic_url: url, updated_at: new Date().toISOString() }).eq('id', chat.id);
      await admin
        .from('whatsapp_contacts')
        .update({ profile_pic_url: url, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('instance_name', instanceName)
        .eq('remote_jid', chat.remote_jid);
      updated += 1;
    } catch (err: any) {
      failed += 1;
      if (errors.length < 10) errors.push(err?.message || 'Erro ao buscar foto');
    }
  }

  return NextResponse.json({ success: true, processed, updated, notFound, failed, errors });
}
