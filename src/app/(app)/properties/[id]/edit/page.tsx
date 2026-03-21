'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function EditPropertyPage() {
  const router = useRouter();
  const params = useParams();
  const propertyId = params?.id as string;
  const supabase = createClient();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [property, setProperty] = useState<any>(null);

  useEffect(() => {
    async function loadProperty() {
      if (!propertyId) return;
      
      const { data, error: fetchError } = await supabase
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .single();
        
      if (fetchError) {
        setError('Erro ao carregar imóvel: ' + fetchError.message);
      } else if (data) {
        setProperty(data);
      }
      setLoading(false);
    }
    
    loadProperty();
  }, [propertyId, supabase]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const form = new FormData(e.currentTarget);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Você precisa estar logado.'); setSaving(false); return; }

    const updates = {
      title: form.get('title') as string,
      type: (form.get('type') as string) || 'house',
      purpose: (form.get('purpose') as string) || 'sale',
      price: parseFloat(form.get('price') as string) || 0,
      city: (form.get('city') as string) || '',
      neighborhood: (form.get('neighborhood') as string) || '',
      state: (form.get('state') as string) || null,
      address: (form.get('address') as string) || null,
      bedrooms: parseInt(form.get('bedrooms') as string) || 0,
      bathrooms: parseInt(form.get('bathrooms') as string) || 0,
      parking_spaces: parseInt(form.get('parking_spaces') as string) || 0,
      area: parseFloat(form.get('area') as string) || null,
      description: (form.get('description') as string) || null,
      status: (form.get('status') as string) || 'available',
    };

    const { data: updateData, error: updateError } = await supabase
      .from('properties')
      .update(updates)
      .eq('id', propertyId)
      .select();

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
    } else if (!updateData || updateData.length === 0) {
      setError('A edição falhou: O imóvel não foi encontrado ou você não tem permissão.');
      setSaving(false);
    } else {
      router.push('/properties');
      router.refresh();
    }
  }

  async function handleDelete() {
    if (!confirm('Tem certeza que deseja excluir este imóvel?')) return;
    setDeleting(true);
    setError('');
    
    // Usa soft delete (atualizando deleted_at) pois o imóvel pode ter leads e gerar erro de Foreign Key
    const { data: deleteData, error: deleteError } = await supabase
      .from('properties')
      .update({ deleted_at: new Date().toISOString(), status: 'inactive' })
      .eq('id', propertyId)
      .select();
      
    if (deleteError) {
      setError('Erro ao excluir: ' + deleteError.message);
      setDeleting(false);
    } else if (!deleteData || deleteData.length === 0) {
      setError('A exclusão falhou: O imóvel não foi encontrado ou você não tem permissão.');
      setDeleting(false);
    } else {
      router.push('/properties');
      router.refresh();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!property && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4">
        <h3 className="text-lg font-medium text-gray-200">Imóvel não encontrado</h3>
        <p className="text-sm text-gray-500 mt-1">Este imóvel pode ter sido excluído.</p>
        <Link href="/properties" className="mt-4 text-blue-500 hover:text-blue-400">Voltar para a lista</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/properties" className="p-2 rounded-lg hover:bg-white/5 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Editar Imóvel</h2>
          <p className="text-sm text-gray-400 mt-0.5">Atualize as informações do imóvel selecionado</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[#080d18] border border-white/10 rounded-xl p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Status</label>
            <select name="status" defaultValue={property?.status}
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
              <option value="available" className="bg-[#0a0f1c]">Disponível</option>
              <option value="sold" className="bg-[#0a0f1c]">Vendido</option>
              <option value="unavailable" className="bg-[#0a0f1c]">Indisponível</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Código</label>
            <input type="text" disabled value={property?.code || ''} className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-gray-500 cursor-not-allowed" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Título do Imóvel *</label>
          <input name="title" defaultValue={property?.title} required placeholder="Ex: Apartamento 3 quartos em Copacabana"
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Tipo</label>
            <select name="type" defaultValue={property?.type}
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
            <label className="text-sm font-medium text-gray-300">Finalidade</label>
            <select name="purpose" defaultValue={property?.purpose}
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all">
              <option value="sale" className="bg-[#0a0f1c]">Venda</option>
              <option value="rent" className="bg-[#0a0f1c]">Aluguel</option>
              <option value="both" className="bg-[#0a0f1c]">Ambos</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Preço (R$)</label>
            <input name="price" defaultValue={property?.price} type="number" step="0.01" placeholder="500000"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Cidade</label>
            <input name="city" defaultValue={property?.city} placeholder="São Paulo"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Bairro</label>
            <input name="neighborhood" defaultValue={property?.neighborhood} placeholder="Copacabana"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Estado</label>
            <input name="state" defaultValue={property?.state || ''} placeholder="RJ"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Endereço</label>
          <input name="address" defaultValue={property?.address || ''} placeholder="Rua Exemplo, 123"
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Quartos</label>
            <input name="bedrooms" defaultValue={property?.bedrooms} type="number" min="0"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Banheiros</label>
            <input name="bathrooms" defaultValue={property?.bathrooms} type="number" min="0"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Vagas</label>
            <input name="parking_spaces" defaultValue={property?.parking_spaces} type="number" min="0"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Área (m²)</label>
            <input name="area" defaultValue={property?.area || ''} type="number" step="0.01" placeholder="120"
              className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Descrição</label>
          <textarea name="description" defaultValue={property?.description || ''} rows={3} placeholder="Detalhes do imóvel..."
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all resize-none" />
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-4 pt-2 mt-4 border-t border-white/10 pt-6">
          <button type="button" onClick={handleDelete} disabled={deleting || saving}
            className="px-4 py-2.5 rounded-lg text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-colors font-medium border border-red-500/20 text-center">
            {deleting ? 'Excluindo...' : 'Excluir Imóvel'}
          </button>

          <div className="flex gap-3 justify-end">
            <Link href="/properties"
              className="px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 transition-colors font-medium">
              Cancelar
            </Link>
            <button type="submit" disabled={saving || deleting}
              className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium transition-colors">
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
