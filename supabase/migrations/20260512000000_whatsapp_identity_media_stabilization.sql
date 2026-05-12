-- Stabilize WhatsApp identity/media fields without removing existing data.

ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS business_name TEXT;

ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS error_message TEXT;

UPDATE whatsapp_messages
SET
  has_media = TRUE,
  media_mimetype = COALESCE(
    media_mimetype,
    raw_payload #>> '{message,imageMessage,mimetype}',
    raw_payload #>> '{message,videoMessage,mimetype}',
    raw_payload #>> '{message,audioMessage,mimetype}',
    raw_payload #>> '{message,documentMessage,mimetype}',
    raw_payload #>> '{message,stickerMessage,mimetype}',
    CASE
      WHEN raw_payload #> '{message,imageMessage}' IS NOT NULL THEN 'image/jpeg'
      WHEN raw_payload #> '{message,videoMessage}' IS NOT NULL THEN 'video/mp4'
      WHEN raw_payload #> '{message,audioMessage}' IS NOT NULL THEN 'audio/ogg'
      WHEN raw_payload #> '{message,stickerMessage}' IS NOT NULL THEN 'image/webp'
      WHEN raw_payload #> '{message,documentMessage}' IS NOT NULL THEN 'application/octet-stream'
      ELSE media_mimetype
    END
  ),
  media_filename = COALESCE(
    media_filename,
    raw_payload #>> '{message,documentMessage,fileName}',
    raw_payload #>> '{message,documentMessage,title}',
    raw_payload #>> '{message,imageMessage,fileName}',
    raw_payload #>> '{message,videoMessage,fileName}'
  )
WHERE raw_payload IS NOT NULL
  AND (
    raw_payload #> '{message,imageMessage}' IS NOT NULL OR
    raw_payload #> '{message,videoMessage}' IS NOT NULL OR
    raw_payload #> '{message,audioMessage}' IS NOT NULL OR
    raw_payload #> '{message,documentMessage}' IS NOT NULL OR
    raw_payload #> '{message,stickerMessage}' IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_instance_media
  ON whatsapp_messages(instance_name, has_media, created_at DESC)
  WHERE has_media = TRUE;
