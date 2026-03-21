import { createServerSupabase } from '@/lib/supabase/server';
import { Plus, Home, MapPin, DollarSign, Edit2 } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: 'Imóveis - Leilão Ágil' };

export default async function PropertiesPage() {
  const supabase = await createServerSupabase();
  const { data: properties } = await supabase
    .from('properties')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Imóveis</h2>
          <p className="text-sm text-gray-400 mt-1">Cadastre e gerencie seus imóveis</p>
        </div>
        <Link 
          href="/properties/new" 
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Imóvel
        </Link>
      </div>

      <div className="bg-[#080d18] border border-white/10 rounded-xl overflow-hidden animate-slide-up">
        {properties && properties.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs text-gray-400 uppercase bg-white/5 border-b border-white/10">
                <tr>
                  <th scope="col" className="px-6 py-4 font-medium">Imóvel</th>
                  <th scope="col" className="px-6 py-4 font-medium">Localização</th>
                  <th scope="col" className="px-6 py-4 font-medium">Preço</th>
                  <th scope="col" className="px-6 py-4 font-medium">Status</th>
                  <th scope="col" className="px-6 py-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {properties.map((property) => (
                  <tr key={property.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
                          <Home className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-200">{property.title}</p>
                          <p className="text-xs text-gray-500">{property.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-gray-500" />
                        {property.city}, {property.state}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 font-medium text-gray-300">
                        <DollarSign className="w-3.5 h-3.5 text-green-500" />
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(property.price)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                        property.status === 'available' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                        property.status === 'sold' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                        'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                      }`}>
                        {property.status === 'available' ? 'Disponível' : 
                         property.status === 'sold' ? 'Vendido' : 'Indisponível'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link 
                        href={`/properties/${property.id}/edit`}
                        className="inline-flex items-center justify-center p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        title="Editar imóvel"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <Home className="w-6 h-6 text-gray-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-200">Nenhum imóvel cadastrado</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">
              Comece cadastrando seu primeiro imóvel para gerenciar seu portfólio.
            </p>
            <Link 
              href="/properties/new" 
              className="mt-6 inline-flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Cadastrar Imóvel
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
