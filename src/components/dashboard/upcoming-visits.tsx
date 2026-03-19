'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

const statusConfig: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Agendada', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  completed: { label: 'Realizada', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  cancelled: { label: 'Cancelada', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  rescheduled: { label: 'Reagendada', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
};

type Visit = {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  leads: { name: string } | null;
  properties: { title: string; address: string | null } | null;
};

export function UpcomingVisits() {
  const [visits, setVisits] = useState<Visit[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('visits')
      .select('id, scheduled_date, scheduled_time, status, leads(name), properties(title, address)')
      .eq('status', 'scheduled')
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true })
      .limit(5)
      .then(({ data }) => {
        if (data) setVisits(data as Visit[]);
      });
  }, []);

  return (
    <div className="metric-card animate-slide-up delay-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Próximas Visitas</h3>
        <Link href="/visits" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
          Ver agenda →
        </Link>
      </div>

      {visits.length > 0 ? (
        <div className="space-y-3">
          {visits.map((visit) => {
            const status = statusConfig[visit.status] || statusConfig.scheduled;

            return (
              <div
                key={visit.id}
                className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-sm font-medium text-gray-200">{visit.leads?.name || 'Lead'}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${status.color}`}
                  >
                    {status.label}
                  </Badge>
                </div>

                <div className="space-y-1.5 ml-5.5">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <MapPin className="w-3 h-3" />
                    <span>{visit.properties?.title || 'Imóvel'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>{new Date(visit.scheduled_date).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{visit.scheduled_time.slice(0, 5)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-40 text-center">
          <Calendar className="w-8 h-8 text-gray-700 mb-2" />
          <p className="text-sm text-gray-600">Nenhuma visita agendada</p>
        </div>
      )}
    </div>
  );
}
