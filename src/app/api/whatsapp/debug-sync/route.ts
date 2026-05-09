import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getActiveInstanceName,
  syncWhatsAppChats,
} from '@/app/(app)/settings/whatsapp/actions';
import {
  getEvolutionChats,
  getEvolutionContacts,
  getEvolutionInstanceStatus,
  getEvolutionMessages,
  getEvolutionUrl,
} from '@/lib/evolution';

export const dynamic = 'force-dynamic';

export async function GET() {
  const errors: string[] = [];

  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const instanceName = await getActiveInstanceName();

    console.log('[whatsapp-debug-sync] start', {
      userId: user.id,
      instanceName,
      statusUrl: getEvolutionUrl(`/instance/connectionState/${instanceName}`),
      chatsUrl: getEvolutionUrl(`/chat/findChats/${instanceName}`),
    });

    const { data: crmInstance } = await admin
      .from('whatsapp_instances')
      .select('id, instance_name, status, sync_status')
      .eq('instance_name', instanceName)
      .maybeSingle();

    const statusPayload = await getEvolutionInstanceStatus(instanceName);
    const evolutionStatus =
      statusPayload?.instance?.state || statusPayload?.state || statusPayload?.status || 'unknown';
    const evolutionReachable = !statusPayload?.error;

    let chatsFound = 0;
    let contactsFound = 0;
    let messagesFound = 0;

    const chats = await getEvolutionChats(instanceName).catch((err) => {
      errors.push(`chats: ${err?.message || String(err)}`);
      return [];
    });
    chatsFound = chats.length;

    const contacts = await getEvolutionContacts(instanceName).catch((err) => {
      errors.push(`contacts: ${err?.message || String(err)}`);
      return [];
    });
    contactsFound = contacts.length;

    if (chats[0]?.remoteJid) {
      const messages = await getEvolutionMessages(instanceName, chats[0].remoteJid, 10).catch((err) => {
        errors.push(`messages: ${err?.message || String(err)}`);
        return [];
      });
      messagesFound = messages.length;
    }

    const syncResult = await syncWhatsAppChats();
    if (!syncResult.success) errors.push(syncResult.error || 'sync failed');

    const { data: savedChats, error: readError } = await admin
      .from('whatsapp_chats')
      .select('id')
      .eq('instance_name', instanceName)
      .limit(5);

    if (readError) errors.push(`database read: ${readError.message}`);

    return NextResponse.json({
      crmInstanceFound: Boolean(crmInstance),
      evolutionReachable,
      evolutionStatus,
      instanceName,
      chatsFound,
      contactsFound,
      messagesFound,
      databaseWriteOk: Boolean(syncResult.success),
      databaseReadOk: !readError,
      savedChatsFound: savedChats?.length || 0,
      errors,
    });
  } catch (error: any) {
    console.error('[whatsapp-debug-sync] failed', error);
    if (error?.stack) console.error(error.stack);
    errors.push(error?.message || 'Erro desconhecido');

    return NextResponse.json(
      {
        crmInstanceFound: false,
        evolutionReachable: false,
        evolutionStatus: 'unknown',
        instanceName: null,
        chatsFound: 0,
        contactsFound: 0,
        messagesFound: 0,
        databaseWriteOk: false,
        databaseReadOk: false,
        errors,
      },
      { status: 500 }
    );
  }
}
