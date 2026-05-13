'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Search,
  Check,
  CheckCheck,
  Clock,
  RefreshCw,
  MessageSquareDashed,
  ArrowLeft,
  Smartphone,
  WifiOff,
  RotateCcw,
  Plus,
  X,
  MoreVertical,
  Archive,
  Trash2,
  FileText,
  Download,
  Image as ImageIcon,
  Volume2,
  Video,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getInboxContacts,
  markChatAsRead,
} from '@/app/(app)/settings/whatsapp/actions';
import { createClient } from '@/lib/supabase/client';

// ============================================================
// Helpers
// ============================================================

function formatTime(isoString: string | null) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString: string | null) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (date.toDateString() === new Date().toDateString()) return formatTime(isoString);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function getInitials(name: string) {
  if (!name) return '?';
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

function getMediaKind(msg: Message) {
  const type = (msg.message_type || '').toLowerCase();
  const mime = (msg.media_mimetype || '').toLowerCase();
  if (mime.startsWith('image/') || type.includes('imagemessage') || type.includes('sticker')) return 'image';
  if (mime.startsWith('audio/') || type.includes('audiomessage')) return 'audio';
  if (mime.startsWith('video/') || type.includes('videomessage')) return 'video';
  if (msg.has_media) return 'file';
  return null;
}

// ============================================================
// Types
// ============================================================

interface Contact {
  id: string;
  phone: string;
  remoteJid: string;
  name: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  profilePicUrl: string | null;
  displayName?: string;
  displayNameSource?: string;
  phoneNumber?: string;
  formattedPhone?: string;
  avatarFallback?: string;
  isLead: boolean;
  isLid?: boolean;
  canSendMessage?: boolean;
  sendJid?: string | null;
  identityConfidence?: 'high' | 'medium' | 'low';
  identitySource?: string;
  possibleWrongPhone?: boolean;
  possibleWrongProfilePic?: boolean;
}

interface Message {
  id: string;
  message_id?: string;
  content: string;
  direction: 'inbound' | 'outbound';
  status: string;
  created_at: string;
  push_name?: string;
  remote_jid?: string;
  message_type?: string;
  has_media?: boolean;
  media_mimetype?: string | null;
  media_filename?: string | null;
  media_url?: string | null;
  _error?: string;
}

function mediaLabel(kind: ReturnType<typeof getMediaKind>) {
  if (kind === 'image') return 'imagem';
  if (kind === 'audio') return 'audio';
  if (kind === 'video') return 'video';
  return 'midia';
}

function mediaSource(msg: Message) {
  const token = msg.id || msg.message_id;
  return token ? `/api/whatsapp/messages/${encodeURIComponent(token)}/media` : msg.media_url || '';
}

function MediaAttachment({ msg }: { msg: Message }) {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const kind = getMediaKind(msg);
  const src = mediaSource(msg);
  const filename = msg.media_filename || mediaLabel(kind);

  if (!kind) return null;

  const fallback = (
    <div className="mb-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-300">
      <div className="flex items-center gap-2">
        {kind === 'image' ? <ImageIcon className="h-4 w-4" /> : kind === 'audio' ? <Volume2 className="h-4 w-4" /> : kind === 'video' ? <Video className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        <span className="min-w-0 flex-1 truncate">
          {failed ? 'Nao foi possivel carregar midia' : filename}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        {src && (
          <a
            href={`${src}${src.includes('?') ? '&' : '?'}retry=${retryKey}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-2 py-1 text-blue-100 hover:bg-white/[0.1]"
          >
            <Download className="h-3.5 w-3.5" />
            Abrir
          </a>
        )}
        {failed && (
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setRetryKey((value) => value + 1);
            }}
            className="rounded-lg bg-white/[0.06] px-2 py-1 text-gray-100 hover:bg-white/[0.1]"
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );

  if (!src || failed) return fallback;
  const keyedSrc = `${src}${src.includes('?') ? '&' : '?'}retry=${retryKey}`;

  if (kind === 'image') {
    return (
      <div className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={keyedSrc}
          alt={filename}
          className="max-h-72 w-full object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className="mb-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
        <audio controls src={keyedSrc} className="w-full max-w-[260px]" onError={() => setFailed(true)} />
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <video
        controls
        src={keyedSrc}
        className="mb-2 max-h-72 max-w-full rounded-xl border border-white/10 bg-black/20"
        onError={() => setFailed(true)}
      />
    );
  }

  return fallback;
}


// ============================================================
// ChatInterface Component
// ============================================================

export function ChatInterface({
  instanceName,
  initialJid,
  refreshKey,
}: {
  instanceName?: string;
  initialJid?: string;
  refreshKey?: number;
}) {
  const [inbox, setInbox] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingInbox, setIsLoadingInbox] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [brokenAvatars, setBrokenAvatars] = useState<Set<string>>(() => new Set());
  const [openMenuJid, setOpenMenuJid] = useState<string | null>(null);
  const [chatActionError, setChatActionError] = useState('');

  // Modal nova conversa
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvPhone, setNewConvPhone] = useState('');
  const [newConvLoading, setNewConvLoading] = useState(false);
  const [newConvError, setNewConvError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Rastreia se o initialJid já foi tratado para não re-selecionar em updates do inbox
  const initialJidHandled = useRef(false);
  const supabase = createClient();

  // ============================================================
  // Carregar inbox
  // ============================================================

  const loadInbox = useCallback(async () => {
    setIsLoadingInbox(true);
    try {
      const contacts = await getInboxContacts();
      setInbox(contacts);
    } finally {
      setIsLoadingInbox(false);
    }
  }, []);

  useEffect(() => {
    loadInbox();
  }, [loadInbox, refreshKey]);

  // ============================================================
  // Auto-selecionar conversa via initialJid (vindo do Pipeline)
  // ============================================================

  useEffect(() => {
    if (!initialJid || initialJidHandled.current) return;
    if (isLoadingInbox) return; // aguardar inbox carregar

    const contact = inbox.find((c) => c.remoteJid === initialJid);
    if (contact) {
      setSelectedContact(contact);
      initialJidHandled.current = true;
    } else if (!isLoadingInbox) {
      // Contato não está no inbox (nova conversa ou não sincronizada)
      // Criar contato sintético — usar 'Contato WhatsApp' se for @lid
      const isLid = initialJid.includes('@lid');
      setSelectedContact({
        id: `synthetic_${initialJid}`,
        phone: '',
        remoteJid: initialJid,
        name: isLid ? 'Contato WhatsApp' : 'Contato WhatsApp',
        lastMessage: '',
        timestamp: new Date().toISOString(),
        unreadCount: 0,
        profilePicUrl: null,
        isLead: false,
        isLid,
        canSendMessage: true,
        sendJid: initialJid,
      });
      initialJidHandled.current = true;
    }
  }, [inbox, initialJid, isLoadingInbox]);

  // ============================================================
  // Supabase Realtime — escutar novas mensagens e chats
  // ============================================================

  useEffect(() => {
    const channel = supabase
      .channel('whatsapp_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_messages' },
        (payload) => {
          const newMsg = payload.new as any;
          if (!newMsg) return;

          // Atualizar mensagens se for da conversa aberta
          if (selectedContact && newMsg.remote_jid === selectedContact.remoteJid) {
            const normalized: Message = {
              id: newMsg.id,
              message_id: newMsg.message_key,
              content: newMsg.content || '',
              direction: newMsg.from_me ? 'outbound' : 'inbound',
              status: newMsg.status || 'delivered',
              created_at: newMsg.sent_at || newMsg.created_at,
              push_name: newMsg.push_name,
              remote_jid: newMsg.remote_jid,
              message_type: newMsg.message_type,
              has_media: newMsg.has_media,
              media_mimetype: newMsg.media_mimetype,
              media_filename: newMsg.media_filename,
              media_url: newMsg.media_url,
            };

            if (payload.eventType === 'INSERT') {
              setMessages((prev) => {
                // Não duplicar
                if (prev.some((m) => m.message_id === newMsg.message_key)) return prev;
                return [...prev, normalized];
              });
            } else if (payload.eventType === 'UPDATE') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.message_id === newMsg.message_key ? { ...m, status: newMsg.status } : m
                )
              );
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_chats' },
        () => {
          // Recarregar inbox quando um chat mudar
          loadInbox();
        }
      )
      .subscribe((status) => {
        setIsOnline(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedContact, loadInbox]);

  // ============================================================
  // Scroll automático para última mensagem
  // ============================================================

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // ============================================================
  // Carregar histórico ao selecionar contato
  // ============================================================

  useEffect(() => {
    if (!selectedContact) return;

    let isMounted = true;
    setIsLoadingHistory(true);
    setHistoryError('');
    setMessages([]);

    if (selectedContact.id.startsWith('synthetic_') || selectedContact.id.startsWith('new_')) {
      setIsLoadingHistory(false);
      return () => {
        isMounted = false;
      };
    }

    fetch(`/api/whatsapp/chats/${selectedContact.id}/messages?limit=50`)
      .then((res) => res.json())
      .then((result) => {
        if (!isMounted) return;
        if (!result.success) {
          setHistoryError(result.error || 'Erro ao carregar mensagens');
          setMessages([]);
        } else {
          setMessages((result.messages as Message[]) || []);
        }
      })
      .catch((err) => {
        if (isMounted) setHistoryError(err instanceof Error ? err.message : 'Erro ao carregar mensagens');
      })
      .finally(() => {
        if (isMounted) setIsLoadingHistory(false);
      });

    if (selectedContact.unreadCount > 0) {
      markChatAsRead(selectedContact.remoteJid).then(() => {
        setInbox((prev) =>
          prev.map((c) =>
            c.remoteJid === selectedContact.remoteJid ? { ...c, unreadCount: 0 } : c
          )
        );
      });
    }

    return () => {
      isMounted = false;
    };
  }, [selectedContact]);

  // ============================================================
  // Enviar mensagem
  // ============================================================

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() || !selectedContact || isSending) return;

    const contentToSend = newMessage.trim();
    setNewMessage('');
    setIsSending(true);

    // Mensagem otimista
    const tempId = `temp_${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      message_id: tempId,
      content: contentToSend,
      direction: 'outbound',
      status: 'sending',
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);
    setInbox((prev) =>
      prev
        .map((c) =>
          c.remoteJid === selectedContact.remoteJid
            ? { ...c, lastMessage: contentToSend, timestamp: new Date().toISOString() }
            : c
        )
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    );

    // Helper: garante string legível independente do formato do erro
    function normalizeError(e: unknown): string {
      if (!e) return 'Erro desconhecido no envio';
      if (typeof e === 'string') return e;
      if (Array.isArray(e)) return e.join(' | ');
      if (e instanceof Error) return e.message || 'Erro desconhecido';
      if (typeof e === 'object') {
        const o = e as Record<string, unknown>;
        return (
          (typeof o.message === 'string' ? o.message : '') ||
          (typeof o.error === 'string' ? o.error : '') ||
          JSON.stringify(e)
        );
      }
      return String(e);
    }

    try {
      const response = await fetch('/api/whatsapp/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: selectedContact.id,
          remoteJid: selectedContact.remoteJid,
          text: contentToSend,
        }),
      });
      const result = await response.json();

      if (!result.success) {
        const errMsg = normalizeError(result.error);
        console.error('[Chat] sendChatMessage failed:', { raw: result.error, normalized: errMsg });
        if ((result as any).details) {
          console.debug('[Chat] send-message details:', (result as any).details);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId ? { ...m, status: 'failed', _error: errMsg } : m
          )
        );

      } else {
        setMessages((prev) =>
          prev.map((m) => (
            m.id === tempId
              ? {
                  ...m,
                  id: result.message?.id || tempId,
                  message_id: result.message?.message_id || result.message?.message_key || tempId,
                  status: 'sent',
                }
              : m
          ))
        );
      }
    } catch (err: unknown) {
      const errMsg = normalizeError(err);
      console.error('[Chat] sendChatMessage exception:', { raw: err, normalized: errMsg });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, status: 'failed', _error: errMsg } : m
        )
      );
    } finally {
      setIsSending(false);
    }

  };

  async function syncSelectedHistory() {
    if (!selectedContact || selectedContact.id.startsWith('synthetic_') || selectedContact.id.startsWith('new_')) return;
    setIsSyncingHistory(true);
    setHistoryError('');
    try {
      const syncRes = await fetch('/api/whatsapp/sync-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'selectedChat', chatId: selectedContact.id, limitPerChat: 500, includeMedia: false }),
      });
      const syncData = await syncRes.json();

      // Reload messages from database
      const res = await fetch(`/api/whatsapp/chats/${selectedContact.id}/messages?limit=50`);
      const data = await res.json();
      if (data.success) setMessages(data.messages || []);

      // Show feedback
      if (syncData.success) {
        if (syncData.imported > 0) {
          setHistoryError(`✅ ${syncData.imported} mensagens importadas.`);
        } else {
          setHistoryError('Não há mais mensagens disponíveis.');
        }
      } else {
        const errorMsg = syncData.errors?.[0]?.error || 'Erro ao buscar histórico.';
        setHistoryError(`❌ ${errorMsg}`);
      }
      // Clear feedback after 5 seconds
      setTimeout(() => setHistoryError(''), 5000);
    } catch (err: any) {
      setHistoryError(`❌ ${err?.message || 'Erro ao buscar histórico'}`);
    } finally {
      setIsSyncingHistory(false);
    }
  }


  // ============================================================
  // Nova conversa — submit do modal
  // ============================================================

  const handleNewConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConvPhone.trim() || newConvLoading) return;
    setNewConvLoading(true);
    setNewConvError('');

    let result: any;
    try {
      const response = await fetch('/api/whatsapp/start-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: newConvPhone.trim() }),
      });
      result = await response.json();
      if (!response.ok && result?.error) {
        result = { success: false, error: result.error };
      }
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : 'Erro ao iniciar conversa',
      };
    }

    if (result.success && result.remoteJid) {
      // Use backend-returned data — never parse JID in frontend
      const chat = result.chat;
      const newContact: Contact = {
        id: chat?.id || `new_${result.remoteJid}`,
        phone: chat?.formattedPhone || '',
        remoteJid: result.remoteJid,
        name: chat?.displayName || chat?.formattedPhone || 'Contato WhatsApp',
        displayName: chat?.displayName,
        displayNameSource: chat?.displayNameSource,
        phoneNumber: chat?.phoneNumber,
        formattedPhone: chat?.formattedPhone,
        avatarFallback: chat?.avatarFallback,
        canSendMessage: chat?.canSendMessage ?? true,
        sendJid: chat?.sendJid,
        lastMessage: '',
        timestamp: new Date().toISOString(),
        unreadCount: 0,
        profilePicUrl: chat?.profilePicUrl || null,
        isLead: false,
      };
      setSelectedContact(newContact);
      setNewConvPhone('');
      setShowNewConv(false);
      loadInbox(); // atualizar lista (novo contato pode já estar lá)
    } else {
      setNewConvError(result.error || 'Erro ao iniciar conversa');
    }

    setNewConvLoading(false);
  };

  async function updateChatVisibility(contact: Contact, action: 'archive' | 'delete-local') {
    if (contact.id.startsWith('synthetic_') || contact.id.startsWith('new_')) return;
    if (action === 'delete-local') {
      const confirmed = window.confirm('Excluir esta conversa apenas do CRM? As mensagens nao serao apagadas fisicamente.');
      if (!confirmed) return;
    }

    setChatActionError('');
    setOpenMenuJid(null);
    try {
      const response = await fetch(`/api/whatsapp/chats/${contact.id}/${action}`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Nao foi possivel atualizar a conversa.');
      }
      setInbox((prev) => prev.filter((item) => item.id !== contact.id));
      if (selectedContact?.id === contact.id) {
        setSelectedContact(null);
        setMessages([]);
      }
    } catch (error) {
      setChatActionError(error instanceof Error ? error.message : 'Erro ao atualizar conversa.');
    }
  }

  const filteredInbox = inbox.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery)
  );

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex w-full h-full bg-[#060a14] overflow-hidden text-white">
      {/* ---- Sidebar de Conversas ---- */}
      <div
        className={cn(
          'w-full lg:w-[360px] flex-shrink-0 flex flex-col border-r border-white/[0.06] bg-[#080d18]/50',
          selectedContact ? 'hidden lg:flex' : 'flex'
        )}
      >
        {/* Header */}
        <div className="h-14 flex-shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06]">
          <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-blue-500" />
            Conversas
          </h2>
          <div className="flex items-center gap-2">
            {!isOnline && (
              <span title="Tempo real desconectado">
                <WifiOff className="w-4 h-4 text-amber-500" />
              </span>
            )}
            {/* Botão nova conversa */}
            <button
              onClick={() => { setShowNewConv(true); setNewConvError(''); setNewConvPhone(''); }}
              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.05] transition-colors"
              title="Nova conversa"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={loadInbox}
              disabled={isLoadingInbox}
              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.05] transition-colors"
              title="Recarregar conversas"
            >
              <RotateCcw className={cn('w-3.5 h-3.5', isLoadingInbox && 'animate-spin text-blue-500')} />
            </button>
          </div>
        </div>

        {/* Modal nova conversa (inline, simples) */}
        {showNewConv && (
          <div className="p-3 border-b border-white/[0.06] bg-[#0a1020] animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-300">Nova conversa</span>
              <button
                onClick={() => setShowNewConv(false)}
                className="text-gray-600 hover:text-gray-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <form onSubmit={handleNewConversation} className="flex gap-2">
              <input
                type="tel"
                value={newConvPhone}
                onChange={(e) => setNewConvPhone(e.target.value)}
                placeholder="Ex: 11999998888"
                autoFocus
                className="flex-1 h-8 px-3 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
              <button
                type="submit"
                disabled={!newConvPhone.trim() || newConvLoading}
                className="px-3 h-8 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
              >
                {newConvLoading ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}
                Abrir
              </button>
            </form>
            {newConvError && (
              <p className="text-xs text-red-400 mt-1.5">{newConvError}</p>
            )}
            <p className="text-[10px] text-gray-600 mt-1.5">
              Digite o número sem formatação. Código BR (55) é adicionado automaticamente.
            </p>
          </div>
        )}

        {/* Search */}
        <div className="p-3 flex-shrink-0 border-b border-white/[0.06]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar por nome ou número..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-4 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          {chatActionError && (
            <p className="mt-2 text-xs text-red-400">{chatActionError}</p>
          )}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
          {isLoadingInbox ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500">Carregando conversas...</p>
            </div>
          ) : filteredInbox.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
              <MessageSquareDashed className="w-10 h-10 text-gray-700" />
              <div>
                <p className="text-gray-400 font-medium text-sm">Nenhuma conversa</p>
                <p className="text-gray-600 text-xs mt-1">
                  {searchQuery ? 'Tente outro termo' : 'Sincronize ou inicie uma nova conversa'}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-0.5">
              {filteredInbox.map((contact) => {
                const isActive = selectedContact?.remoteJid === contact.remoteJid;
                return (
                  <div
                    key={contact.remoteJid}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedContact(contact)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setSelectedContact(contact);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left cursor-pointer',
                      isActive
                        ? 'bg-blue-500/10 border border-blue-500/20'
                        : 'hover:bg-white/[0.04] border border-transparent'
                    )}
                  >
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      {contact.profilePicUrl && !brokenAvatars.has(contact.remoteJid) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={contact.profilePicUrl}
                          alt={contact.name}
                          className="w-11 h-11 rounded-full object-cover border border-white/[0.08]"
                          onError={() => setBrokenAvatars((prev) => new Set(prev).add(contact.remoteJid))}
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-900/40 to-gray-800 flex items-center justify-center border border-white/[0.08] text-sm font-semibold text-blue-300">
                          {contact.avatarFallback || getInitials(contact.name)}
                        </div>
                      )}
                      {contact.unreadCount > 0 && (
                        <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white shadow-lg shadow-blue-500/30">
                          {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <span
                          className={cn(
                            'font-medium text-sm truncate',
                            contact.unreadCount > 0 ? 'text-white' : 'text-gray-200'
                          )}
                        >
                          {contact.name}
                        </span>
                        <span className="text-[11px] text-gray-500 flex-shrink-0 ml-2">
                          {formatDate(contact.timestamp)}
                        </span>
                      </div>
                      {contact.formattedPhone && contact.formattedPhone !== contact.name && (
                        <p className="text-[11px] text-gray-500 truncate">{contact.formattedPhone}</p>
                      )}
                      <p
                        className={cn(
                          'text-xs truncate',
                          contact.unreadCount > 0 ? 'text-blue-400 font-medium' : 'text-gray-500'
                        )}
                      >
                        {contact.lastMessage || '📎 Anexo'}
                      </p>
                    </div>
                    <div className="relative flex-shrink-0">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuJid((current) => current === contact.remoteJid ? null : contact.remoteJid);
                        }}
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
                        title="Acoes da conversa"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {openMenuJid === contact.remoteJid && (
                        <div
                          onClick={(event) => event.stopPropagation()}
                          className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-white/10 bg-[#111827] p-1 shadow-xl"
                        >
                          <button
                            type="button"
                            onClick={() => updateChatVisibility(contact, 'archive')}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-gray-200 hover:bg-white/[0.06]"
                          >
                            <Archive className="h-3.5 w-3.5" />
                            Arquivar conversa
                          </button>
                          <button
                            type="button"
                            onClick={() => updateChatVisibility(contact, 'delete-local')}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-red-200 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Excluir do CRM
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---- Painel de Mensagens ---- */}
      <div
        className={cn(
          'flex-1 flex flex-col h-full bg-[#060a14] relative',
          !selectedContact ? 'hidden lg:flex' : 'flex'
        )}
      >
        {!selectedContact ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-500">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-center mb-4">
              <MessageSquareDashed className="w-8 h-8 text-gray-700" />
            </div>
            <h3 className="text-base font-medium text-gray-400 mb-1">Selecione uma conversa</h3>
            <p className="max-w-xs text-sm text-gray-600">
              Clique em uma conversa à esquerda ou inicie uma nova pelo botão +.
            </p>
          </div>
        ) : (
          <>
            {/* Header da conversa */}
            <div className="h-14 flex-shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06] bg-[#060a14]/90 backdrop-blur-md z-10">
              <div className="flex items-center gap-3">
                <button
                  className="lg:hidden p-2 -ml-2 text-gray-400 hover:text-white transition-colors"
                  onClick={() => setSelectedContact(null)}
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                {selectedContact.profilePicUrl && !brokenAvatars.has(selectedContact.remoteJid) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedContact.profilePicUrl}
                    alt={selectedContact.name}
                    className="w-9 h-9 rounded-full object-cover border border-white/[0.08]"
                    onError={() => setBrokenAvatars((prev) => new Set(prev).add(selectedContact.remoteJid))}
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-900/40 to-gray-800 flex items-center justify-center border border-white/[0.08] text-xs font-semibold text-blue-300">
                    {selectedContact.avatarFallback || getInitials(selectedContact.name)}
                  </div>
                )}
                <div>
                  <h3 className="font-semibold text-white text-sm">
                    {selectedContact.name}
                  </h3>
                  {selectedContact.formattedPhone && selectedContact.formattedPhone !== selectedContact.name && (
                    <p className="text-xs text-gray-500">{selectedContact.formattedPhone}</p>
                  )}
                  {!selectedContact.formattedPhone && selectedContact.phone && !selectedContact.phone.includes('@') && (
                    <p className="text-xs text-gray-500">{selectedContact.phone}</p>
                  )}
                </div>
              </div>
              <button
                onClick={syncSelectedHistory}
                disabled={isSyncingHistory}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] rounded-lg border border-white/[0.06] transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncingHistory ? 'animate-spin' : ''}`} />
                Buscar mais histórico
              </button>
            </div>

            {/* Mensagens */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto p-4 lg:p-5 custom-scrollbar"
              style={{
                background:
                  'radial-gradient(ellipse at 50% 0%, rgba(37,99,235,0.03) 0%, transparent 60%)',
              }}
            >
              {isLoadingHistory ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                </div>
              ) : historyError ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <p className="text-sm text-red-400">{historyError}</p>
                  <button
                    onClick={() => setSelectedContact({ ...selectedContact })}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-xs text-gray-200 hover:bg-white/[0.1]"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-gray-600">Nenhuma mensagem encontrada.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1 pb-2">
                  {messages.map((msg, idx) => {
                    const isMe = msg.direction === 'outbound';
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const showDateSep =
                      !prevMsg ||
                      new Date(msg.created_at).toDateString() !==
                        new Date(prevMsg.created_at).toDateString();
                    let mediaKind: ReturnType<typeof getMediaKind> = null;
                    let mediaSrc = '';
                    return (
                      <div key={msg.id || idx}>
                        {showDateSep && (
                          <div className="flex items-center justify-center my-3">
                            <span className="px-3 py-1 text-[11px] text-gray-500 bg-white/[0.04] rounded-full border border-white/[0.06]">
                              {new Date(msg.created_at).toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                          </div>
                        )}
                        <div
                          className={cn(
                            'flex w-full mt-0.5',
                            isMe ? 'justify-end' : 'justify-start'
                          )}
                        >
                          <div
                            className={cn(
                              'relative max-w-[80%] sm:max-w-[65%] px-3.5 py-2 text-[14px] leading-relaxed shadow-sm',
                              isMe
                                ? msg.status === 'failed'
                                  ? 'bg-red-900/40 border border-red-500/30 text-red-100 rounded-2xl rounded-br-sm'
                                  : 'bg-blue-600 text-white rounded-2xl rounded-br-sm'
                                : 'bg-[#161c28] border border-white/[0.04] text-gray-100 rounded-2xl rounded-bl-sm'
                            )}
                          >
                            <MediaAttachment msg={msg} />
                            {mediaKind === 'image' && mediaSrc ? (
                              <div className="mb-2 overflow-hidden rounded-xl border border-white/10">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={mediaSrc}
                                  alt={msg.media_filename || 'Imagem'}
                                  className="max-h-72 w-full object-cover"
                                />
                              </div>
                            ) : mediaKind === 'audio' && mediaSrc ? (
                              <audio controls src={mediaSrc} className="mb-2 max-w-full" />
                            ) : mediaKind === 'video' && mediaSrc ? (
                              <video controls src={mediaSrc} className="mb-2 max-h-72 max-w-full rounded-xl border border-white/10" />
                            ) : mediaKind === 'file' && mediaSrc ? (
                              <a
                                href={mediaSrc}
                                target="_blank"
                                rel="noreferrer"
                                className="mb-2 block rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-blue-100 hover:bg-black/30"
                              >
                                Carregar mídia {msg.media_filename ? `- ${msg.media_filename}` : ''}
                              </a>
                            ) : null}
                            {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                            <div
                              className={cn(
                                'flex items-center justify-end gap-1 mt-1 -mb-0.5',
                                isMe ? 'text-blue-200/70' : 'text-gray-600'
                              )}
                            >
                              <span className="text-[10px] font-medium">
                                {formatTime(msg.created_at)}
                              </span>
                              {isMe && (
                                <span>
                                  {msg.status === 'read' ? (
                                    <CheckCheck className="w-3 h-3 text-blue-300" />
                                  ) : msg.status === 'delivered' ? (
                                    <CheckCheck className="w-3 h-3" />
                                  ) : msg.status === 'sent' ? (
                                    <Check className="w-3 h-3" />
                                  ) : msg.status === 'sending' ? (
                                    <Clock className="w-3 h-3 opacity-60" />
                                  ) : msg.status === 'failed' ? (
                                    <span
                                      className="text-red-400 text-xs font-bold cursor-help"
                                      title={msg._error || 'Falha no envio. Verifique conexão com o WhatsApp.'}
                                    >
                                      ✕ Falha
                                    </span>
                                  ) : (
                                    <Check className="w-3 h-3 opacity-40" />
                                  )}
                                </span>
                              )}
                            </div>
                          </div>

                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input */}
            <div className="flex-shrink-0 p-3 border-t border-white/[0.06] bg-[#080d18]">
              <form
                onSubmit={handleSendMessage}
                className="flex items-end gap-2 max-w-4xl mx-auto"
              >
                <div className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden focus-within:border-blue-500/40 transition-colors">
                  <textarea
                    value={newMessage}
                    onChange={(e) => {
                      setNewMessage(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Digite uma mensagem..."
                    className="w-full min-h-[44px] max-h-32 p-3 bg-transparent text-white text-sm focus:outline-none resize-none custom-scrollbar"
                    rows={1}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!newMessage.trim() || isSending}
                  className="h-11 w-11 flex-shrink-0 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-white disabled:opacity-40 disabled:hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                >
                  {isSending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 ml-0.5" />
                  )}
                </button>
              </form>
              <p className="text-center text-[10px] text-gray-700 mt-2">
                Enter para enviar · Shift+Enter para nova linha
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
