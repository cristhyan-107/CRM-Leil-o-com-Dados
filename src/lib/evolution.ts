// ============================================================
// Evolution API — Camada de serviço
// Toda comunicação com a Evolution passa por aqui.
// O frontend nunca chama a Evolution diretamente.
// ============================================================

function buildUrl(path: string) {
  const BASE_URL = process.env.EVOLUTION_API_URL || '';
  const cleanBase = BASE_URL.replace(/\/+$/, '');
  const cleanPath = path.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

export class EvolutionApiError extends Error {
  status: number;
  url: string;
  body: string;

  constructor(message: string, status: number, url: string, body: string) {
    super(message);
    this.name = 'EvolutionApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export function getEvolutionUrl(endpoint: string) {
  return buildUrl(endpoint);
}

export async function evolutionFetch(endpoint: string, options?: RequestInit) {
  const API_KEY = process.env.EVOLUTION_API_KEY;

  if (!process.env.EVOLUTION_API_URL || !API_KEY) {
    throw new Error('Evolution API missing credentials in environment variables.');
  }

  const finalUrl = buildUrl(endpoint);

  // Helper: garante que qualquer valor vira string legível
  function toStr(v: unknown): string {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(toStr).join(' | ');
    if (v && typeof v === 'object') return JSON.stringify(v);
    return String(v ?? '');
  }

  console.log(`[evolutionFetch] ${options?.method || 'GET'} ${finalUrl}`);

  const res = await fetch(finalUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: API_KEY,
      ...(options?.headers || {}),
    },
  });

  const textBody = await res.text();

  console.log(`[evolutionFetch] HTTP ${res.status} — body: ${textBody.substring(0, 300)}`);

  if (!res.ok) {
    let errorMessage = `Evolution API error: HTTP ${res.status}`;
    try {
      if (textBody) {
        const errBody = JSON.parse(textBody);
        // Formato Evolution v2: { response: { message: ["..."] } }
        if (errBody?.response?.message) {
          errorMessage = toStr(errBody.response.message);
        // Formato Evolution v2 alternativo: { message: "..." | [...] }
        } else if (errBody?.message) {
          errorMessage = toStr(errBody.message);
        } else if (errBody?.error) {
          errorMessage = toStr(errBody.error);
        } else {
          errorMessage = textBody.substring(0, 200);
        }
      }
    } catch {
      errorMessage = `HTTP ${res.status}: ${textBody.substring(0, 200)}`;
    }
    console.error(`[evolutionFetch] ERRO HTTP ${res.status}: ${errorMessage}`);
    throw new EvolutionApiError(errorMessage, res.status, finalUrl, textBody.substring(0, 1000));
  }

  return textBody ? JSON.parse(textBody) : {};
}


// ============================================================
// Instance management
// ============================================================

export async function createEvolutionInstance(instanceName: string) {
  const appUrl = process.env.NEXT_PUBLIC_URL || 'https://crm-imob.leilaocomdados.com.br';

  const response = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        url: `${appUrl}/api/webhooks/evolution`,
        byEvents: false,
        base64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'MESSAGES_DELETE',
          'SEND_MESSAGE',
          'CHATS_UPSERT',
          'CHATS_UPDATE',
          'CONTACTS_UPSERT',
          'CONNECTION_UPDATE',
        ],
      },
    }),
  });

  return response;
}

export async function getEvolutionInstanceStatus(instanceName: string) {
  try {
    const response = await evolutionFetch(`/instance/connectionState/${instanceName}`, {
      method: 'GET',
    });
    return response;
  } catch (error: any) {
    if (error.message && (error.message.includes('404') || error.message.includes('not exist'))) {
      return { state: 'not_found', status: 'NOT_FOUND' };
    }
    return { state: 'close', status: 'DISCONNECTED', error: error.message };
  }
}

export async function fetchInstances() {
  return evolutionFetch('/instance/fetchInstances', { method: 'GET' });
}

export async function deleteEvolutionInstance(instanceName: string) {
  return evolutionFetch(`/instance/delete/${instanceName}`, { method: 'DELETE' });
}

export async function logoutEvolutionInstance(instanceName: string) {
  return evolutionFetch(`/instance/logout/${instanceName}`, { method: 'DELETE' });
}

// ============================================================
// QR Code flow (create → get QR)
// ============================================================

export async function getEvolutionQRCode(instanceName: string): Promise<any> {
  const startTime = Date.now();

  // Check if instance already exists
  const existingStatus = await getEvolutionInstanceStatus(instanceName);
  const state = existingStatus?.instance?.state || existingStatus?.state;

  if (state === 'open') {
    return { alreadyConnected: true, state: 'open' };
  }

  // If instance exists but not open, delete and recreate
  if (state && state !== 'not_found') {
    try {
      await deleteEvolutionInstance(instanceName);
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      // ignore
    }
  }

  // Create fresh instance (v2.3.7+ returns QR in create response)
  const createRes = await createEvolutionInstance(instanceName);

  const createQR = createRes?.qrcode?.base64;
  if (createQR) {
    return { base64: createQR, ...createRes };
  }

  // Fallback: poll /connect
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const response = await evolutionFetch(`/instance/connect/${instanceName}`, { method: 'GET' });
      const qrData =
        response.base64 ||
        response.qrcode?.base64 ||
        (typeof response.qrcode === 'string' && response.qrcode.length > 50
          ? response.qrcode
          : null) ||
        response.code;

      if (qrData) return { base64: qrData, ...response };
      if (response.instance?.state === 'open' || response.state === 'open') {
        return { alreadyConnected: true, state: 'open' };
      }
    } catch (err: any) {
      // continue polling
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  throw new Error(
    `Não foi possível gerar o QR Code após ${elapsed}s. Verifique a Evolution API.`
  );
}

// ============================================================
// Webhook management
// ============================================================

export async function updateEvolutionWebhook(instanceName: string) {
  const appUrl = process.env.NEXT_PUBLIC_URL || 'https://crm-imob.leilaocomdados.com.br';
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  const webhookUrl =
    `${appUrl}/api/webhooks/evolution${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`;

  return evolutionFetch(`/webhook/set/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      webhook: {
        url: webhookUrl,
        enabled: true,
        webhookByEvents: false,
        webhookBase64: false,
        events: [
          'QRCODE_UPDATED',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'MESSAGES_DELETE',
          'SEND_MESSAGE',
          'CHATS_UPSERT',
          'CHATS_UPDATE',
          'CONTACTS_UPSERT',
          'CONTACTS_UPDATE',
          'CONNECTION_UPDATE',
        ],
      },
    }),
  });
}

export async function getEvolutionWebhook(instanceName: string) {
  try {
    return await evolutionFetch(`/webhook/find/${instanceName}`, { method: 'GET' });
  } catch (error) {
    try {
      return await evolutionFetch(`/webhook/get/${instanceName}`, { method: 'GET' });
    } catch {
      throw error;
    }
  }
}

// ============================================================
// Chat & Message queries (FASE 3 — Carga inicial)
// ============================================================

export interface EvolutionChat {
  remoteJid: string;
  pushName?: string;
  profilePicUrl?: string;
  unreadCount?: number;
  updatedAt?: string;
  lastMessage?: {
    message?: {
      conversation?: string;
      extendedTextMessage?: { text: string };
      imageMessage?: { caption?: string };
      audioMessage?: {};
      documentMessage?: { title?: string };
    };
    key?: { fromMe?: boolean };
    messageTimestamp?: number;
  };
}

function asArrayFromPayload(payload: any, candidatePaths: string[][] = []) {
  if (Array.isArray(payload)) return payload;

  for (const path of candidatePaths) {
    let value = payload;
    for (const key of path) value = value?.[key];
    if (Array.isArray(value)) return value;
  }

  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
}

export function normalizeChatPayload(payload: any): EvolutionChat[] {
  const rawChats = asArrayFromPayload(payload, [
    ['chats'],
    ['chats', 'records'],
    ['data', 'chats'],
    ['data', 'records'],
  ]);

  return rawChats
    .map((chat: any) => {
      const remoteJid =
        chat?.remoteJid ||
        chat?.id ||
        chat?.jid ||
        chat?.key?.remoteJid ||
        chat?.conversation?.id ||
        '';

      return {
        ...chat,
        remoteJid,
        pushName:
          chat?.pushName ||
          chat?.name ||
          chat?.subject ||
          chat?.contact?.pushName ||
          chat?.contact?.name,
        profilePicUrl:
          chat?.profilePicUrl ||
          chat?.profilePictureUrl ||
          chat?.picture ||
          chat?.contact?.profilePicUrl,
        unreadCount: Number(chat?.unreadCount || chat?.unreadMessages || 0),
        updatedAt: chat?.updatedAt || chat?.lastMessageAt,
      } as EvolutionChat;
    })
    .filter((chat: EvolutionChat) => Boolean(chat.remoteJid));
}

export async function getEvolutionChats(instanceName: string): Promise<EvolutionChat[]> {
  // 55s timeout - stays within Vercel's 60s function limit
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  const res = await evolutionFetch(`/chat/findChats/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({}),
    signal: controller.signal as any,
  }).finally(() => clearTimeout(timeout));

  return normalizeChatPayload(res).filter(
    (c) =>
      c.remoteJid &&
      !c.remoteJid.includes('@broadcast') &&
      !c.remoteJid.includes('status@')
  );
}

export interface EvolutionMessage {
  key: {
    id: string;
    fromMe: boolean;
    remoteJid: string;
    participant?: string;
  };
  pushName?: string;
  messageType: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text: string };
    imageMessage?: { caption?: string };
    audioMessage?: {};
    documentMessage?: { title?: string };
  };
  messageTimestamp: number;
  status?: string;
}

export interface EvolutionContact {
  remoteJid: string;
  phoneNumber?: string;
  displayName?: string;
  pushName?: string;
  verifiedName?: string;
  profilePicUrl?: string;
  isBusiness?: boolean;
  isGroup?: boolean;
  raw?: any;
}

export function normalizeContactPayload(payload: any): EvolutionContact[] {
  const rawContacts = asArrayFromPayload(payload, [
    ['contacts'],
    ['contacts', 'records'],
    ['data', 'contacts'],
    ['data', 'records'],
  ]);

  return rawContacts
    .map((contact: any) => {
      const remoteJid =
        contact?.remoteJid ||
        contact?.id ||
        contact?.jid ||
        contact?.phone ||
        contact?.number ||
        '';
      const normalizedJid = remoteJid && String(remoteJid).includes('@')
        ? String(remoteJid)
        : remoteJid
        ? `${String(remoteJid).replace(/\D/g, '')}@s.whatsapp.net`
        : '';

      return {
        remoteJid: normalizedJid,
        phoneNumber: normalizedJid ? jidToPhone(normalizedJid) : undefined,
        displayName: contact?.name || contact?.displayName,
        pushName: contact?.pushName,
        verifiedName: contact?.verifiedName,
        profilePicUrl: contact?.profilePicUrl || contact?.profilePictureUrl,
        isBusiness: Boolean(contact?.isBusiness),
        isGroup: normalizedJid.endsWith('@g.us'),
        raw: contact,
      };
    })
    .filter((contact: EvolutionContact) => Boolean(contact.remoteJid));
}

export async function getEvolutionContacts(instanceName: string): Promise<EvolutionContact[]> {
  try {
    const res = await evolutionFetch(`/chat/findContacts/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return normalizeContactPayload(res);
  } catch (err: any) {
    if (err instanceof EvolutionApiError && err.status === 404) {
      console.warn('[Evolution] findContacts endpoint unavailable for this instance/version');
      return [];
    }
    throw err;
  }
}

export function normalizeMessagePayload(payload: any): EvolutionMessage[] {
  return asArrayFromPayload(payload, [
    ['messages'],
    ['messages', 'records'],
    ['data', 'messages'],
    ['data', 'records'],
  ]).filter((message: any) => Boolean(message?.key?.id || message?.id));
}

export async function getEvolutionMessages(
  instanceName: string,
  remoteJid?: string,
  limit = 50
): Promise<EvolutionMessage[]> {
  const where = remoteJid ? { key: { remoteJid } } : undefined;
  const res = await evolutionFetch(`/chat/findMessages/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      ...(where ? { where } : {}),
      limit,
    }),
  });

  return normalizeMessagePayload(res);
}

// ============================================================
// Sending messages
// ============================================================

export async function sendEvolutionMessage(
  instanceName: string,
  number: string,
  text: string,
  options?: { remoteJid?: string }
) {
  // For @lid contacts or when phone is unavailable, try sending via remoteJid
  const sendNumber = number || options?.remoteJid || '';
  if (!sendNumber) {
    throw new Error('Nenhum número ou remoteJid disponível para envio.');
  }

  const payload = {
    number: sendNumber,
    // Evolution v2+: campo 'text' direto
    text,
    // Evolution v1 / legacy: campo 'textMessage' como wrapper
    textMessage: { text },
    options: {
      delay: 1200,
      presence: 'composing',
      linkPreview: false,
    },
  };

  console.log(`[sendEvolutionMessage] Sending to ${sendNumber} via ${instanceName}`);

  return evolutionFetch(`/message/sendText/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}


// ============================================================
// Helpers
// ============================================================

/** Extrai texto legível de qualquer tipo de mensagem */
export function extractMessageText(message?: EvolutionMessage['message']): string {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return `📷 ${message.imageMessage.caption}`;
  if (message.imageMessage) return '📷 Imagem';
  if (message.audioMessage) return '🎵 Áudio';
  if (message.documentMessage?.title) return `📄 ${message.documentMessage.title}`;
  if (message.documentMessage) return '📄 Documento';
  return '';
}

/** Normaliza JID → número de telefone limpo */
export function jidToPhone(jid: string): string {
  return jid.split('@')[0].split(':')[0];
}

/**
 * Fetch media (base64) from a WhatsApp message via Evolution API v2.
 * Endpoint: POST /chat/getBase64FromMediaMessage/{instanceName}
 * Body: { message: { key: { ... } } }
 */
export async function getBase64FromMediaMessage(
  instanceName: string,
  messageKey: { id: string; remoteJid: string; fromMe?: boolean },
) {
  return evolutionFetch(`/chat/getBase64FromMediaMessage/${instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      message: { key: messageKey },
    }),
  });
}
