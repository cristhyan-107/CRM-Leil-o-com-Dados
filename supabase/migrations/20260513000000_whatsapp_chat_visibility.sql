-- Add local visibility controls for WhatsApp chats.
-- Safe migration: no physical deletes and no destructive rewrites.

ALTER TABLE whatsapp_chats
  ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_user_instance_visible
  ON whatsapp_chats(user_id, instance_name, last_message_at DESC NULLS LAST, updated_at DESC NULLS LAST)
  WHERE COALESCE(archived, FALSE) = FALSE AND deleted_at IS NULL;

