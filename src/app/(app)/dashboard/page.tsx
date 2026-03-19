import { MetricsCards } from '@/components/dashboard/metrics-cards';
import { SalesFunnelChart } from '@/components/dashboard/sales-funnel-chart';
import { LeadsSourceChart } from '@/components/dashboard/leads-source-chart';
import { RecentLeads } from '@/components/dashboard/recent-leads';
import { UpcomingVisits } from '@/components/dashboard/upcoming-visits';

export const metadata = {
  title: 'Dashboard - Leilão Ágil',
};

export default function DashboardPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="animate-fade-in">
        <h2 className="text-2xl font-bold text-white tracking-tight">Dashboard</h2>
        <p className="text-sm text-gray-400 mt-1">
          Visão geral do seu desempenho comercial
        </p>
      </div>

      {/* Metrics */}
      <MetricsCards />

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4">
        <SalesFunnelChart />
        <LeadsSourceChart />
      </div>

      {/* Lists row */}
      <div className="grid lg:grid-cols-2 gap-4">
        <RecentLeads />
        <UpcomingVisits />
      </div>
    </div>
  );
}
