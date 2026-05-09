DO $$
BEGIN
  EXECUTE 'UPDATE whatsapp_chats
    SET user_id = COALESCE(user_id, ''00000000-0000-0000-0000-000000000000''::uuid),
        instance_name = COALESCE(instance_name, ''unknown''),
        remote_jid = COALESCE(remote_jid, ''unknown_'' || id::text)
    WHERE user_id IS NULL OR instance_name IS NULL OR remote_jid IS NULL';

  EXECUTE 'UPDATE whatsapp_messages
    SET user_id = COALESCE(user_id, ''00000000-0000-0000-0000-000000000000''::uuid),
        instance_name = COALESCE(instance_name, ''unknown''),
        remote_jid = COALESCE(remote_jid, ''unknown_'' || id::text),
        message_id = COALESCE(message_id, message_key, ''fallback_'' || md5(id::text))
    WHERE user_id IS NULL OR instance_name IS NULL OR remote_jid IS NULL OR message_id IS NULL';

  EXECUTE 'UPDATE whatsapp_contacts
    SET user_id = COALESCE(user_id, ''00000000-0000-0000-0000-000000000000''::uuid),
        instance_name = COALESCE(instance_name, ''unknown''),
        remote_jid = COALESCE(remote_jid, ''unknown_'' || id::text)
    WHERE user_id IS NULL OR instance_name IS NULL OR remote_jid IS NULL';

  EXECUTE 'UPDATE whatsapp_instances
    SET user_id = COALESCE(user_id, ''00000000-0000-0000-0000-000000000000''::uuid),
        instance_name = COALESCE(instance_name, ''unknown_'' || id::text)
    WHERE user_id IS NULL OR instance_name IS NULL';

  EXECUTE 'DROP INDEX IF EXISTS whatsapp_chats_user_instance_remote_key';
  EXECUTE 'DROP INDEX IF EXISTS whatsapp_messages_user_instance_remote_message_key';
  EXECUTE 'DROP INDEX IF EXISTS whatsapp_contacts_user_instance_remote_key';
  EXECUTE 'DROP INDEX IF EXISTS whatsapp_instances_user_instance_key';

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_chats_user_instance_remote_key
    ON whatsapp_chats(user_id, instance_name, remote_jid)';
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_user_instance_remote_message_key
    ON whatsapp_messages(user_id, instance_name, remote_jid, message_id)';
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contacts_user_instance_remote_key
    ON whatsapp_contacts(user_id, instance_name, remote_jid)';
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_user_instance_key
    ON whatsapp_instances(user_id, instance_name)';
END $$;
