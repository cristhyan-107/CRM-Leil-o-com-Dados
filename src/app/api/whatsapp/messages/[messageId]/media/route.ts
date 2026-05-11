import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBase64FromMediaMessage } from '@/lib/evolution';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ messageId: string }> }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messageId } = await ctx.params;
  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from('whatsapp_messages')
    .select('instance_name, remote_jid, message_id, message_key, from_me, media_url, media_mimetype, raw_payload')
    .eq('message_id', messageId)
    .maybeSingle();

  if (error || !message) return NextResponse.json({ error: 'Mídia não encontrada' }, { status: 404 });

  // 1. Try to get media from Evolution API (base64)
  const messageKey = message.raw_payload?.key || {
    id: message.message_key || message.message_id,
    remoteJid: message.remote_jid,
    fromMe: message.from_me,
  };

  const instanceName = message.instance_name || (await resolveWhatsAppInstance()).resolvedInstanceName;

  try {
    const result = await getBase64FromMediaMessage(instanceName, messageKey);
    const base64 = result?.base64 || result?.data?.base64 || result?.media;
    const mimetype =
      result?.mimetype ||
      result?.data?.mimetype ||
      message.media_mimetype ||
      message.raw_payload?.message?.imageMessage?.mimetype ||
      message.raw_payload?.message?.videoMessage?.mimetype ||
      message.raw_payload?.message?.audioMessage?.mimetype ||
      message.raw_payload?.message?.documentMessage?.mimetype ||
      message.raw_payload?.message?.stickerMessage?.mimetype ||
      'application/octet-stream';

    if (base64) {
      // Strip data URI prefix if present
      const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': mimetype,
          'Cache-Control': 'public, max-age=86400',
          'Content-Length': String(buffer.length),
        },
      });
    }
  } catch (err: any) {
    console.warn('[media] Evolution base64 fetch failed:', err?.message);
    // Fall through to URL redirect
  }

  // 2. Fallback: redirect to stored URL (may be expired)
  const url =
    message.media_url ||
    message.raw_payload?.message?.imageMessage?.url ||
    message.raw_payload?.message?.videoMessage?.url ||
    message.raw_payload?.message?.audioMessage?.url ||
    message.raw_payload?.message?.documentMessage?.url ||
    message.raw_payload?.message?.stickerMessage?.url;

  if (!url) return NextResponse.json({ error: 'Mídia sem URL disponível. Tente sincronizar novamente.' }, { status: 404 });

  return NextResponse.redirect(url);
}
