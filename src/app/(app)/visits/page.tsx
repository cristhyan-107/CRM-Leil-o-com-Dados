import { createServerSupabase } from '@/lib/supabase/server';
import { Plus, Calendar, Clock, MapPin } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: 'Visitas - Leilão Ágil' };

export default async function VisitsPage() {
  const supabase = await createServerSupabase();
  const { data: visits } = await supabase
    .from('visits')
    .select('*, leads(name, phone), properties(title, address)')
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Visitas</h2>
          <p className="text-sm text-gray-400 mt-1">Agende e controle visitas aos imóveis</p>
        </div>
        <Link 
          href="/visits/new" 
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Agendar Visita
        </Link>
      </div>

      <div className="bg-[#080d18] border border-white/10 rounded-xl overflow-hidden animate-slide-up">
        {visits && visits.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs text-gray-400 uppercase bg-white/5 border-b border-white/10">
                <tr>
                  <th scope="col" className="px-6 py-4 font-medium">Data e Hora</th>
                  <th scope="col" className="px-6 py-4 font-medium">Imóvel</th>
                  <th scope="col" className="px-6 py-4 font-medium">Cliente</th>
                  <th scope="col" className="px-6 py-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visits.map((visit) => (
                  <tr key={visit.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 font-medium text-gray-200">
                          <Calendar className="w-3.5 h-3.5 text-blue-500" />
                          {new Date(visit.scheduled_date).toLocaleDateString('pt-BR')}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <Clock className="w-3.5 h-3.5" />
                          {visit.scheduled_time.slice(0, 5)}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-gray-200">{visit.properties?.title}</span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {visit.properties?.address || 'Sem endereço'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-gray-200">{visit.leads?.name}</span>
                        <span className="text-xs text-gray-500">{visit.leads?.phone}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                        visit.status === 'scheduled' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                        visit.status === 'completed' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                        visit.status === 'cancelled' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                      }`}>
                        {visit.status === 'scheduled' ? 'Agendada' : 
                         visit.status === 'completed' ? 'Realizada' : 
                         visit.status === 'cancelled' ? 'Cancelada' : 'Reagendada'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <Calendar className="w-6 h-6 text-gray-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-200">Nenhuma visita agendada</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">
              Você não possui visitas programadas no momento. Agende agora!
            </p>
            <Link 
              href="/visits/new" 
              className="mt-6 inline-flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Agendar Visita
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
