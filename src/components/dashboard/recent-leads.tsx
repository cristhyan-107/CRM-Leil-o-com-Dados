'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Building2, Flame, CloudSun, Snowflake, MessageCircle, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

const temperatureConfig = {
  hot: { icon: Flame, label: 'Quente', color: 'text-red-400', bg: 'bg-red-500/10' },
  warm: { icon: CloudSun, label: 'Morno', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  cold: { icon: Snowflake, label: 'Frio', color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

type Lead = {
  id: string;
  name: string;
  phone: string;
  temperature: 'hot' | 'warm' | 'cold';
  source: string;
  status: string;
  created_at: string;
  properties: { title: string } | null;
};

export function RecentLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('leads')
      .select('id, name, phone, temperature, source, status, created_at, properties(title)')
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (data) setLeads(data as Lead[]);
      });
  }, []);

  return (
    <div className="metric-card animate-slide-up delay-600">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Leads Recentes</h3>
        <Link href="/leads" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
          Ver todos →
        </Link>
      </div>

      {leads.length > 0 ? (
        <div className="space-y-3">
          {leads.map((lead) => {
            const temp = temperatureConfig[lead.temperature];
            const TempIcon = temp.icon;
            const whatsappUrl = `https://wa.me/55${lead.phone.replace(/\D/g, '')}`;

            return (
              <div
                key={lead.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all group"
              >
                <div className={`w-8 h-8 rounded-lg ${temp.bg} flex items-center justify-center flex-shrink-0`}>
                  <TempIcon className={`w-4 h-4 ${temp.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{lead.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Building2 className="w-3 h-3 text-gray-500" />
                    <p className="text-xs text-gray-500 truncate">{lead.properties?.title || 'Sem imóvel'}</p>
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-white/5 text-gray-400 border-white/5 text-[10px] flex-shrink-0"
                >
                  {lead.status}
                </Badge>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                >
                  <MessageCircle className="w-4 h-4 text-green-400" />
                </a>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-40 text-center">
          <Users className="w-8 h-8 text-gray-700 mb-2" />
          <p className="text-sm text-gray-600">Nenhum lead cadastrado</p>
        </div>
      )}
    </div>
  );
}
