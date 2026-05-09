import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await createAdminClient()
    .from('whatsapp_webhook_events')
    .select('id, received_at, instance_name, event_raw, event_normalized, remote_jid, message_id, from_me, secret_valid, processed, saved_contact, saved_chat, saved_message, error_message')
    .order('received_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, events: data || [] });
}
