export function normalizeEvolutionEventName(event: unknown) {
  const raw = String(event || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '.')
    .replace(/-/g, '.');

  const map: Record<string, string> = {
    'connection.update': 'connection.update',
    'chats.upsert': 'chats.upsert',
    'chats.update': 'chats.update',
    'contacts.upsert': 'contacts.upsert',
    'contacts.update': 'contacts.update',
    'messages.upsert': 'messages.upsert',
    'message.upsert': 'messages.upsert',
    'messages.update': 'messages.update',
    'messages.delete': 'messages.delete',
    'messages.deleted': 'messages.delete',
    'send.message': 'send.message',
    'send.message.update': 'send.message',
    'qrcode.updated': 'qrcode.updated',
    'qrcode.update': 'qrcode.updated',
  };

  return map[raw] || 'unknown';
}

export function normalizeWhatsAppJid(jid: unknown) {
  const value = String(jid || '').trim();
  if (!value) return '';
  return value.includes('@') ? value : `${value.replace(/\D/g, '')}@s.whatsapp.net`;
}

export function isLidJid(jid: string) {
  return normalizeWhatsAppJid(jid).endsWith('@lid');
}

export function isGroupJid(jid: string) {
  return normalizeWhatsAppJid(jid).endsWith('@g.us');
}

export function isBroadcastJid(jid: string) {
  const normalized = normalizeWhatsAppJid(jid);
  return normalized.includes('@broadcast') || normalized === 'status@broadcast';
}

export function extractPhoneFromJid(jid: unknown) {
  const normalized = normalizeWhatsAppJid(jid);
  if (!normalized || isLidJid(normalized) || isBroadcastJid(normalized) || isGroupJid(normalized)) {
    return '';
  }
  return normalized.split('@')[0].split(':')[0].replace(/\D/g, '');
}

export function formatBrazilianPhone(phone: unknown) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const normalized = digits.startsWith('55') ? digits : digits.length >= 10 ? `55${digits}` : digits;
  if (normalized.length === 13) {
    return `+55 ${normalized.slice(2, 4)} ${normalized.slice(4, 9)}-${normalized.slice(9)}`;
  }
  if (normalized.length === 12) {
    return `+55 ${normalized.slice(2, 4)} ${normalized.slice(4, 8)}-${normalized.slice(8)}`;
  }
  return digits;
}

export function extractMessageTextFromPayload(message: any) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.documentMessage?.title ||
    ''
  );
}

export function getMessageMediaInfo(message: any) {
  const media =
    message?.imageMessage ||
    message?.videoMessage ||
    message?.audioMessage ||
    message?.documentMessage ||
    message?.stickerMessage;

  return {
    hasMedia: Boolean(media),
    mimetype: media?.mimetype || null,
    filename: media?.fileName || media?.title || null,
  };
}

export function stableMessageId(parts: unknown[]) {
  const input = parts.map((part) => String(part ?? '')).join('|');
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return `fallback_${Math.abs(hash).toString(36)}`;
}

export function resolveContactDisplayName({
  contact,
  chat,
  message,
  remoteJid,
}: {
  contact?: any;
  chat?: any;
  message?: any;
  remoteJid?: string;
}) {
  const phone = contact?.phone_number || chat?.phone_number || extractPhoneFromJid(remoteJid);
  const candidates = [
    contact?.display_name,
    contact?.verified_name,
    contact?.business_name,
    contact?.push_name,
    chat?.chat_name,
    chat?.name,
    chat?.push_name,
    message?.sender_name,
    message?.pushName,
    phone ? formatBrazilianPhone(phone) : '',
  ];

  const rawJid = normalizeWhatsAppJid(remoteJid || chat?.remote_jid || contact?.remote_jid);
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && value !== rawJid && !value.endsWith('@lid')) return value;
  }

  if (rawJid && !isLidJid(rawJid)) return rawJid.split('@')[0];
  return 'Contato sem nome';
}

export function resolveProfilePicture({ contact, chat }: { contact?: any; chat?: any }) {
  return contact?.profile_pic_url || chat?.profile_pic_url || null;
}

export function avatarFallback(name: string) {
  return (name || 'Contato')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}
