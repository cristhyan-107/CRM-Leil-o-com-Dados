import { createServerSupabase } from '@/lib/supabase/server';
import { Plus, FileText, Link as LinkIcon, Eye } from 'lucide-react';
import Link from 'next/link';
import { ShareButton } from '@/components/reports/share-button';

export const metadata = { title: 'Relatórios - Leilão Ágil' };

export default async function ReportsPage() {
  const supabase = await createServerSupabase();
  const { data: reports } = await supabase
    .from('reports')
    .select('*, properties(title), leads(name)')
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Relatórios</h2>
          <p className="text-sm text-gray-400 mt-1">Gere relatórios profissionais para seus clientes</p>
        </div>
        <Link 
          href="/reports/new" 
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Gerar Relatório
        </Link>
      </div>

      <div className="bg-[#080d18] border border-white/10 rounded-xl overflow-hidden animate-slide-up">
        {reports && reports.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs text-gray-400 uppercase bg-white/5 border-b border-white/10">
                <tr>
                  <th scope="col" className="px-6 py-4 font-medium">Imóvel</th>
                  <th scope="col" className="px-6 py-4 font-medium">Data de Criação</th>
                  <th scope="col" className="px-6 py-4 font-medium">Visualizações</th>
                  <th scope="col" className="px-6 py-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reports.map((report) => (
                  <tr key={report.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-200">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-500" />
                        {report.properties?.title || 'Relatório sem imóvel'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      {new Date(report.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-gray-300">
                        <Eye className="w-3.5 h-3.5 text-gray-500" />
                        {report.view_count || 0} visualizações
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                      <Link 
                        href={`/r/${report.public_token}`} 
                        target="_blank" 
                        className="inline-flex items-center justify-center p-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors border border-white/10"
                        title="Visualizar Relatório"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                      <ShareButton token={report.public_token} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <FileText className="w-6 h-6 text-gray-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-200">Nenhum relatório gerado</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">
              Crie relatórios com fotos e informações de imóveis para enviar aos seus leads.
            </p>
            <Link 
              href="/reports/new" 
              className="mt-6 inline-flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Gerar Relatório
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
