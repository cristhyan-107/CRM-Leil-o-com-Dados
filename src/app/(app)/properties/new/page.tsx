'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function NewPropertyPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const form = new FormData(e.currentTarget);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Você precisa estar logado.'); setLoading(false); return; }

    const { error: insertError } = await supabase.from('properties').insert({
      user_id: user.id,
      title: form.get('title') as string,
      code: 'AUTO',
      type: form.get('type') as string,
      purpose: form.get('purpose') as string,
      price: parseFloat(form.get('price') as string),
      city: form.get('city') as string,
      neighborhood: form.get('neighborhood') as string,
      state: (form.get('state') as string) || null,
      address: (form.get('address') as string) || null,
      bedrooms: parseInt(form.get('bedrooms') as string) || 0,
      bathrooms: parseInt(form.get('bathrooms') as string) || 0,
      parking_spaces: parseInt(form.get('parking_spaces') as string) || 0,
      area: parseFloat(form.get('area') as string) || null,
      description: (form.get('description') as string) || null,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
    } else {
      router.push('/properties');
      router.refresh();
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/properties" className="p-2 rounded-lg hover:bg-white/5 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Novo Imóvel</h2>
          <p className="text-sm text-gray-400 mt-0.5">Cadastre um novo imóvel no portfólio</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[#080d18] border border-white/10 rounded-xl p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Título do Imóvel *</label>
          <input name="title" required placeholder="Ex: Apartamento 3 quartos em Copacabana"
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Tipo *</label>
            <select name="type" required
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
              <option value="house" className="bg-[#0a0f1c]">Casa</option>
              <option value="apartment" className="bg-[#0a0f1c]">Apartamento</option>
              <option value="land" className="bg-[#0a0f1c]">Terreno</option>
              <option value="commercial" className="bg-[#0a0f1c]">Comercial</option>
              <option value="farm" className="bg-[#0a0f1c]">Chácara/Sítio</option>
              <option value="other" className="bg-[#0a0f1c]">Outro</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Finalidade *</label>
            <select name="purpose" required
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
              <option value="sale" className="bg-[#0a0f1c]">Venda</option>
              <option value="rent" className="bg-[#0a0f1c]">Aluguel</option>
              <option value="both" className="bg-[#0a0f1c]">Ambos</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Preço (R$) *</label>
            <input name="price" type="number" step="0.01" required placeholder="500000"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Cidade *</label>
            <input name="city" required placeholder="São Paulo"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Bairro *</label>
            <input name="neighborhood" required placeholder="Copacabana"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Estado</label>
            <input name="state" placeholder="RJ"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Endereço</label>
          <input name="address" placeholder="Rua Exemplo, 123"
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Quartos</label>
            <input name="bedrooms" type="number" min="0" defaultValue="0"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Banheiros</label>
            <input name="bathrooms" type="number" min="0" defaultValue="0"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Vagas</label>
            <input name="parking_spaces" type="number" min="0" defaultValue="0"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Área (m²)</label>
            <input name="area" type="number" step="0.01" placeholder="120"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Descrição</label>
          <textarea name="description" rows={3} placeholder="Detalhes do imóvel..."
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all resize-none" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/properties"
            className="px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 transition-colors font-medium">
            Cancelar
          </Link>
          <button type="submit" disabled={loading}
            className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium transition-colors">
            {loading ? 'Salvando...' : 'Salvar Imóvel'}
          </button>
        </div>
      </form>
    </div>
  );
}
