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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getInboxContacts,
  markChatAsRead,
  startNewConversation,
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
  phoneNumber?: string;
  avatarFallback?: string;
  isLead: boolean;
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
      // Criar contato sintético para abrir a janela de chat
      const phone = initialJid.split('@')[0];
      setSelectedContact({
        id: `synthetic_${initialJid}`,
        phone,
        remoteJid: initialJid,
        name: phone,
        lastMessage: '',
        timestamp: new Date().toISOString(),
        unreadCount: 0,
        profilePicUrl: null,
        isLead: false,
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
    try {
      await fetch('/api/whatsapp/sync-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'selectedChat', chatId: selectedContact.id, limitPerChat: 500, includeMedia: false }),
      });
      const res = await fetch(`/api/whatsapp/chats/${selectedContact.id}/messages?limit=50`);
      const data = await res.json();
      if (data.success) setMessages(data.messages || []);
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

    const result = await startNewConversation(newConvPhone.trim());

    if (result.success && result.remoteJid) {
      const phone = result.remoteJid.split('@')[0];
      const syntheticContact: Contact = {
        id: `new_${result.remoteJid}`,
        phone,
        remoteJid: result.remoteJid,
        name: newConvPhone.trim(),
        lastMessage: '',
        timestamp: new Date().toISOString(),
        unreadCount: 0,
        profilePicUrl: null,
        isLead: false,
      };
      setSelectedContact(syntheticContact);
      setNewConvPhone('');
      setShowNewConv(false);
      loadInbox(); // atualizar lista (novo contato pode já estar lá)
    } else {
      setNewConvError(result.error || 'Erro ao iniciar conversa');
    }

    setNewConvLoading(false);
  };

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
                  <button
                    key={contact.remoteJid}
                    onClick={() => setSelectedContact(contact)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left',
                      isActive
                        ? 'bg-blue-500/10 border border-blue-500/20'
                        : 'hover:bg-white/[0.04] border border-transparent'
                    )}
                  >
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      {contact.profilePicUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={contact.profilePicUrl}
                          alt={contact.name}
                          className="w-11 h-11 rounded-full object-cover border border-white/[0.08]"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
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
                      <p
                        className={cn(
                          'text-xs truncate',
                          contact.unreadCount > 0 ? 'text-blue-400 font-medium' : 'text-gray-500'
                        )}
                      >
                        {contact.lastMessage || '📎 Anexo'}
                      </p>
                    </div>
                  </button>
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
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-900/40 to-gray-800 flex items-center justify-center border border-white/[0.08] text-xs font-semibold text-blue-300">
                  {selectedContact.avatarFallback || getInitials(selectedContact.name)}
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">
                    {selectedContact.name}
                  </h3>
                  <p className="text-xs text-gray-500">{selectedContact.phone}</p>
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
                            {msg.has_media && msg.media_mimetype?.startsWith('image/') ? (
                              <div className="mb-2 overflow-hidden rounded-xl border border-white/10">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={msg.media_url || `/api/whatsapp/messages/${msg.message_id}/media`}
                                  alt={msg.media_filename || 'Imagem'}
                                  className="max-h-72 w-full object-cover"
                                />
                              </div>
                            ) : msg.has_media && msg.media_mimetype?.startsWith('audio/') ? (
                              <audio controls src={msg.media_url || `/api/whatsapp/messages/${msg.message_id}/media`} className="mb-2 max-w-full" />
                            ) : msg.has_media ? (
                              <a
                                href={msg.media_url || `/api/whatsapp/messages/${msg.message_id}/media`}
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
