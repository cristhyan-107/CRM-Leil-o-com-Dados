'use client';

import { useState, useEffect } from 'react';
import { Users, Calendar, TrendingUp, Flame } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function MetricsCards() {
  const [metrics, setMetrics] = useState([
    { label: 'Total de Leads', value: '0', change: '—', changeType: 'neutral' as const, icon: Users, accentColor: '#3b82f6' },
    { label: 'Visitas Agendadas', value: '0', change: '—', changeType: 'neutral' as const, icon: Calendar, accentColor: '#22c55e' },
    { label: 'Taxa de Conversão', value: '0%', change: '—', changeType: 'neutral' as const, icon: TrendingUp, accentColor: '#a855f7' },
    { label: 'Leads Quentes', value: '0', change: '—', changeType: 'neutral' as const, icon: Flame, accentColor: '#ef4444' },
  ]);

  useEffect(() => {
    const supabase = createClient();

    async function fetchMetrics() {
      try {
        const [leadsRes, visitsRes, hotRes, closedRes] = await Promise.all([
          supabase.from('leads').select('id', { count: 'exact', head: true }),
          supabase.from('visits').select('id', { count: 'exact', head: true }).eq('status', 'scheduled'),
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('temperature', 'hot'),
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
        ]);

        const totalLeads = leadsRes.count || 0;
        const scheduledVisits = visitsRes.count || 0;
        const hotLeads = hotRes.count || 0;
        const closedLeads = closedRes.count || 0;
        const conversionRate = totalLeads > 0 ? ((closedLeads / totalLeads) * 100).toFixed(1) : '0';

        setMetrics([
          { label: 'Total de Leads', value: String(totalLeads), change: totalLeads > 0 ? `${totalLeads} cadastrados` : 'Nenhum lead ainda', changeType: totalLeads > 0 ? 'positive' : 'neutral', icon: Users, accentColor: '#3b82f6' },
          { label: 'Visitas Agendadas', value: String(scheduledVisits), change: scheduledVisits > 0 ? `${scheduledVisits} pendentes` : 'Nenhuma visita', changeType: scheduledVisits > 0 ? 'positive' : 'neutral', icon: Calendar, accentColor: '#22c55e' },
          { label: 'Taxa de Conversão', value: `${conversionRate}%`, change: totalLeads > 0 ? `${closedLeads} de ${totalLeads} leads` : 'Sem dados', changeType: closedLeads > 0 ? 'positive' : 'neutral', icon: TrendingUp, accentColor: '#a855f7' },
          { label: 'Leads Quentes', value: String(hotLeads), change: hotLeads > 0 ? `${hotLeads} precisam atenção` : 'Nenhum lead quente', changeType: hotLeads > 0 ? 'warning' : 'neutral', icon: Flame, accentColor: '#ef4444' },
        ]);
      } catch {
        // keep zeros on error
      }
    }

    fetchMetrics();
  }, []);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric, i) => (
        <div
          key={i}
          className="metric-card animate-slide-up"
          style={{
            animationDelay: `${i * 80}ms`,
            '--accent-color': metric.accentColor,
          } as React.CSSProperties}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-400">{metric.label}</p>
              <p className="text-3xl font-bold text-white mt-1 tracking-tight">{metric.value}</p>
            </div>
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${metric.accentColor}15` }}
            >
              <metric.icon className="w-5 h-5" style={{ color: metric.accentColor }} />
            </div>
          </div>
          <p className={`text-xs mt-3 font-medium ${
            metric.changeType === 'positive' ? 'text-emerald-400' :
            metric.changeType === 'warning' ? 'text-amber-400' : 'text-gray-500'
          }`}>
            {metric.change}
          </p>
        </div>
      ))}
    </div>
  );
}
