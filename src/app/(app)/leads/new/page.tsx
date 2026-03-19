'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

type Property = { id: string; title: string; code: string };

export default function NewLeadPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [properties, setProperties] = useState<Property[]>([]);

  useEffect(() => {
    supabase.from('properties').select('id, title, code').then(({ data }) => {
      if (data) setProperties(data);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const form = new FormData(e.currentTarget);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Você precisa estar logado.'); setLoading(false); return; }

    const { error: insertError } = await supabase.from('leads').insert({
      user_id: user.id,
      name: form.get('name') as string,
      phone: form.get('phone') as string,
      email: (form.get('email') as string) || null,
      property_id: form.get('property_id') as string,
      source: form.get('source') as string,
      temperature: form.get('temperature') as string,
      notes: (form.get('notes') as string) || null,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
    } else {
      router.push('/leads');
      router.refresh();
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/leads" className="p-2 rounded-lg hover:bg-white/5 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Novo Lead</h2>
          <p className="text-sm text-gray-400 mt-0.5">Cadastre um novo lead no sistema</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[#080d18] border border-white/10 rounded-xl p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Nome *</label>
            <input name="name" required placeholder="Nome do lead"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Telefone *</label>
            <input name="phone" required placeholder="(11) 99999-9999"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Email</label>
          <input name="email" type="email" placeholder="email@exemplo.com"
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Imóvel de Interesse *</label>
          <select name="property_id" required
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
            <option value="" className="bg-[#0a0f1c]">Selecione um imóvel</option>
            {properties.map(p => (
              <option key={p.id} value={p.id} className="bg-[#0a0f1c]">{p.code} — {p.title}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Origem</label>
            <select name="source"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
              <option value="whatsapp" className="bg-[#0a0f1c]">WhatsApp</option>
              <option value="website" className="bg-[#0a0f1c]">Site</option>
              <option value="referral" className="bg-[#0a0f1c]">Indicação</option>
              <option value="portal" className="bg-[#0a0f1c]">Portal</option>
              <option value="social_media" className="bg-[#0a0f1c]">Redes Sociais</option>
              <option value="other" className="bg-[#0a0f1c]">Outro</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Temperatura</label>
            <select name="temperature"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
              <option value="warm" className="bg-[#0a0f1c]">🟡 Morno</option>
              <option value="hot" className="bg-[#0a0f1c]">🔥 Quente</option>
              <option value="cold" className="bg-[#0a0f1c]">🔵 Frio</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Observações</label>
          <textarea name="notes" rows={3} placeholder="Anotações sobre o lead..."
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all resize-none" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/leads"
            className="px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 transition-colors font-medium">
            Cancelar
          </Link>
          <button type="submit" disabled={loading}
            className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium transition-colors">
            {loading ? 'Salvando...' : 'Salvar Lead'}
          </button>
        </div>
      </form>
    </div>
  );
}
