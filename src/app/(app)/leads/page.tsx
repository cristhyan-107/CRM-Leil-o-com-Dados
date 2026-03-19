import { createServerSupabase } from '@/lib/supabase/server';
import { Plus, Users, MessageSquare, Phone } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const metadata = { title: 'Leads - Leilão Ágil' };

export default async function LeadsPage() {
  const supabase = await createServerSupabase();
  const { data: leads } = await supabase
    .from('leads')
    .select('*, properties(title)')
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Leads</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie seus leads e potenciais compradores</p>
        </div>
        <Link 
          href="/leads/new" 
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Lead
        </Link>
      </div>

      <div className="bg-[#080d18] border border-white/10 rounded-xl overflow-hidden animate-slide-up">
        {leads && leads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs text-gray-400 uppercase bg-white/5 border-b border-white/10">
                <tr>
                  <th scope="col" className="px-6 py-4 font-medium">Nome</th>
                  <th scope="col" className="px-6 py-4 font-medium">Contato</th>
                  <th scope="col" className="px-6 py-4 font-medium">Imóvel de Interesse</th>
                  <th scope="col" className="px-6 py-4 font-medium">Status / Temp.</th>
                  <th scope="col" className="px-6 py-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-200">
                      {lead.name}
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      <div className="flex flex-col space-y-1">
                        <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-gray-500" /> {lead.phone}</span>
                        {lead.email && <span className="text-xs">{lead.email}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      {lead.properties?.title || 'Sem imóvel'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-xs bg-white/5 text-gray-300 px-2 py-0.5 rounded-md border border-white/10">
                          {lead.status.charAt(0).toUpperCase() + lead.status.slice(1)}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className={`w-2 h-2 rounded-full ${
                            lead.temperature === 'hot' ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]' :
                            lead.temperature === 'warm' ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]' :
                            'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                          }`} />
                          <span className={`${
                            lead.temperature === 'hot' ? 'text-orange-400' :
                            lead.temperature === 'warm' ? 'text-yellow-400' :
                            'text-blue-400'
                          }`}>
                            {lead.temperature === 'hot' ? 'Quente' : lead.temperature === 'warm' ? 'Morno' : 'Frio'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <a 
                        href={`https://wa.me/55${lead.phone.replace(/[\D]/g, '')}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center justify-center p-2 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg transition-colors border border-green-500/20"
                        title="Chamar no WhatsApp"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-gray-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-200">Nenhum lead encontrado</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">
              Comece cadastrando um novo lead ou capturando-os através de um formulário.
            </p>
            <Link 
              href="/leads/new" 
              className="mt-6 inline-flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Adicionar Lead
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
