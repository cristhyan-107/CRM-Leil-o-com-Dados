import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBase64FromMediaMessage } from '@/lib/evolution';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';
import { getMessageMediaInfo } from '@/lib/whatsapp-normalize';

export const dynamic = 'force-dynamic';

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mediaNode(rawPayload: any) {
  return (
    rawPayload?.message?.imageMessage ||
    rawPayload?.message?.videoMessage ||
    rawPayload?.message?.audioMessage ||
    rawPayload?.message?.documentMessage ||
    rawPayload?.message?.stickerMessage ||
    null
  );
}

function safeMediaUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}
function contentDisposition(mimetype: string, filename: string) {
  const inline =
    mimetype.startsWith('image/') ||
    mimetype.startsWith('audio/') ||
    mimetype.startsWith('video/');
  const safeName = filename.replace(/["\r\n]/g, '_') || 'whatsapp-media';
  return `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`;
}

async function findMessage(admin: ReturnType<typeof createAdminClient>, userId: string, token: string, remoteJid?: string | null) {
  const baseSelect = 'id, instance_name, remote_jid, message_id, message_key, from_me, media_url, media_mimetype, media_filename, message_type, raw_payload';

  if (isUuid(token)) {
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select(baseSelect)
      .eq('user_id', userId)
      .eq('id', token)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  let query = admin
    .from('whatsapp_messages')
    .select(baseSelect)
    .eq('user_id', userId)
    .eq('message_id', token)
    .order('created_at', { ascending: false })
    .limit(2);

  if (remoteJid) query = query.eq('remote_jid', remoteJid);

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return null;
  if (data.length > 1 && !remoteJid) {
    const err = new Error('message_id ambiguo; use o id interno da mensagem ou remoteJid.');
    (err as any).stage = 'messageLookup';
    throw err;
  }
  return data[0];
}

export async function GET(req: Request, ctx: { params: Promise<{ messageId: string }> }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, stage: 'auth', message: 'Unauthorized' }, { status: 401 });

  const { messageId } = await ctx.params;
  const remoteJid = new URL(req.url).searchParams.get('remoteJid');
  const admin = createAdminClient();
  let message: any = null;

  try {
    message = await findMessage(admin, user.id, decodeURIComponent(messageId), remoteJid);
    if (!message) {
      return NextResponse.json(
        { success: false, stage: 'messageLookup', messageId, message: 'Midia nao encontrada.' },
        { status: 404 }
      );
    }

    const rawMedia = getMessageMediaInfo(message.raw_payload?.message);
    const node = mediaNode(message.raw_payload);
    const mimetype =
      message.media_mimetype ||
      rawMedia.mimetype ||
      node?.mimetype ||
      'application/octet-stream';
    const filename =
      message.media_filename ||
      rawMedia.filename ||
      node?.fileName ||
      node?.filename ||
      'whatsapp-media';

    const messageKey = message.raw_payload?.key || {
      id: message.message_key || message.message_id,
      remoteJid: message.remote_jid,
      fromMe: message.from_me,
    };
    const instanceName = message.instance_name || (await resolveWhatsAppInstance()).resolvedInstanceName;

    try {
      const result = await getBase64FromMediaMessage(instanceName, messageKey);
      const base64 = result?.base64 || result?.data?.base64 || result?.media;
      if (base64) {
        const cleanBase64 = String(base64).replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        if (buffer.length === 0) {
          throw new Error('Base64 vazio retornado pela Evolution.');
        }
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': mimetype,
            'Content-Disposition': contentDisposition(mimetype, filename),
            'Cache-Control': 'private, max-age=3600',
            'Content-Length': String(buffer.length),
          },
        });
      }
    } catch (error: any) {
      console.warn('[whatsapp-media] evolution media fetch failed', {
        messageId: message.message_id,
        dbId: message.id,
        remoteJid: message.remote_jid,
        messageType: message.message_type,
        error: error?.message,
      });
    }

    const url =
      safeMediaUrl(message.media_url) ||
      safeMediaUrl(node?.url);
    if (url) return NextResponse.redirect(url);

    return NextResponse.json(
      {
        success: false,
        stage: 'evolutionMediaFetch',
        messageId: message.message_id,
        messageType: message.message_type,
        mimetype,
        message: 'Nao foi possivel carregar a midia pela Evolution e nao ha URL valida salva.',
      },
      { status: 404 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        stage: error?.stage || 'messageLookup',
        messageId,
        messageType: message?.message_type || null,
        mimetype: message?.media_mimetype || null,
        message: error?.message || 'Erro ao carregar midia.',
      },
      { status: 500 }
    );
  }
}
