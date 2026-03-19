import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { Building2, Calendar, MapPin, CheckCircle2 } from 'lucide-react';
import { notFound } from 'next/navigation';
import { ShareButton } from '@/components/reports/share-button';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return {
    title: `Relatório de Imóvel - CRM Leilão Ágil`,
  };
}

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cookieStore = await cookies();
  
  // Create a server client that doesn't strictly need auth for public resources
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );

  const { data: report } = await supabase
    .from('reports')
    .select('created_at, custom_notes, properties(*)')
    .eq('public_token', token)
    .single();

  if (!report || !report.properties) {
    notFound();
  }

  const property = report.properties as any;

  return (
    <div className="min-h-screen bg-[#030816] flex flex-col items-center py-12 px-4 selection:bg-blue-500/30 selection:text-white">
      <div className="w-full max-w-3xl space-y-8 animate-fade-in">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(59,130,246,0.2)]">
            <Building2 className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Relatório de Desempenho</h1>
          <p className="text-gray-400">Gerado em {new Date(report.created_at).toLocaleDateString('pt-BR')}</p>
          <div className="pt-4 flex justify-center">
            <ShareButton token={token} variant="full" />
          </div>
        </div>

        {/* Property Card */}
        <div className="bg-[#080d18] border border-white/10 rounded-2xl p-6 sm:p-8 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-medium text-gray-300">
                  {property.code}
                </span>
                {property.status === 'sold' && (
                  <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Vendido
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-bold text-white">{property.title}</h2>
              {property.address && (
                <div className="flex items-center gap-1.5 text-gray-400 mt-2">
                  <MapPin className="w-4 h-4" />
                  <span className="text-sm">{property.address} - {property.neighborhood}, {property.city}</span>
                </div>
              )}
            </div>
            <div className="text-left sm:text-right">
              <p className="text-sm text-gray-400">Valor do Imóvel</p>
              <p className="text-2xl font-bold text-emerald-400">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(property.price)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-6 border-y border-white/5">
            <div>
              <p className="text-xs text-gray-500 mb-1">Tipo</p>
              <p className="text-sm font-medium text-gray-200 capitalize">{property.type}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Quartos</p>
              <p className="text-sm font-medium text-gray-200">{property.bedrooms}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Banheiros</p>
              <p className="text-sm font-medium text-gray-200">{property.bathrooms}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Área</p>
              <p className="text-sm font-medium text-gray-200">{property.area} m²</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Notas e Desempenho</h3>
            <div className="p-4 rounded-xl bg-white/5 border border-white/5">
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-300 leading-relaxed">
                {report.custom_notes || 'Nenhuma nota adicional adicionada a este relatório.'}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-8">
          <p className="text-xs text-gray-600">Gerado pelo sistema CRM Leilão Ágil</p>
        </div>
      </div>
    </div>
  );
}
