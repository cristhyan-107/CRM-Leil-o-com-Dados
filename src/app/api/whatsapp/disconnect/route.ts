import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logoutEvolutionInstance } from '@/lib/evolution';
import { resolveWhatsAppInstance } from '@/app/(app)/settings/whatsapp/actions';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resolution = await resolveWhatsAppInstance();
  const instanceName = resolution.resolvedInstanceName;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  let evolutionLogout = false;
  let evolutionError: string | null = null;

  // 1. Call Evolution API to logout/disconnect
  try {
    await logoutEvolutionInstance(instanceName);
    evolutionLogout = true;
  } catch (err: any) {
    evolutionError = err?.message || 'Erro ao desconectar da Evolution API';
    console.warn('[disconnect] Evolution logout error:', evolutionError);
    // Continue — still update DB
  }

  // 2. Update whatsapp_instances status
  const { error: dbError } = await admin.from('whatsapp_instances').upsert(
    {
      user_id: user.id,
      instance_name: instanceName,
      status: 'disconnected',
      sync_status: 'idle',
      sync_error: null,
      updated_at: now,
    },
    { onConflict: 'user_id,instance_name', ignoreDuplicates: false }
  );

  if (dbError) {
    return NextResponse.json({
      success: false,
      instanceName,
      evolutionLogout,
      evolutionError,
      databaseError: dbError.message,
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    instanceName,
    evolutionLogout,
    evolutionError,
    status: 'disconnected',
    disconnectedAt: now,
    message: evolutionLogout
      ? 'WhatsApp desconectado com sucesso.'
      : `WhatsApp marcado como desconectado no CRM. Aviso: ${evolutionError}`,
  });
}
