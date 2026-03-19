'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

type Lead = { id: string; name: string; phone: string; property_id: string };
type Property = { id: string; title: string; code: string };

export default function NewVisitPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedLeadPropertyId, setSelectedLeadPropertyId] = useState('');

  useEffect(() => {
    supabase.from('leads').select('id, name, phone, property_id').then(({ data }) => {
      if (data) setLeads(data);
    });
    supabase.from('properties').select('id, title, code').then(({ data }) => {
      if (data) setProperties(data);
    });
  }, []);

  function handleLeadChange(leadId: string) {
    const lead = leads.find(l => l.id === leadId);
    if (lead) setSelectedLeadPropertyId(lead.property_id);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const form = new FormData(e.currentTarget);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Você precisa estar logado.'); setLoading(false); return; }

    const leadId = form.get('lead_id') as string;
    const propertyId = form.get('property_id') as string || selectedLeadPropertyId;

    const { error: insertError } = await supabase.from('visits').insert({
      user_id: user.id,
      lead_id: leadId,
      property_id: propertyId,
      scheduled_date: form.get('scheduled_date') as string,
      scheduled_time: form.get('scheduled_time') as string,
      notes: (form.get('notes') as string) || null,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
    } else {
      router.push('/visits');
      router.refresh();
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/visits" className="p-2 rounded-lg hover:bg-white/5 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Agendar Visita</h2>
          <p className="text-sm text-gray-400 mt-0.5">Agende uma visita a um imóvel com um lead</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[#080d18] border border-white/10 rounded-xl p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Lead (Cliente) *</label>
          <select name="lead_id" required onChange={(e) => handleLeadChange(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
            <option value="" className="bg-[#0a0f1c]">Selecione um lead</option>
            {leads.map(l => (
              <option key={l.id} value={l.id} className="bg-[#0a0f1c]">{l.name} — {l.phone}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Imóvel *</label>
          <select name="property_id" required value={selectedLeadPropertyId}
            onChange={(e) => setSelectedLeadPropertyId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
            <option value="" className="bg-[#0a0f1c]">Selecione um imóvel</option>
            {properties.map(p => (
              <option key={p.id} value={p.id} className="bg-[#0a0f1c]">{p.code} — {p.title}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Data *</label>
            <input name="scheduled_date" type="date" required
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all [color-scheme:dark]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Horário *</label>
            <input name="scheduled_time" type="time" required
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all [color-scheme:dark]" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Observações</label>
          <textarea name="notes" rows={3} placeholder="Instruções para a visita..."
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all resize-none" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/visits"
            className="px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 transition-colors font-medium">
            Cancelar
          </Link>
          <button type="submit" disabled={loading}
            className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium transition-colors">
            {loading ? 'Agendando...' : 'Agendar Visita'}
          </button>
        </div>
      </form>
    </div>
  );
}
