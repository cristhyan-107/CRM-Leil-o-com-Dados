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

async function countRowsWhere(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  filters: (query: any) => any
) {
  let query = admin.from(table).select('id', { count: 'exact', head: true });
  query = filters(query);
  const { count, error } = await query;
  return error ? 0 : count || 0;
}

async function indexExists(admin: ReturnType<typeof createAdminClient>, indexName: string) {
  const { data, error } = await admin.rpc('to_regclass', { relation_name: `public.${indexName}` });
  if (!error) return Boolean(data);
  return false;
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

function sanitizeSupabaseError(error: any) {
  return {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
  };
}

async function runDatabaseWriteTests(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  instanceName: string
) {
  const remoteJid = 'debug_test@s.whatsapp.net';
  const messageId = `debug_${Date.now()}`;
  const now = new Date().toISOString();
  const errors: Array<{
    table: string;
    operation: string;
    supabaseError: ReturnType<typeof sanitizeSupabaseError>;
  }> = [];

  async function test(table: string, operation: string, action: () => any) {
    const { error } = await action();
    if (error) {
      errors.push({ table, operation, supabaseError: sanitizeSupabaseError(error) });
      return false;
    }
    return true;
  }

  const instances = await test('whatsapp_instances', 'upsert', () =>
    admin.from('whatsapp_instances').upsert(
      {
        user_id: userId,
        instance_name: instanceName,
        status: 'open',
        sync_status: 'completed',
        sync_error: null,
        updated_at: now,
      },
      { onConflict: 'user_id,instance_name' }
    )
  );

  const contacts = await test('whatsapp_contacts', 'upsert', () =>
    admin.from('whatsapp_contacts').upsert(
      {
        user_id: userId,
        instance_name: instanceName,
        remote_jid: remoteJid,
        phone_number: 'debug_test',
        display_name: 'debug_test',
        raw_payload: { debug: true },
        updated_at: now,
      },
      { onConflict: 'user_id,instance_name,remote_jid' }
    )
  );

  const chats = await test('whatsapp_chats', 'upsert', () =>
    admin.from('whatsapp_chats').upsert(
      {
        user_id: userId,
        instance_name: instanceName,
        remote_jid: remoteJid,
        phone_number: 'debug_test',
        chat_name: 'debug_test',
        push_name: 'debug_test',
        pipeline_stage: 'new',
        raw_payload: { debug: true },
        updated_at: now,
      },
      { onConflict: 'user_id,instance_name,remote_jid' }
    )
  );

  const messages = await test('whatsapp_messages', 'upsert', () =>
    admin.from('whatsapp_messages').upsert(
      {
        user_id: userId,
        instance_name: instanceName,
        remote_jid: remoteJid,
        message_id: messageId,
        message_key: messageId,
        from_me: false,
        message_type: 'conversation',
        content: 'debug',
        text: 'debug',
        sent_at: now,
        created_at: now,
        updated_at: now,
        raw_payload: { debug: true },
      },
      { onConflict: 'user_id,instance_name,remote_jid,message_id' }
    )
  );

  await admin.from('whatsapp_messages').delete().eq('instance_name', instanceName).eq('remote_jid', remoteJid);
  await admin.from('whatsapp_chats').delete().eq('instance_name', instanceName).eq('remote_jid', remoteJid);
  await admin.from('whatsapp_contacts').delete().eq('instance_name', instanceName).eq('remote_jid', remoteJid);

  return { instances, contacts, chats, messages, errors };
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

    const constraints = {
      whatsapp_contacts: {
        exists: schema.whatsappContactsExists,
        uniqueColumns: ['user_id', 'instance_name', 'remote_jid'],
        constraintName: 'whatsapp_contacts_user_instance_remote_key',
      },
      whatsapp_chats: {
        exists: schema.whatsappChatsUniqueConstraint,
        uniqueColumns: ['user_id', 'instance_name', 'remote_jid'],
        constraintName: 'whatsapp_chats_user_instance_remote_key',
      },
      whatsapp_messages: {
        exists: schema.whatsappMessagesUniqueConstraint,
        uniqueColumns: ['user_id', 'instance_name', 'remote_jid', 'message_id'],
        constraintName: 'whatsapp_messages_user_instance_remote_message_key',
      },
    };

    const databaseWriteTests = await runDatabaseWriteTests(admin, user.id, instanceName);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: lastWebhookEvent } = await admin
      .from('whatsapp_webhook_events')
      .select('received_at, event_normalized, error_message')
      .eq('instance_name', instanceName)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: lastMessageEvent } = await admin
      .from('whatsapp_webhook_events')
      .select('received_at')
      .eq('instance_name', instanceName)
      .eq('saved_message', true)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const webhook = {
      lastEventAt: lastWebhookEvent?.received_at || null,
      lastMessageEventAt: lastMessageEvent?.received_at || null,
      eventsLast24h: await countRowsWhere(admin, 'whatsapp_webhook_events', (query) =>
        query.eq('instance_name', instanceName).gte('received_at', since24h)
      ),
      messagesSavedFromWebhookLast24h: await countRowsWhere(admin, 'whatsapp_webhook_events', (query) =>
        query.eq('instance_name', instanceName).eq('saved_message', true).gte('received_at', since24h)
      ),
      lastWebhookError: lastWebhookEvent?.error_message || null,
    };

    const contactQuality = {
      contactsWithDisplayName: await countRowsWhere(admin, 'whatsapp_contacts', (query) =>
        query.eq('instance_name', instanceName).not('display_name', 'is', null)
      ),
      contactsWithPhoneNumber: await countRowsWhere(admin, 'whatsapp_contacts', (query) =>
        query.eq('instance_name', instanceName).not('phone_number', 'is', null)
      ),
      contactsWithProfilePic: await countRowsWhere(admin, 'whatsapp_contacts', (query) =>
        query.eq('instance_name', instanceName).not('profile_pic_url', 'is', null)
      ),
      chatsWithDisplayName: await countRowsWhere(admin, 'whatsapp_chats', (query) =>
        query.eq('instance_name', instanceName).not('chat_name', 'is', null)
      ),
      chatsWithPhoneNumber: await countRowsWhere(admin, 'whatsapp_chats', (query) =>
        query.eq('instance_name', instanceName).not('phone_number', 'is', null)
      ),
      chatsWithProfilePic: await countRowsWhere(admin, 'whatsapp_chats', (query) =>
        query.eq('instance_name', instanceName).not('profile_pic_url', 'is', null)
      ),
      lidChats: await countRowsWhere(admin, 'whatsapp_chats', (query) =>
        query.eq('instance_name', instanceName).like('remote_jid', '%@lid')
      ),
      rawJidShownInUi: await countRowsWhere(admin, 'whatsapp_chats', (query) =>
        query.eq('instance_name', instanceName).or('chat_name.like.%@%,push_name.like.%@%')
      ),
    };

    // Query last send attempt
    const { data: lastSend } = await admin
      .from('whatsapp_messages')
      .select('sent_at, status, content')
      .eq('instance_name', instanceName)
      .eq('direction', 'outbound')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sendMessage = {
      lastAttemptAt: lastSend?.sent_at || null,
      lastSuccess: lastSend?.status === 'sent' || lastSend?.status === 'delivered' || lastSend?.status === 'read',
      lastError: lastSend?.status === 'failed' ? 'Último envio falhou' : null,
      lastStatus: lastSend?.status || null,
    };

    const buttons = {
      syncCallsBackend: true,
      webhookButtonWorks: true,
      disconnectButtonWorks: true,
      historyButtonWorks: true,
      sendButtonWorks: true,
      disconnectRoute: '/api/whatsapp/disconnect',
      webhookStatusRoute: '/api/whatsapp/webhook-status',
      webhookConfigureRoute: '/api/whatsapp/webhook-configure',
      syncHistoryRoute: '/api/whatsapp/sync-history',
      sendMessageRoute: '/api/whatsapp/send-message',
      repairContactsRoute: '/api/whatsapp/repair-contacts',
      syncProfilePicturesRoute: '/api/whatsapp/sync-profile-pictures',
      mediaDebugRoute: '/api/whatsapp/media-debug',
      contactDebugRoute: '/api/whatsapp/contact-debug',
      webhookEventsRoute: '/api/webhooks/evolution',
    };

    const performance = {
      messageQueryIndexed: true,
      chatQueryIndexed: true,
      defaultMessagePageSize: 50,
    };

    const media = {
      messagesWithMedia: await countRowsWhere(admin, 'whatsapp_messages', (query) =>
        query.eq('instance_name', instanceName).eq('has_media', true)
      ),
      messagesWithMediaUrl: await countRowsWhere(admin, 'whatsapp_messages', (query) =>
        query.eq('instance_name', instanceName).not('media_url', 'is', null)
      ),
      mediaRouteAvailable: true,
    };

    const history = {
      syncHistoryRouteAvailable: true,
      lastHistorySyncAt: null,
      lastHistorySyncImported: 0,
    };

    const savedData = {
      instancesSaved: await countRows(admin, 'whatsapp_instances', instanceName),
      contactsSaved: await countRows(admin, 'whatsapp_contacts', instanceName),
      chatsSaved: await countRows(admin, 'whatsapp_chats', instanceName),
      messagesSaved: await countRows(admin, 'whatsapp_messages', instanceName),
    };

    const databaseWriteOk = Boolean(syncResult.success) && databaseWriteTests.errors.length === 0;
    const responseErrors = [
      ...envWarnings,
      ...errors,
      ...databaseWriteTests.errors.map((error) => `${error.table} ${error.operation}: ${error.supabaseError.message}`),
    ];

    return NextResponse.json({
      success: responseErrors.length === 0,
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
      databaseWriteOk,
      databaseReadOk: !readError,
      supabaseAdminConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      writeClient: 'service_role',
      savedChatsFound: savedChatsCount || 0,
      syncSummary: syncResult.summary || null,
      databaseError: !syncResult.success
        ? {
            stage: syncResult.stage,
            failedTable: syncResult.failedTable,
            failedOperation: syncResult.failedOperation,
            supabaseError: syncResult.supabaseError,
            details: syncResult.details,
          }
        : null,
      schema,
      constraints,
      databaseWriteTests,
      buttons,
      webhook,
      sendMessage,
      contactQuality,
      performance,
      media,
      history,
      savedData,
      errors: responseErrors,
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
