import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { chatId } = await ctx.params;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from('whatsapp_chats')
    .update({ archived: true, archived_at: now, updated_at: now })
    .eq('user_id', user.id)
    .eq('id', chatId)
    .is('deleted_at', null)
    .select('id, remote_jid, archived, archived_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, stage: 'archiveChat', error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: false, stage: 'archiveChat', error: 'Conversa nao encontrada.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, chat: data });
}

