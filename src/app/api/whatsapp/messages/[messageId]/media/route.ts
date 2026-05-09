import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ messageId: string }> }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messageId } = await ctx.params;
  const { data: message, error } = await createAdminClient()
    .from('whatsapp_messages')
    .select('media_url, media_mimetype, raw_payload')
    .eq('user_id', user.id)
    .eq('message_id', messageId)
    .maybeSingle();

  if (error || !message) return NextResponse.json({ error: 'Mídia não encontrada' }, { status: 404 });
  const url =
    message.media_url ||
    message.raw_payload?.message?.imageMessage?.url ||
    message.raw_payload?.message?.videoMessage?.url ||
    message.raw_payload?.message?.audioMessage?.url ||
    message.raw_payload?.message?.documentMessage?.url ||
    message.raw_payload?.message?.stickerMessage?.url;
  if (!url) return NextResponse.json({ error: 'Mídia sem URL disponível' }, { status: 404 });

  return NextResponse.redirect(url);
}
