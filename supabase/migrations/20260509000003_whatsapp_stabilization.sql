DO $$
BEGIN
  EXECUTE 'CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at TIMESTAMPTZ DEFAULT NOW(),
    instance_name TEXT,
    event_raw TEXT,
    event_normalized TEXT,
    remote_jid TEXT,
    message_id TEXT,
    from_me BOOLEAN,
    secret_valid BOOLEAN,
    processed BOOLEAN DEFAULT FALSE,
    saved_contact BOOLEAN DEFAULT FALSE,
    saved_chat BOOLEAN DEFAULT FALSE,
    saved_message BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    raw_payload JSONB
  )';

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_received
    ON whatsapp_webhook_events(received_at DESC)';

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_instance_received
    ON whatsapp_webhook_events(instance_name, received_at DESC)';

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_user_instance_jid_timestamp
    ON whatsapp_messages(user_id, instance_name, remote_jid, message_timestamp DESC NULLS LAST, sent_at DESC NULLS LAST)';

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_user_instance_last_message
    ON whatsapp_chats(user_id, instance_name, last_message_at DESC NULLS LAST, updated_at DESC NULLS LAST)';

  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_user_instance_jid
    ON whatsapp_contacts(user_id, instance_name, remote_jid)';

  EXECUTE 'ALTER TABLE whatsapp_webhook_events ENABLE ROW LEVEL SECURITY';
END $$;
