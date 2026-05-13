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

  const { data: typeRows } = await admin
    .from('whatsapp_messages')
    .select('message_type')
    .eq('user_id', user.id)
    .eq('instance_name', instanceName)
    .eq('has_media', true)
    .limit(5000);

  const byType = {
    image: 0,
    audio: 0,
    document: 0,
    video: 0,
    sticker: 0,
    other: 0,
  };
  for (const row of typeRows || []) {
    const type = String((row as any).message_type || '').toLowerCase();
    if (type.includes('image')) byType.image += 1;
    else if (type.includes('audio')) byType.audio += 1;
    else if (type.includes('document')) byType.document += 1;
    else if (type.includes('video')) byType.video += 1;
    else if (type.includes('sticker')) byType.sticker += 1;
    else byType.other += 1;
  }

  return NextResponse.json({
    success: true,
    instanceName,
    messagesWithMedia: totalWithMedia || 0,
    messagesWithMediaUrl: totalWithMediaUrl || 0,
    messagesWithBase64Available: 'on_demand',
    byType,
    mediaRouteAvailable: true,
    samples: (samples || []).map((msg: any) => ({
      messageId: msg.message_id,
      databaseId: msg.id,
      remoteJid: msg.remote_jid,
      messageType: msg.message_type,
      hasMedia: Boolean(msg.has_media),
      mimetype: msg.media_mimetype,
      filename: msg.media_filename,
      hasUrl: Boolean(msg.media_url),
      mediaRoute: `/api/whatsapp/messages/${msg.id}/media`,
      canFetch: true,
      error: null,
      createdAt: msg.created_at,
    })),
  });
}
