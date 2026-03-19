'use client';

import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { createClient } from '@/lib/supabase/client';

const columns = [
  { id: 'new', name: 'Novo Lead', fill: '#6366f1' },
  { id: 'contacted', name: 'Em Contato', fill: '#8b5cf6' },
  { id: 'visited', name: 'Visitou', fill: '#f59e0b' },
  { id: 'proposal', name: 'Proposta', fill: '#3b82f6' },
  { id: 'negotiating', name: 'Negociando', fill: '#f97316' },
  { id: 'closed', name: 'Fechado', fill: '#22c55e' },
];

export function SalesFunnelChart() {
  const [data, setData] = useState(columns.map(c => ({ name: c.name, value: 0, fill: c.fill })));

  useEffect(() => {
    const supabase = createClient();
    async function fetch() {
      try {
        const { data: leads } = await supabase.from('leads').select('status');
        if (leads) {
          setData(columns.map(c => ({
            name: c.name,
            value: leads.filter((l: { status: string }) => l.status === c.id).length,
            fill: c.fill,
          })));
        }
      } catch { /* keep zeros */ }
    }
    fetch();
  }, []);

  return (
    <div className="metric-card animate-slide-up delay-400">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Funil de Vendas</h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#6b7fa3', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis
            dataKey="name"
            type="category"
            tick={{ fill: '#c8d4e8', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0d1220',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              color: '#e8ecf4',
              fontSize: 13,
            }}
            cursor={{ fill: 'rgba(255,255,255,0.02)' }}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={20}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
