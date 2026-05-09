import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processEvolutionMessageEvent } from '../route';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: instance } = await admin
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const instanceName = instance?.instance_name || process.env.EVOLUTION_INSTANCE_NAME || '';
  if (!instanceName) return NextResponse.json({ success: false, error: 'No instance found' }, { status: 400 });

  const messageId = `debug_webhook_${Date.now()}`;
  const payload = {
    event: 'MESSAGES_UPSERT',
    instance: instanceName,
    data: {
      key: {
        id: messageId,
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
      },
      pushName: 'Debug Webhook',
      messageType: 'conversation',
      message: { conversation: 'Mensagem teste do webhook' },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };

  const result = await processEvolutionMessageEvent(admin, payload);
  return NextResponse.json({ success: result.savedMessage, result });
}
