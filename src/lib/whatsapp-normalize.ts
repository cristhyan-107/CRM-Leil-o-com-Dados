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
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

export function isLidJid(jid: unknown) {
  return normalizeWhatsAppJid(jid).endsWith('@lid');
}

export function isGroupJid(jid: unknown) {
  return normalizeWhatsAppJid(jid).endsWith('@g.us');
}

export function isBroadcastJid(jid: unknown) {
  const normalized = normalizeWhatsAppJid(jid);
  return normalized.includes('@broadcast') || normalized === 'status@broadcast';
}

export function extractJidIdentifier(jid: unknown) {
  return normalizeWhatsAppJid(jid).split('@')[0].split(':')[0];
}

export function extractPhoneFromJid(jid: unknown) {
  const normalized = normalizeWhatsAppJid(jid);
  if (!normalized || isLidJid(normalized) || isBroadcastJid(normalized) || isGroupJid(normalized)) {
    return '';
  }
  const digits = extractJidIdentifier(normalized).replace(/\D/g, '');
  return isValidPhoneNumber(digits) ? digits : '';
}

export function normalizeBrazilianPhoneNumber(phone: unknown) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const withoutLeadingZeros = digits.replace(/^0+/, '');
  const normalized = withoutLeadingZeros.startsWith('55')
    ? withoutLeadingZeros
    : withoutLeadingZeros.length >= 10
      ? `55${withoutLeadingZeros}`
      : withoutLeadingZeros;
  return normalized;
}

export function isValidPhoneNumber(phone: unknown) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return false;
  if (digits.length < 10 || digits.length > 15) return false;
  if (/^0+$/.test(digits)) return false;
  return true;
}

export function isLikelyLidNumber(value: unknown, remoteJid?: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return false;
  const jid = normalizeWhatsAppJid(remoteJid);
  if (jid.endsWith('@lid') && digits === extractJidIdentifier(jid)) return true;
  if (digits.length >= 14 && !digits.startsWith('55')) return true;
  return false;
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

function hasJidMarker(value: string) {
  return (
    value.includes('@s.whatsapp.net') ||
    value.includes('@c.us') ||
    value.includes('@g.us') ||
    value.includes('@lid') ||
    value.includes('@broadcast')
  );
}

export function isLikelyHumanName(value: unknown, context?: { remoteJid?: unknown; phoneNumber?: unknown }) {
  const name = String(value || '').trim();
  if (!name) return false;
  const rawJid = normalizeWhatsAppJid(context?.remoteJid);
  if (name === rawJid || hasJidMarker(name) || /^\d+@/.test(name)) return false;

  const digits = name.replace(/\D/g, '');
  const phoneDigits = String(context?.phoneNumber || '').replace(/\D/g, '');
  if (digits && digits === extractJidIdentifier(rawJid)) return false;
  if (digits && phoneDigits && digits === phoneDigits) return false;
  if (/^\+?\d[\d\s().-]{7,}$/.test(name)) return false;
  if (/^\d{10,}$/.test(name)) return false;
  if (isLikelyLidNumber(name, rawJid)) return false;

  return true;
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
  const type =
    message?.imageMessage ? 'imageMessage' :
    message?.videoMessage ? 'videoMessage' :
    message?.audioMessage ? 'audioMessage' :
    message?.documentMessage ? 'documentMessage' :
    message?.stickerMessage ? 'stickerMessage' :
    null;

  const media =
    message?.imageMessage ||
    message?.videoMessage ||
    message?.audioMessage ||
    message?.documentMessage ||
    message?.stickerMessage ||
    null;

  const fallbackMimetype: Record<string, string> = {
    imageMessage: 'image/jpeg',
    videoMessage: 'video/mp4',
    audioMessage: 'audio/ogg',
    documentMessage: 'application/octet-stream',
    stickerMessage: 'image/webp',
  };

  return {
    type,
    hasMedia: Boolean(media),
    mimetype: media?.mimetype || (type ? fallbackMimetype[type] : null),
    filename:
      media?.fileName ||
      media?.filename ||
      media?.title ||
      (type === 'imageMessage' ? 'imagem.jpg' : null),
    url: media?.url || null,
    caption: media?.caption || null,
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
  return resolveContactIdentity({ contact, chat, message, remoteJid }).displayName;
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

export interface WhatsAppIdentity {
  displayName: string;
  displayNameSource: string;
  phoneNumber: string | null;
  formattedPhone: string | null;
  profilePicUrl: string | null;
  isLid: boolean;
  isGroup: boolean;
  identityConfidence: 'high' | 'medium' | 'low';
  identitySource: 'contact_remote_jid' | 'chat_remote_jid' | 'own_payload' | 'phone' | 'push_name' | 'fallback';
  possibleWrongPhone: boolean;
  possibleWrongProfilePic: boolean;
  canSendMessage: boolean;
  sendJid: string | null;
  sendStrategy: 'phone_jid' | 'remote_jid' | 'lid_direct' | 'group_jid' | 'failed';
  avatarFallback: string;
}

function sameRemoteJid(left: unknown, right: unknown) {
  const a = normalizeWhatsAppJid(left);
  const b = normalizeWhatsAppJid(right);
  return Boolean(a && b && a === b);
}

function resolvePhoneNumber(contact: any, chat: any, rawJid: string) {
  const isLid = isLidJid(rawJid);
  const contactMatches = !contact?.remote_jid || sameRemoteJid(contact.remote_jid, rawJid);
  const chatMatches = !chat?.remote_jid || sameRemoteJid(chat.remote_jid, rawJid);

  if (isLid) {
    const trustedCandidates = [
      contact?.trusted_phone_number,
      contact?.trustedPhoneNumber,
      chat?.trusted_phone_number,
      chat?.trustedPhoneNumber,
    ];
    for (const candidate of trustedCandidates) {
      const digits = String(candidate || '').replace(/\D/g, '');
      if (digits && isValidPhoneNumber(digits) && !isLikelyLidNumber(digits, rawJid)) return digits;
    }
    return '';
  }

  const candidates = [
    contactMatches ? contact?.phone_number : null,
    contactMatches ? contact?.phoneNumber : null,
    chatMatches ? chat?.phone_number : null,
    chatMatches ? chat?.phoneNumber : null,
    contactMatches ? extractPhoneFromJid(contact?.remote_jid) : null,
    chatMatches ? extractPhoneFromJid(chat?.remote_jid) : null,
    extractPhoneFromJid(rawJid),
  ];

  for (const candidate of candidates) {
    const digits = String(candidate || '').replace(/\D/g, '');
    if (!digits) continue;
    if (isLikelyLidNumber(digits, rawJid)) continue;
    if (isValidPhoneNumber(digits)) return digits;
  }

  return '';
}

export function resolveSendJid({
  remoteJid,
  phoneNumber,
  allowLidDirect = true,
}: {
  remoteJid?: unknown;
  phoneNumber?: unknown;
  allowLidDirect?: boolean;
}) {
  const rawJid = normalizeWhatsAppJid(remoteJid);
  const phone = String(phoneNumber || '').replace(/\D/g, '');
  const validPhone = isValidPhoneNumber(phone) && !isLikelyLidNumber(phone, rawJid) ? phone : '';

  if (validPhone) {
    return {
      canSendMessage: true,
      sendJid: `${validPhone}@s.whatsapp.net`,
      sendTarget: validPhone,
      sendStrategy: 'phone_jid' as const,
      reason: null,
    };
  }

  if (rawJid.endsWith('@s.whatsapp.net') || rawJid.endsWith('@c.us')) {
    return {
      canSendMessage: true,
      sendJid: rawJid,
      sendTarget: rawJid,
      sendStrategy: 'remote_jid' as const,
      reason: null,
    };
  }

  if (allowLidDirect && rawJid.endsWith('@lid')) {
    return {
      canSendMessage: true,
      sendJid: rawJid,
      sendTarget: rawJid,
      sendStrategy: 'lid_direct' as const,
      reason: 'Contato sem telefone real; envio tentara o identificador @lid.',
    };
  }

  if (rawJid.endsWith('@g.us')) {
    return {
      canSendMessage: true,
      sendJid: rawJid,
      sendTarget: rawJid,
      sendStrategy: 'group_jid' as const,
      reason: null,
    };
  }

  return {
    canSendMessage: false,
    sendJid: null,
    sendTarget: null,
    sendStrategy: 'failed' as const,
    reason: rawJid.endsWith('@lid')
      ? 'Contato @lid sem telefone real associado.'
      : 'Nao foi possivel resolver destinatario de envio.',
  };
}

export function resolveContactIdentity({
  contact,
  chat,
  message,
  remoteJid,
}: {
  contact?: any;
  chat?: any;
  message?: any;
  remoteJid?: string;
}): WhatsAppIdentity {
  const rawJid = normalizeWhatsAppJid(remoteJid || chat?.remote_jid || contact?.remote_jid);
  const isLid = isLidJid(rawJid);
  const isGroup = isGroupJid(rawJid);
  const isBroadcast = isBroadcastJid(rawJid);
  const contactMatches = !contact?.remote_jid || sameRemoteJid(contact.remote_jid, rawJid);
  const chatMatches = !chat?.remote_jid || sameRemoteJid(chat.remote_jid, rawJid);

  const phoneNumber = resolvePhoneNumber(contact, chat, rawJid);
  const formattedPhone = phoneNumber ? formatBrazilianPhone(phoneNumber) : null;

  const nameCandidates = [
    { value: contactMatches ? contact?.display_name : null, source: 'display_name', identitySource: 'contact_remote_jid' as const },
    { value: contactMatches ? contact?.verified_name : null, source: 'verified_name', identitySource: 'contact_remote_jid' as const },
    { value: contactMatches ? contact?.business_name : null, source: 'business_name', identitySource: 'contact_remote_jid' as const },
    { value: contactMatches ? contact?.push_name : null, source: 'push_name', identitySource: 'contact_remote_jid' as const },
    { value: chatMatches ? chat?.chat_name : null, source: 'chat_name', identitySource: 'chat_remote_jid' as const },
    { value: chatMatches ? chat?.name : null, source: 'chat_name', identitySource: 'chat_remote_jid' as const },
    { value: chatMatches ? chat?.push_name : null, source: 'push_name', identitySource: 'chat_remote_jid' as const },
    { value: message?.sender_name, source: 'sender_name', identitySource: 'push_name' as const },
    { value: message?.pushName, source: 'push_name', identitySource: 'push_name' as const },
    { value: message?.push_name, source: 'push_name', identitySource: 'push_name' as const },
  ];

  let displayName = '';
  let displayNameSource = '';
  let identitySource: WhatsAppIdentity['identitySource'] = 'fallback';
  let identityConfidence: WhatsAppIdentity['identityConfidence'] = 'low';

  for (const candidate of nameCandidates) {
    const value = String(candidate.value || '').trim();
    if (isLikelyHumanName(value, { remoteJid: rawJid, phoneNumber })) {
      displayName = value;
      displayNameSource = candidate.source;
      identitySource = candidate.identitySource || 'push_name';
      identityConfidence = candidate.identitySource === 'contact_remote_jid' ? 'high' : 'medium';
      break;
    }
  }

  if (!displayName) {
    if (formattedPhone) {
      displayName = formattedPhone;
      displayNameSource = 'phone';
      identitySource = 'phone';
      identityConfidence = rawJid.endsWith('@s.whatsapp.net') || rawJid.endsWith('@c.us') ? 'high' : 'medium';
    } else if (isGroup) {
      displayName = 'Grupo WhatsApp';
      displayNameSource = 'fallback';
    } else if (isLid) {
      displayName = 'Contato WhatsApp';
      displayNameSource = 'fallback';
    } else if (rawJid && !isBroadcast) {
      const phone = extractPhoneFromJid(rawJid);
      displayName = phone ? formatBrazilianPhone(phone) : 'Contato WhatsApp';
      displayNameSource = phone ? 'jid_phone' : 'fallback';
      identitySource = phone ? 'chat_remote_jid' : 'fallback';
      identityConfidence = phone ? 'high' : 'low';
    } else {
      displayName = 'Contato WhatsApp';
      displayNameSource = 'fallback';
    }
  }

  const profilePicUrl =
    (contactMatches ? contact?.profile_pic_url : null) ||
    (chatMatches ? chat?.profile_pic_url : null) ||
    null;
  const send = resolveSendJid({ remoteJid: rawJid, phoneNumber });
  const possibleWrongPhone = isLid && Boolean(contact?.phone_number || chat?.phone_number) && !phoneNumber;
  const possibleWrongProfilePic =
    Boolean(profilePicUrl) &&
    Boolean(contact?.remote_jid) &&
    !sameRemoteJid(contact.remote_jid, rawJid);

  return {
    displayName,
    displayNameSource,
    phoneNumber: phoneNumber || null,
    formattedPhone,
    profilePicUrl,
    isLid,
    isGroup,
    identityConfidence,
    identitySource,
    possibleWrongPhone,
    possibleWrongProfilePic,
    canSendMessage: send.canSendMessage,
    sendJid: send.sendJid,
    sendStrategy: send.sendStrategy,
    avatarFallback: avatarFallback(displayName),
  };
}
