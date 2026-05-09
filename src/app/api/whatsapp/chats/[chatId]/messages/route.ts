import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { chatId } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
  const before = url.searchParams.get('before');
  const admin = createAdminClient();

  const { data: chat, error: chatError } = await admin
    .from('whatsapp_chats')
    .select('id, instance_name, remote_jid')
    .eq('id', chatId)
    .maybeSingle();

  if (chatError || !chat) {
    return NextResponse.json({ success: false, error: 'Conversa não encontrada' }, { status: 404 });
  }

  let query = admin
    .from('whatsapp_messages')
    .select('id, message_id, message_key, content, text, caption, from_me, direction, status, sent_at, created_at, message_timestamp, push_name, sender_name, remote_jid, message_type, has_media, media_mimetype, media_filename, media_url')
    .eq('instance_name', chat.instance_name)
    .eq('remote_jid', chat.remote_jid)
    .order('message_timestamp', { ascending: false, nullsFirst: false })
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(limit + 1);

  if (before) query = query.lt('message_timestamp', before);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const messages = page.reverse().map((msg: any) => ({
    id: msg.id || msg.message_id || msg.message_key,
    message_id: msg.message_id || msg.message_key,
    content: msg.content || msg.text || msg.caption || (msg.has_media ? msg.message_type : ''),
    direction: msg.from_me ? 'outbound' : (msg.direction || 'inbound'),
    status: msg.status || 'sent',
    created_at: msg.message_timestamp || msg.sent_at || msg.created_at,
    push_name: msg.sender_name || msg.push_name,
    remote_jid: msg.remote_jid,
    message_type: msg.message_type,
    has_media: msg.has_media,
    media_mimetype: msg.media_mimetype,
    media_filename: msg.media_filename,
    media_url: msg.media_url,
  }));

  return NextResponse.json({
    success: true,
    messages,
    nextCursor: hasMore ? page[page.length - 1]?.message_timestamp || page[page.length - 1]?.sent_at : null,
    hasMore,
  });
}
