'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Plus, Filter, MessageSquare, Users } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Lead = {
  id: string;
  name: string;
  status: string;
  temperature: string;
  phone: string;
  source: string;
  property_id: string | null;
  properties?: { title: string } | null;
};

type Conversation = {
  id: string;
  remote_jid: string;
  chat_name?: string | null;
  push_name: string | null;
  phone_number?: string | null;
  last_message: string | null;
  last_message_at: string | null;
  pipeline_stage: string;
  unread_count: number;
  profile_pic_url: string | null;
};

type PipelineBoardProps = {
  initialLeads: Lead[];
  properties: { id: string; title: string }[];
  initialConversations: Conversation[];
};

// ─── Colunas do Kanban ────────────────────────────────────────────────────────

const COLUMNS = [
  { id: 'new', title: 'Novos', color: 'bg-blue-500' },
  { id: 'contacted', title: 'Em Contato', color: 'bg-purple-500' },
  { id: 'credit_approved', title: 'Com Crédito', color: 'bg-green-500' },
  { id: 'scheduled_visit', title: 'Agendou Visita', color: 'bg-indigo-500' },
  { id: 'visited', title: 'Visitou', color: 'bg-orange-500' },
  { id: 'proposal', title: 'Proposta', color: 'bg-yellow-500' },
  { id: 'negotiating', title: 'Negociando', color: 'bg-pink-500' },
];

// ─── Helper ────────────────────────────────────────────────────────────────────

function jidToPhone(jid: string): string {
  if (!jid) return '';
  const lower = jid.toLowerCase();
  if (lower.includes('@lid') || lower.includes('@g.us') || lower.includes('@broadcast')) {
    return '';
  }
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12 && digits.startsWith('55')) return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return digits;
}

function isGoodName(value: string | null | undefined, remoteJid: string) {
  const name = String(value || '').trim();
  if (!name || name.includes('@') || name === remoteJid) return false;
  if (/^\d{10,}$/.test(name.replace(/\D/g, ''))) return false;
  return true;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function PipelineBoard({ initialLeads, properties, initialConversations }: PipelineBoardProps) {
  const [mode, setMode] = useState<'leads' | 'conversations'>('conversations');
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all');
  const supabase = createClient();

  // ─── Drag & Drop — Leads ──────────────────────────────────────────────────

  const handleLeadDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('itemId', id);
    e.dataTransfer.setData('itemType', 'lead');
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleLeadDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (e.dataTransfer.getData('itemType') !== 'lead') return;
    const leadId = e.dataTransfer.getData('itemId');
    if (!leadId) return;

    const leadToMove = leads.find((l) => l.id === leadId);
    if (!leadToMove || leadToMove.status === targetColumnId) return;

    const previousLeads = [...leads];
    setLeads((curr) =>
      curr.map((l) => (l.id === leadId ? { ...l, status: targetColumnId } : l))
    );

    try {
      const { error } = await supabase
        .from('leads')
        .update({ status: targetColumnId })
        .eq('id', leadId);
      if (error) throw error;
      toast.success('Lead movido');
    } catch (err: any) {
      setLeads(previousLeads);
      toast.error('Erro ao mover lead: ' + err.message);
    }
  };

  // ─── Drag & Drop — Conversas ──────────────────────────────────────────────

  const handleConvDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('itemId', id);
    e.dataTransfer.setData('itemType', 'conversation');
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleConvDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (e.dataTransfer.getData('itemType') !== 'conversation') return;
    const convId = e.dataTransfer.getData('itemId');
    if (!convId) return;

    const convToMove = conversations.find((c) => c.id === convId);
    if (!convToMove || convToMove.pipeline_stage === targetColumnId) return;

    const previousConvs = [...conversations];
    setConversations((curr) =>
      curr.map((c) => (c.id === convId ? { ...c, pipeline_stage: targetColumnId } : c))
    );

    try {
      const { error } = await supabase
        .from('whatsapp_chats')
        .update({ pipeline_stage: targetColumnId })
        .eq('id', convId);
      if (error) throw error;
      toast.success('Conversa movida');
    } catch (err: any) {
      setConversations(previousConvs);
      toast.error('Erro ao mover conversa: ' + err.message);
    }
  };

  // ─── Drag over genérico ───────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // ─── Filtros ──────────────────────────────────────────────────────────────

  const filteredLeads = leads.filter((lead) => {
    if (selectedPropertyId === 'all') return true;
    return lead.property_id === selectedPropertyId;
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col space-y-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Pipeline</h2>
          <p className="text-sm text-gray-400 mt-1">Kanban visual do seu funil de vendas</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Toggle de modo */}
          <div className="flex items-center bg-[#080d18] border border-white/10 rounded-lg p-1 gap-1">
            <button
              onClick={() => setMode('conversations')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === 'conversations'
                  ? 'bg-green-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Conversas
            </button>
            <button
              onClick={() => setMode('leads')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === 'leads'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Leads
            </button>
          </div>

          {/* Filtro de imóvel — só no modo leads */}
          {mode === 'leads' && (
            <div className="flex items-center gap-2 bg-[#080d18] border border-white/10 rounded-lg px-3 py-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={selectedPropertyId}
                onChange={(e) => setSelectedPropertyId(e.target.value)}
                className="bg-transparent text-sm text-white focus:outline-none focus:ring-0 [&>option]:bg-[#080d18]"
              >
                <option value="all">Todos os imóveis</option>
                {properties.map((prop) => (
                  <option key={prop.id} value={prop.id}>
                    {prop.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'leads' && (
            <Link
              href="/leads/new"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo Lead
            </Link>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 flex gap-6 overflow-x-auto pb-4 snap-x animate-slide-up">
        {COLUMNS.map((column) => {
          if (mode === 'leads') {
            const columnLeads = filteredLeads.filter((l) => l.status === column.id);
            return (
              <div
                key={column.id}
                className="flex-shrink-0 w-80 flex flex-col snap-center"
                onDragOver={handleDragOver}
                onDrop={(e) => handleLeadDrop(e, column.id)}
              >
                <ColumnHeader column={column} count={columnLeads.length} />
                <div className="flex-1 bg-[#080d18] border border-white/5 rounded-xl p-3 flex flex-col gap-3 overflow-y-auto">
                  {columnLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onDragStart={handleLeadDragStart}
                    />
                  ))}
                  {columnLeads.length === 0 && <EmptyDropZone />}
                </div>
              </div>
            );
          }

          // mode === 'conversations'
          const columnConvs = conversations.filter(
            (c) => (c.pipeline_stage || 'new') === column.id
          );
          return (
            <div
              key={column.id}
              className="flex-shrink-0 w-80 flex flex-col snap-center"
              onDragOver={handleDragOver}
              onDrop={(e) => handleConvDrop(e, column.id)}
            >
              <ColumnHeader column={column} count={columnConvs.length} />
              <div className="flex-1 bg-[#080d18] border border-white/5 rounded-xl p-3 flex flex-col gap-3 overflow-y-auto">
                {columnConvs.map((conv) => (
                  <ConversationCard
                    key={conv.id}
                    conv={conv}
                    onDragStart={handleConvDragStart}
                  />
                ))}
                {columnConvs.length === 0 && <EmptyDropZone />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function ColumnHeader({ column, count }: { column: typeof COLUMNS[0]; count: number }) {
  return (
    <div className="flex items-center justify-between mb-4 px-1 shrink-0">
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${column.color}`} />
        <h3 className="font-semibold text-gray-200">{column.title}</h3>
      </div>
      <span className="text-xs font-medium text-gray-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
        {count}
      </span>
    </div>
  );
}

function EmptyDropZone() {
  return (
    <div className="h-24 flex items-center justify-center border-2 border-dashed border-white/5 rounded-lg text-sm text-gray-600">
      Solte aqui
    </div>
  );
}

function LeadCard({
  lead,
  onDragStart,
}: {
  lead: Lead;
  onDragStart: (e: React.DragEvent, id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      className="bg-white/[0.03] border border-white/10 rounded-lg p-3.5 hover:bg-white/[0.05] transition-colors cursor-grab active:cursor-grabbing group shadow-sm"
    >
      <div className="flex justify-between items-start mb-2">
        <h4 className="font-medium text-gray-200 text-sm group-hover:text-blue-400 transition-colors">
          {lead.name}
        </h4>
        <span
          className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
            lead.temperature === 'hot'
              ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]'
              : lead.temperature === 'warm'
              ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]'
              : 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]'
          }`}
          title={`Temperatura: ${lead.temperature}`}
        />
      </div>
      {lead.properties && (
        <p className="text-xs text-gray-400 mb-3 truncate" title={lead.properties.title}>
          {lead.properties.title}
        </p>
      )}
      <div className="flex items-center justify-between mt-auto">
        <p className="text-xs text-gray-500">{lead.phone}</p>
        <span className="text-[10px] text-gray-500 uppercase font-medium bg-white/5 px-1.5 py-0.5 rounded">
          {lead.source}
        </span>
      </div>
    </div>
  );
}

function ConversationCard({
  conv,
  onDragStart,
}: {
  conv: Conversation;
  onDragStart: (e: React.DragEvent, id: string) => void;
}) {
  const router = useRouter();
  const rawPhone = conv.phone_number || jidToPhone(conv.remote_jid);
  const phone = rawPhone ? formatPhone(rawPhone) : '';
  const name = isGoodName(conv.chat_name, conv.remote_jid)
    ? conv.chat_name!
    : isGoodName(conv.push_name, conv.remote_jid)
      ? conv.push_name!
      : phone || 'Contato WhatsApp';
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, conv.id)}
      onClick={() => router.push(`/chat?jid=${encodeURIComponent(conv.remote_jid)}`)}
      className="bg-white/[0.03] border border-white/10 rounded-lg p-3.5 hover:bg-white/[0.05] transition-colors cursor-grab active:cursor-grabbing group shadow-sm"
    >
      <div className="flex items-start gap-2.5 mb-2">
        {/* Avatar */}
        {conv.profile_pic_url ? (
          <img
            src={conv.profile_pic_url}
            alt={name}
            className="w-8 h-8 rounded-full object-cover shrink-0 mt-0.5"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-green-600/20 border border-green-600/30 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-[10px] font-bold text-green-400">{initials}</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <h4 className="font-medium text-gray-200 text-sm group-hover:text-green-400 transition-colors truncate">
              {name}
            </h4>
            <span className="text-[10px] text-gray-500 shrink-0">
              {formatRelativeTime(conv.last_message_at)}
            </span>
          </div>
          {phone && <p className="text-xs text-gray-500">{phone}</p>}
        </div>
      </div>

      {/* Preview da última mensagem */}
      {conv.last_message && (
        <p className="text-xs text-gray-400 truncate mb-2 pl-10" title={conv.last_message}>
          {conv.last_message}
        </p>
      )}

      <div className="flex items-center justify-between pl-10">
        <span className="flex items-center gap-1 text-[10px] text-green-500 font-medium">
          <MessageSquare className="w-3 h-3" />
          WhatsApp
        </span>
        {conv.unread_count > 0 && (
          <span className="text-[10px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded-full">
            {conv.unread_count}
          </span>
        )}
      </div>
    </div>
  );
}
