import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  resolveWhatsAppInstance,
  syncWhatsAppChats,
} from '@/app/(app)/settings/whatsapp/actions';
import {
  EvolutionApiError,
  evolutionFetch,
  getEvolutionChats,
  getEvolutionContacts,
  getEvolutionMessages,
  getEvolutionUrl,
} from '@/lib/evolution';

export const dynamic = 'force-dynamic';

type DebugStage =
  | 'env'
  | 'evolution.status'
  | 'evolution.chats'
  | 'evolution.contacts'
  | 'evolution.messages'
  | 'database';

function stageError(
  stage: DebugStage,
  error: unknown,
  resolvedInstanceName: string | null,
  apiUrlReachable = false
) {
  const statusCode = error instanceof EvolutionApiError ? error.status : undefined;
  const details = error instanceof EvolutionApiError
    ? error.body
    : error instanceof Error
    ? error.message
    : String(error);

  return NextResponse.json(
    {
      success: false,
      stage,
      statusCode,
      message: friendlyEvolutionError(stage, statusCode, details),
      resolvedInstanceName,
      apiUrlReachable,
      details,
    },
    { status: 200 }
  );
}

function friendlyEvolutionError(stage: DebugStage, statusCode?: number, details?: string) {
  if (stage === 'env' && details?.includes('EVOLUTION_API_KEY')) {
    return 'EVOLUTION_API_KEY ausente ou inválida.';
  }
  if (stage === 'env' && details?.includes('EVOLUTION_INSTANCE_NAME')) {
    return 'EVOLUTION_INSTANCE_NAME ausente no ambiente.';
  }
  if (stage === 'env') return details || 'Variável de ambiente ausente.';
  if (statusCode === 401 || statusCode === 403) return 'EVOLUTION_API_KEY ausente ou inválida.';
  if (statusCode === 404) return 'Instância não encontrada na Evolution.';
  if (details?.toLowerCase().includes('fetch')) return 'Evolution API fora do ar ou inacessível.';
  return 'Erro ao consultar Evolution API.';
}

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
    const missingEnv = [
      'EVOLUTION_API_URL',
      'EVOLUTION_API_KEY',
    ].filter((name) => !process.env[name]);

    if (missingEnv.length > 0) {
      return stageError(
        'env',
        new Error(
          missingEnv.includes('EVOLUTION_INSTANCE_NAME')
            ? 'EVOLUTION_INSTANCE_NAME ausente no ambiente.'
            : `Variável de ambiente ausente: ${missingEnv.join(', ')}`
        ),
        null,
        false
      );
    }

    const envWarnings = !process.env.EVOLUTION_INSTANCE_NAME
      ? ['EVOLUTION_INSTANCE_NAME ausente no ambiente.']
      : [];

    const resolution = await resolveWhatsAppInstance();
    const instanceName = resolution.resolvedInstanceName;
    const instanceNameSource = resolution.source;

    console.log('[whatsapp-debug-sync] start', {
      userId: user.id,
      resolvedInstanceName: instanceName,
      instanceNameSource,
      envInstanceNamePresent: Boolean(process.env.EVOLUTION_INSTANCE_NAME),
      envWarnings,
      statusUrl: getEvolutionUrl(`/instance/connectionState/${instanceName}`),
      chatsUrl: getEvolutionUrl(`/chat/findChats/${instanceName}`),
    });

    const { data: crmInstance } = await admin
      .from('whatsapp_instances')
      .select('id, instance_name, status, sync_status')
      .eq('instance_name', instanceName)
      .maybeSingle();

    let statusPayload: any;
    try {
      statusPayload = await evolutionFetch(`/instance/connectionState/${instanceName}`);
    } catch (error) {
      return stageError('evolution.status', error, instanceName, true);
    }
    const evolutionStatus =
      statusPayload?.instance?.state || statusPayload?.state || statusPayload?.status || 'unknown';
    const evolutionReachable = true;

    let chatsFound = 0;
    let contactsFound = 0;
    let messagesFound = 0;

    let chats;
    try {
      chats = await getEvolutionChats(instanceName);
    } catch (error) {
      return stageError('evolution.chats', error, instanceName, true);
    }
    chatsFound = chats.length;

    let contacts;
    try {
      contacts = await getEvolutionContacts(instanceName);
    } catch (error) {
      return stageError('evolution.contacts', error, instanceName, true);
    }
    contactsFound = contacts.length;

    if (chats[0]?.remoteJid) {
      let messages;
      try {
        messages = await getEvolutionMessages(instanceName, chats[0].remoteJid, 10);
      } catch (error) {
        return stageError('evolution.messages', error, instanceName, true);
      }
      messagesFound = messages.length;
    }

    const syncResult = await syncWhatsAppChats();
    if (!syncResult.success) errors.push(syncResult.error || 'sync failed');

    const { count: savedChatsCount, error: readError } = await admin
      .from('whatsapp_chats')
      .select('id', { count: 'exact', head: true })
      .eq('instance_name', instanceName);

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
      success: errors.length === 0,
      crmInstanceFound: Boolean(crmInstance) || instanceNameSource === 'database',
      evolutionReachable,
      evolutionStatus,
      instanceName,
      resolvedInstanceName: instanceName,
      instanceNameSource,
      env: {
        EVOLUTION_API_URL: Boolean(process.env.EVOLUTION_API_URL),
        EVOLUTION_API_KEY: Boolean(process.env.EVOLUTION_API_KEY),
        EVOLUTION_INSTANCE_NAME: Boolean(process.env.EVOLUTION_INSTANCE_NAME),
      },
      chatsFound,
      contactsFound,
      messagesFound,
      databaseWriteOk: Boolean(syncResult.success),
      databaseReadOk: !readError,
      savedChatsFound: savedChatsCount || 0,
      syncSummary: syncResult.summary || null,
      schema,
      savedData,
      errors: [...envWarnings, ...errors],
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
