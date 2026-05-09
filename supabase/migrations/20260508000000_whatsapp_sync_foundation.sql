-- WhatsApp sync foundation for Evolution API.
-- Non-destructive: creates missing tables/columns and unique indexes used by upsert.

CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  instance_id TEXT,
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

CREATE TABLE IF NOT EXISTS whatsapp_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
  instance_name TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  contact_id UUID,
  chat_name TEXT,
  push_name TEXT,
  phone_number TEXT,
  profile_pic_url TEXT,
  is_group BOOLEAN DEFAULT FALSE,
  last_message TEXT,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  pipeline_stage TEXT NOT NULL DEFAULT 'new',
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
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

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES whatsapp_chats(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES whatsapp_contacts(id) ON DELETE SET NULL;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS remote_jid TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS message_key TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS from_me BOOLEAN DEFAULT FALSE;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sender_jid TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS push_name TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS message_type TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS text TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS has_media BOOLEAN DEFAULT FALSE;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_mimetype TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_filename TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS message_timestamp TIMESTAMPTZ;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS contact_name TEXT;

ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS contact_id UUID;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS chat_name TEXT;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS last_message_text TEXT;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS raw_payload JSONB;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'new';

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_instance_name_key
  ON whatsapp_instances(instance_name);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_chats_instance_remote_jid_key
  ON whatsapp_chats(instance_name, remote_jid);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contacts_instance_remote_jid_key
  ON whatsapp_contacts(instance_name, remote_jid);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_instance_remote_message_key
  ON whatsapp_messages(instance_name, remote_jid, message_id);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_message_key_unique
  ON whatsapp_messages(message_key)
  WHERE message_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_user_id ON whatsapp_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_user_id ON whatsapp_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_last_message_at ON whatsapp_chats(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_user_id ON whatsapp_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat_id ON whatsapp_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_remote_jid ON whatsapp_messages(remote_jid);

ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_instances' AND policyname = 'Users can view own whatsapp instances') THEN
    CREATE POLICY "Users can view own whatsapp instances"
      ON whatsapp_instances FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_instances' AND policyname = 'Users can insert own whatsapp instances') THEN
    CREATE POLICY "Users can insert own whatsapp instances"
      ON whatsapp_instances FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_instances' AND policyname = 'Users can update own whatsapp instances') THEN
    CREATE POLICY "Users can update own whatsapp instances"
      ON whatsapp_instances FOR UPDATE USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_chats' AND policyname = 'Users can view own whatsapp chats') THEN
    CREATE POLICY "Users can view own whatsapp chats"
      ON whatsapp_chats FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_chats' AND policyname = 'Users can insert own whatsapp chats') THEN
    CREATE POLICY "Users can insert own whatsapp chats"
      ON whatsapp_chats FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_chats' AND policyname = 'Users can update own whatsapp chats') THEN
    CREATE POLICY "Users can update own whatsapp chats"
      ON whatsapp_chats FOR UPDATE USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can view own whatsapp contacts') THEN
    CREATE POLICY "Users can view own whatsapp contacts"
      ON whatsapp_contacts FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can insert own whatsapp contacts') THEN
    CREATE POLICY "Users can insert own whatsapp contacts"
      ON whatsapp_contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can update own whatsapp contacts') THEN
    CREATE POLICY "Users can update own whatsapp contacts"
      ON whatsapp_contacts FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION increment_unread_count(p_instance TEXT, p_jid TEXT)
RETURNS void AS $$
BEGIN
  UPDATE whatsapp_chats
  SET unread_count = COALESCE(unread_count, 0) + 1,
      updated_at = NOW()
  WHERE instance_name = p_instance
    AND remote_jid = p_jid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
