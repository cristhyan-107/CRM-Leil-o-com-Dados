-- Consolidate WhatsApp sync schema.
-- Safe migration: preserves existing data, deduplicates before adding unique indexes.

CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  status TEXT,
  phone_number TEXT,
  connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  sync_status TEXT,
  sync_error TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS instance_name TEXT;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS sync_status TEXT;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS sync_error TEXT;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS raw_payload JSONB;
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  phone_number TEXT,
  display_name TEXT,
  push_name TEXT,
  verified_name TEXT,
  profile_pic_url TEXT,
  is_business BOOLEAN DEFAULT FALSE,
  is_group BOOLEAN DEFAULT FALSE,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS instance_name TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS remote_jid TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS push_name TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS verified_name TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS profile_pic_url TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS is_business BOOLEAN DEFAULT FALSE;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT FALSE;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS raw_payload JSONB;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS chat_name TEXT;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS last_message_text TEXT;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS raw_payload JSONB;

UPDATE whatsapp_chats
SET
  phone_number = COALESCE(phone_number, split_part(split_part(remote_jid, '@', 1), ':', 1)),
  chat_name = COALESCE(chat_name, push_name, split_part(split_part(remote_jid, '@', 1), ':', 1)),
  last_message_text = COALESCE(last_message_text, last_message)
WHERE remote_jid IS NOT NULL;

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sender_jid TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS text TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS has_media BOOLEAN DEFAULT FALSE;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_mimetype TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_filename TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS message_timestamp TIMESTAMPTZ;

UPDATE whatsapp_messages
SET
  text = COALESCE(text, content),
  message_timestamp = COALESCE(message_timestamp, sent_at, created_at),
  sender_jid = COALESCE(sender_jid, CASE WHEN from_me THEN NULL ELSE remote_jid END),
  sender_name = COALESCE(sender_name, push_name),
  message_id = COALESCE(
    message_id,
    message_key,
    'fallback_' || md5(
      COALESCE(user_id::text, '') || '|' ||
      COALESCE(instance_name, '') || '|' ||
      COALESCE(remote_jid, '') || '|' ||
      COALESCE(content, '') || '|' ||
      COALESCE(sent_at::text, created_at::text, '')
    )
  )
WHERE message_id IS NULL OR text IS NULL OR message_timestamp IS NULL;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, instance_name, remote_jid
      ORDER BY
        (CASE WHEN last_message IS NOT NULL THEN 1 ELSE 0 END) DESC,
        COALESCE(last_message_at, updated_at, created_at) DESC,
        updated_at DESC NULLS LAST
    ) AS rn
  FROM whatsapp_chats
  WHERE user_id IS NOT NULL AND instance_name IS NOT NULL AND remote_jid IS NOT NULL
)
DELETE FROM whatsapp_chats
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, instance_name, remote_jid, message_id
      ORDER BY
        (CASE WHEN content IS NOT NULL THEN 1 ELSE 0 END) DESC,
        COALESCE(sent_at, created_at) DESC,
        updated_at DESC NULLS LAST
    ) AS rn
  FROM whatsapp_messages
  WHERE user_id IS NOT NULL
    AND instance_name IS NOT NULL
    AND remote_jid IS NOT NULL
    AND message_id IS NOT NULL
)
DELETE FROM whatsapp_messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, instance_name, remote_jid
      ORDER BY
        (CASE WHEN display_name IS NOT NULL THEN 1 ELSE 0 END) DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    ) AS rn
  FROM whatsapp_contacts
  WHERE user_id IS NOT NULL AND instance_name IS NOT NULL AND remote_jid IS NOT NULL
)
DELETE FROM whatsapp_contacts
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

INSERT INTO whatsapp_instances (user_id, instance_name, status, sync_status, last_sync_at, created_at, updated_at)
SELECT DISTINCT
  user_id,
  instance_name,
  'open',
  'completed',
  NOW(),
  NOW(),
  NOW()
FROM whatsapp_chats c
WHERE user_id IS NOT NULL
  AND instance_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM whatsapp_instances i
    WHERE i.user_id = c.user_id
      AND i.instance_name = c.instance_name
  );

DROP INDEX IF EXISTS whatsapp_instances_instance_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_user_instance_key
  ON whatsapp_instances(user_id, instance_name)
  WHERE user_id IS NOT NULL AND instance_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contacts_user_instance_remote_key
  ON whatsapp_contacts(user_id, instance_name, remote_jid)
  WHERE user_id IS NOT NULL AND instance_name IS NOT NULL AND remote_jid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_chats_user_instance_remote_key
  ON whatsapp_chats(user_id, instance_name, remote_jid)
  WHERE user_id IS NOT NULL AND instance_name IS NOT NULL AND remote_jid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_user_instance_remote_message_key
  ON whatsapp_messages(user_id, instance_name, remote_jid, message_id)
  WHERE user_id IS NOT NULL
    AND instance_name IS NOT NULL
    AND remote_jid IS NOT NULL
    AND message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_instance ON whatsapp_contacts(instance_name);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_remote_jid ON whatsapp_contacts(remote_jid);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_user_instance ON whatsapp_chats(user_id, instance_name);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_user_instance_remote ON whatsapp_messages(user_id, instance_name, remote_jid);

ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_instances' AND policyname = 'Users can view own whatsapp instances') THEN
    CREATE POLICY "Users can view own whatsapp instances" ON whatsapp_instances FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_instances' AND policyname = 'Users can insert own whatsapp instances') THEN
    CREATE POLICY "Users can insert own whatsapp instances" ON whatsapp_instances FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_instances' AND policyname = 'Users can update own whatsapp instances') THEN
    CREATE POLICY "Users can update own whatsapp instances" ON whatsapp_instances FOR UPDATE USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can view own whatsapp contacts') THEN
    CREATE POLICY "Users can view own whatsapp contacts" ON whatsapp_contacts FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can insert own whatsapp contacts') THEN
    CREATE POLICY "Users can insert own whatsapp contacts" ON whatsapp_contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can update own whatsapp contacts') THEN
    CREATE POLICY "Users can update own whatsapp contacts" ON whatsapp_contacts FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;
