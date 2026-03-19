'use client';

import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { createClient } from '@/lib/supabase/client';

const sources = [
  { id: 'whatsapp', name: 'WhatsApp', fill: '#22c55e' },
  { id: 'referral', name: 'Indicação', fill: '#3b82f6' },
  { id: 'portal', name: 'Portal', fill: '#f59e0b' },
  { id: 'social_media', name: 'Redes Sociais', fill: '#a855f7' },
  { id: 'website', name: 'Site', fill: '#06b6d4' },
  { id: 'other', name: 'Outro', fill: '#6b7280' },
];

export function LeadsSourceChart() {
  const [data, setData] = useState(sources.map(s => ({ name: s.name, value: 0, fill: s.fill })));
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function fetch() {
      try {
        const { data: leads } = await supabase.from('leads').select('source');
        if (leads && leads.length > 0) {
          setHasData(true);
          setData(sources.map(s => ({
            name: s.name,
            value: leads.filter((l: { source: string }) => l.source === s.id).length,
            fill: s.fill,
          })));
        }
      } catch { /* keep zeros */ }
    }
    fetch();
  }, []);

  return (
    <div className="metric-card animate-slide-up delay-500">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Leads por Origem</h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={90}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#0d1220',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12,
                color: '#e8ecf4',
                fontSize: 13,
              }}
            />
            <Legend
              verticalAlign="bottom"
              wrapperStyle={{ fontSize: 12, color: '#6b7fa3' }}
            />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-[260px] text-sm text-gray-600">
          Nenhum lead cadastrado ainda
        </div>
      )}
    </div>
  );
}
