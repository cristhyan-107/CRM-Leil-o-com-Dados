import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getEvolutionWebhook, getEvolutionWebhookUrl } from '@/lib/evolution';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

function expectedWebhookUrl() {
  return getEvolutionWebhookUrl();
}

function maskSecret(url: string) {
  if (!process.env.EVOLUTION_WEBHOOK_SECRET) return url;
  return url.replace(encodeURIComponent(process.env.EVOLUTION_WEBHOOK_SECRET), '***');
}

function extractWebhookConfig(payload: any) {
  const webhook = payload?.webhook || payload?.data?.webhook || payload?.data || payload;
  return {
    url: webhook?.url || webhook?.webhook?.url || '',
    enabled: Boolean(webhook?.enabled ?? webhook?.webhook?.enabled ?? webhook?.webhookByEvents !== undefined),
    events: webhook?.events || webhook?.webhook?.events || [],
    raw: payload,
  };
}

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const started = Date.now();
  const resolution = await resolveWhatsAppInstance();
  const instanceName = resolution.resolvedInstanceName;
  const expected = expectedWebhookUrl();

  try {
    const payload = await getEvolutionWebhook(instanceName);
    const config = extractWebhookConfig(payload);
    return NextResponse.json({
      success: true,
      instanceName,
      expectedWebhookUrl: maskSecret(expected),
      webhookConfiguredInEvolution: Boolean(config.url),
      webhookUrlMatches: config.url === expected,
      enabled: config.enabled,
      eventsEnabled: config.events,
      lastCheckedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      error: null,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      instanceName,
      expectedWebhookUrl: maskSecret(expected),
      webhookConfiguredInEvolution: false,
      webhookUrlMatches: false,
      enabled: false,
      eventsEnabled: [],
      lastCheckedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      error: error?.message || 'Falha ao consultar webhook',
    });
  }
}
