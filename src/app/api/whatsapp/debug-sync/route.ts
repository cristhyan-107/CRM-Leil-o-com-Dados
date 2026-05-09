import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  resolveWhatsAppInstance,
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

async function tableExists(admin: ReturnType<typeof createAdminClient>, table: string) {
  const { error } = await admin.from(table).select('id').limit(1);
  return !error;
}

async function countRows(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  instanceName: string
) {
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('instance_name', instanceName);
  return error ? 0 : count || 0;
}

async function hasUniqueConstraint(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  conflict: string,
  instanceName: string
) {
  const { data } = await admin
    .from(table)
    .select('*')
    .eq('instance_name', instanceName)
    .limit(1)
    .maybeSingle();

  if (!data) return false;

  const { error } = await admin
    .from(table)
    .upsert(data, { onConflict: conflict, ignoreDuplicates: false })
    .select('id')
    .limit(1);

  return !error;
}

export async function GET() {
  const errors: string[] = [];

  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const resolution = await resolveWhatsAppInstance();
    const instanceName = resolution.resolvedInstanceName;
    const instanceNameSource = resolution.source;

    console.log('[whatsapp-debug-sync] start', {
      userId: user.id,
      resolvedInstanceName: instanceName,
      instanceNameSource,
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

    const schema = {
      whatsappInstancesExists: await tableExists(admin, 'whatsapp_instances'),
      whatsappContactsExists: await tableExists(admin, 'whatsapp_contacts'),
      whatsappChatsUniqueConstraint: await hasUniqueConstraint(
        admin,
        'whatsapp_chats',
        'user_id,instance_name,remote_jid',
        instanceName
      ),
      whatsappMessagesUniqueConstraint: await hasUniqueConstraint(
        admin,
        'whatsapp_messages',
        'user_id,instance_name,remote_jid,message_id',
        instanceName
      ),
    };

    const savedData = {
      instancesSaved: await countRows(admin, 'whatsapp_instances', instanceName),
      contactsSaved: await countRows(admin, 'whatsapp_contacts', instanceName),
      chatsSaved: await countRows(admin, 'whatsapp_chats', instanceName),
      messagesSaved: await countRows(admin, 'whatsapp_messages', instanceName),
    };

    return NextResponse.json({
      crmInstanceFound: Boolean(crmInstance) || instanceNameSource === 'database',
      evolutionReachable,
      evolutionStatus,
      instanceName,
      resolvedInstanceName: instanceName,
      instanceNameSource,
      chatsFound,
      contactsFound,
      messagesFound,
      databaseWriteOk: Boolean(syncResult.success),
      databaseReadOk: !readError,
      savedChatsFound: savedChats?.length || 0,
      syncSummary: syncResult.summary || null,
      schema,
      savedData,
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
        resolvedInstanceName: null,
        instanceNameSource: null,
        chatsFound: 0,
        contactsFound: 0,
        messagesFound: 0,
        databaseWriteOk: false,
        databaseReadOk: false,
        schema: {
          whatsappInstancesExists: false,
          whatsappContactsExists: false,
          whatsappChatsUniqueConstraint: false,
          whatsappMessagesUniqueConstraint: false,
        },
        savedData: {
          instancesSaved: 0,
          contactsSaved: 0,
          chatsSaved: 0,
          messagesSaved: 0,
        },
        errors,
      },
      { status: 500 }
    );
  }
}
