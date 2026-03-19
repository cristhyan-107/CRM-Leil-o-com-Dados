'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, BarChart3, Users, Calendar, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

type Property = { id: string; title: string; code: string; status: string };

export default function NewReportPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [properties, setProperties] = useState<Property[]>([]);
  
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [stats, setStats] = useState({ leads: 0, visits: 0 });
  const [generatedSale, setGeneratedSale] = useState(false);
  const [fetchingStats, setFetchingStats] = useState(false);

  useEffect(() => {
    supabase.from('properties')
      .select('id, title, code, status')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setProperties(data);
      });
  }, []);

  useEffect(() => {
    if (!selectedPropertyId) {
      setStats({ leads: 0, visits: 0 });
      setGeneratedSale(false);
      return;
    }

    const fetchStats = async () => {
      setFetchingStats(true);
      try {
        const prop = properties.find(p => p.id === selectedPropertyId);
        if (prop && prop.status === 'sold') {
          setGeneratedSale(true);
        } else {
          setGeneratedSale(false);
        }

        const [leadsRes, visitsRes] = await Promise.all([
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('property_id', selectedPropertyId),
          supabase.from('visits').select('id', { count: 'exact', head: true }).eq('property_id', selectedPropertyId)
        ]);
        
        setStats({
          leads: leadsRes.count || 0,
          visits: visitsRes.count || 0
        });
      } catch (err) {
        console.error('Error fetching stats:', err);
      } finally {
        setFetchingStats(false);
      }
    };

    fetchStats();
  }, [selectedPropertyId, properties]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedPropertyId) {
      setError('Selecione um imóvel para gerar o relatório.');
      return;
    }

    setLoading(true);
    setError('');

    const form = new FormData(e.currentTarget);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Você precisa estar logado.'); setLoading(false); return; }

    const customNotes = form.get('custom_notes') as string;
    
    // Format the final report notes containing the stats and sale status
    const reportContent = `
=== RESUMO DO IMÓVEL ===
Leads captados: ${stats.leads}
Visitas agendadas: ${stats.visits}
Gerou venda? ${generatedSale ? 'SIM' : 'NÃO'}

=== INFORMAÇÕES EXTRAS ===
${customNotes || 'Nenhuma informação extra fornecida.'}
`.trim();

    // If marked as sold, update the property status to sold
    if (generatedSale) {
      const prop = properties.find(p => p.id === selectedPropertyId);
      if (prop && prop.status !== 'sold') {
        await supabase.from('properties').update({ status: 'sold' }).eq('id', selectedPropertyId);
      }
    }

    const { error: insertError } = await supabase.from('reports').insert({
      user_id: user.id,
      property_id: selectedPropertyId,
      custom_notes: reportContent,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
    } else {
      router.push('/reports');
      router.refresh();
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="p-2 rounded-lg hover:bg-white/5 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Gerar Relatório</h2>
          <p className="text-sm text-gray-400 mt-0.5">Relatório de desempenho e atividades do imóvel</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[#080d18] border border-white/10 rounded-xl p-6 space-y-6">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Selecione o Imóvel *</label>
          <select 
            required
            value={selectedPropertyId}
            onChange={(e) => setSelectedPropertyId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
          >
            <option value="" className="bg-[#0a0f1c]">Selecione um imóvel...</option>
            {properties.map(p => (
              <option key={p.id} value={p.id} className="bg-[#0a0f1c]">
                {p.code} — {p.title} {p.status === 'sold' ? '(Vendido)' : ''}
              </option>
            ))}
          </select>
        </div>

        {selectedPropertyId && (
          <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 space-y-4">
            <h3 className="text-sm font-medium text-blue-400 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Resumo do Imóvel
            </h3>
            
            {fetchingStats ? (
              <div className="text-sm text-gray-500 animate-pulse">Calculando estatísticas...</div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3 bg-[#0a0f1c] p-3 rounded-lg border border-white/5">
                  <div className="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Leads captados</p>
                    <p className="text-lg font-semibold text-white">{stats.leads}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 bg-[#0a0f1c] p-3 rounded-lg border border-white/5">
                  <div className="w-8 h-8 rounded-md bg-emerald-500/10 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Visitas agendadas</p>
                    <p className="text-lg font-semibold text-white">{stats.visits}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className={`w-4 h-4 ${generatedSale ? 'text-emerald-400' : 'text-gray-500'}`} />
                <span className="text-sm text-gray-300">Este imóvel gerou venda?</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={generatedSale}
                  onChange={(e) => setGeneratedSale(e.target.checked)}
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
            {generatedSale && (
              <p className="text-xs text-emerald-400/80 mt-2">
                O status do imóvel será automaticamente atualizado para "Vendido".
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-300">Informações Extras</label>
          <textarea 
            name="custom_notes" 
            rows={4} 
            placeholder="Adicione informações adicionais que deseja incluir no relatório..."
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all resize-none" 
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Link href="/reports"
            className="px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 transition-colors font-medium">
            Cancelar
          </Link>
          <button type="submit" disabled={loading}
            className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium transition-colors">
            {loading ? 'Gerando...' : 'Gerar Relatório'}
          </button>
        </div>
      </form>
    </div>
  );
}
