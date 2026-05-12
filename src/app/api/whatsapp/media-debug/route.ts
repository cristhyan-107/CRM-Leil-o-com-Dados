import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);
  const instanceName = (await resolveWhatsAppInstance()).resolvedInstanceName;
  const admin = createAdminClient();

  const { count: totalWithMedia } = await admin
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .eq('has_media', true);

  const { count: totalWithMediaUrl } = await admin
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .not('media_url', 'is', null);

  const { data: samples } = await admin
    .from('whatsapp_messages')
    .select('id, message_id, remote_jid, message_type, has_media, media_mimetype, media_filename, media_url, created_at')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .eq('has_media', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  return NextResponse.json({
    success: true,
    instanceName,
    messagesWithMedia: totalWithMedia || 0,
    messagesWithMediaUrl: totalWithMediaUrl || 0,
    mediaRouteAvailable: true,
    sample: (samples || []).map((msg: any) => ({
      messageId: msg.message_id,
      remoteJid: msg.remote_jid,
      messageType: msg.message_type,
      mimetype: msg.media_mimetype,
      filename: msg.media_filename,
      hasUrl: Boolean(msg.media_url),
      mediaEndpoint: `/api/whatsapp/messages/${msg.message_id}/media`,
      createdAt: msg.created_at,
    })),
  });
}
