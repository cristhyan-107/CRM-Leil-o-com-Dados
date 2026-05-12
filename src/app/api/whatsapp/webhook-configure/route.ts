import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getEvolutionWebhook, getEvolutionWebhookUrl, updateEvolutionWebhook } from '@/lib/evolution';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

function expectedWebhookUrl() {
  return getEvolutionWebhookUrl();
}

function extractUrl(payload: any) {
  const webhook = payload?.webhook || payload?.data?.webhook || payload?.data || payload;
  return webhook?.url || webhook?.webhook?.url || '';
}

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timeout: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    clearTimeout(timeout!);
  }
}

export async function POST() {
  const started = Date.now();
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resolution = await resolveWhatsAppInstance();
  const instanceName = resolution.resolvedInstanceName;
  const expected = expectedWebhookUrl();

  try {
    const current = await withTimeout(getEvolutionWebhook(instanceName), 10000).catch(() => null);
    if (current && extractUrl(current) === expected) {
      return NextResponse.json({
        success: true,
        action: 'skipped_already_configured',
        message: 'Webhook já estava configurado corretamente.',
        durationMs: Date.now() - started,
      });
    }

    await withTimeout(updateEvolutionWebhook(instanceName), 10000);
    return NextResponse.json({
      success: true,
      action: 'updated',
      message: 'Webhook atualizado.',
      durationMs: Date.now() - started,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      action: 'failed',
      message: error?.message === 'timeout' ? 'Falha ao atualizar webhook: tempo limite.' : 'Falha ao atualizar webhook.',
      durationMs: Date.now() - started,
    }, { status: 500 });
  }
}
