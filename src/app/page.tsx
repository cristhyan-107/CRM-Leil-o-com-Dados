import Link from 'next/link';
import {
  Building2, Users, BarChart3, Calendar, MessageCircle, FileText,
  ArrowRight, CheckCircle2, Zap, Shield, ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  {
    icon: Users,
    title: 'Leads por Imóvel',
    description: 'Organize seus leads vinculados a cada imóvel. Nunca perca o contexto de uma negociação.',
  },
  {
    icon: Building2,
    title: 'Pipeline Visual',
    description: 'Kanban intuitivo com drag-and-drop. Acompanhe cada negociação do primeiro contato ao fechamento.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp Integrado',
    description: 'Envie mensagens personalizadas com um clique. Templates prontos para cada etapa da venda.',
  },
  {
    icon: FileText,
    title: 'Relatórios Profissionais',
    description: 'Gere relatórios do imóvel e envie direto ao cliente. Impressione com profissionalismo.',
  },
  {
    icon: Calendar,
    title: 'Agenda de Visitas',
    description: 'Agende visitas e receba lembretes automáticos. Nunca mais esqueça um compromisso.',
  },
  {
    icon: BarChart3,
    title: 'Dashboard Inteligente',
    description: 'Métricas de conversão, funil de vendas e desempenho. Dados para decisões mais inteligentes.',
  },
];

const benefits = [
  {
    icon: Zap,
    title: 'Agilidade',
    description: 'Do lead ao fechamento em menos tempo',
    color: 'from-amber-500 to-orange-500',
    shadowColor: 'shadow-amber-500/20',
  },
  {
    icon: Shield,
    title: 'Controle',
    description: 'Nenhum lead esquecido, nenhuma oportunidade perdida',
    color: 'from-blue-500 to-cyan-500',
    shadowColor: 'shadow-blue-500/20',
  },
  {
    icon: BarChart3,
    title: 'Resultados',
    description: 'Mais visitas, mais propostas, mais fechamentos',
    color: 'from-emerald-500 to-green-500',
    shadowColor: 'shadow-emerald-500/20',
  },
];

export default function LandingPage() {
  return (
    <div className="dark min-h-screen bg-[#060a14] text-white overflow-hidden">
      {/* ==================== NAV ==================== */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#060a14]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Leilão Ágil</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="text-gray-400 hover:text-white cursor-pointer">
                Entrar
              </Button>
            </Link>
            <Link href="/sign-up">
              <Button className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 cursor-pointer">
                Começar Grátis
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ==================== HERO ==================== */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 landing-gradient-hero">
        <div className="landing-grid absolute inset-0" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          {/* Badge */}
          <div className="animate-slide-up inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/20 bg-blue-500/5 text-blue-400 text-sm font-medium mb-8">
            <Zap className="w-3.5 h-3.5" />
            CRM feito para corretores de imóveis
          </div>

          {/* Heading */}
          <h1 className="animate-slide-up delay-100 text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight">
            Organize seus leads.
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-cyan-400 bg-clip-text text-transparent">
              Feche mais negócios.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="animate-slide-up delay-200 mt-6 text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Pipeline visual, WhatsApp integrado e relatórios profissionais.
            Tudo que você precisa para nunca mais perder um lead.
          </p>

          {/* CTAs */}
          <div className="animate-slide-up delay-300 mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/sign-up">
              <Button
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-8 h-12 text-base font-semibold shadow-xl shadow-blue-600/25 cursor-pointer"
              >
                Começar Grátis
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Button
              variant="outline"
              size="lg"
              className="border-white/10 text-gray-300 hover:bg-white/5 px-8 h-12 text-base cursor-pointer"
            >
              Ver Demonstração
            </Button>
          </div>

          {/* Social proof */}
          <div className="animate-slide-up delay-400 mt-12 flex items-center justify-center gap-6 text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Grátis para começar
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Sem cartão de crédito
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Setup em 2 minutos
            </div>
          </div>
        </div>

        {/* Dashboard Preview */}
        <div className="animate-scale-in delay-500 relative z-10 max-w-5xl mx-auto px-4 sm:px-6 mt-16">
          <div className="rounded-2xl border border-white/10 bg-[#0d1220]/80 backdrop-blur-sm p-1 shadow-2xl shadow-blue-500/5 glow-blue">
            <div className="rounded-xl bg-[#0d1220] overflow-hidden">
              {/* Fake browser bar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-3 h-3 rounded-full bg-green-500/60" />
                </div>
                <div className="flex-1 ml-4">
                  <div className="max-w-sm mx-auto h-6 rounded-md bg-white/5 flex items-center justify-center text-xs text-gray-600">
                    app.leilaoagil.com.br/dashboard
                  </div>
                </div>
              </div>
              {/* Fake dashboard content */}
              <div className="p-6 space-y-4">
                {/* Fake metrics row */}
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Total Leads', value: '147', change: '+12%' },
                    { label: 'Visitas Mês', value: '23', change: '+8%' },
                    { label: 'Conversão', value: '12.3%', change: '+2.1%' },
                    { label: 'Leads Quentes', value: '31', change: '+5' },
                  ].map((m, i) => (
                    <div key={i} className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                      <p className="text-xs text-gray-500">{m.label}</p>
                      <p className="text-xl font-bold mt-1">{m.value}</p>
                      <p className="text-xs text-emerald-400 mt-1">{m.change}</p>
                    </div>
                  ))}
                </div>
                {/* Fake chart area */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="h-40 rounded-xl bg-white/[0.02] border border-white/5 flex items-end p-4 gap-2">
                    {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-md bg-gradient-to-t from-blue-600/60 to-blue-400/30"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                  <div className="h-40 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
                    <div className="w-24 h-24 rounded-full border-8 border-blue-500/30 border-t-blue-500 animate-spin" style={{ animationDuration: '8s' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== BENEFITS ==================== */}
      <section className="py-20 sm:py-28 relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Por que corretores escolhem o{' '}
              <span className="text-blue-400">Leilão Ágil</span>?
            </h2>
            <p className="mt-4 text-gray-400 text-lg max-w-xl mx-auto">
              Pare de perder leads por falta de organização. Comece a fechar negócios com mais agilidade.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {benefits.map((b, i) => (
              <div key={i} className="glass-card p-8 text-center">
                <div className={`inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br ${b.color} items-center justify-center mb-5 shadow-lg ${b.shadowColor}`}>
                  <b.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold mb-2">{b.title}</h3>
                <p className="text-gray-400 leading-relaxed">{b.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== FEATURES ==================== */}
      <section className="py-20 sm:py-28 relative border-t border-white/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Tudo que você precisa,{' '}
              <span className="text-blue-400">nada que não precisa.</span>
            </h2>
            <p className="mt-4 text-gray-400 text-lg max-w-xl mx-auto">
              Funcionalidades pensadas para o dia a dia do corretor. Sem complicação.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <div key={i} className="glass-card p-6 group">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center mb-4 group-hover:bg-blue-500/20 transition-colors">
                  <f.icon className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== CTA FINAL ==================== */}
      <section className="py-20 sm:py-28 relative">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="glass-card p-12 sm:p-16 relative overflow-hidden">
            {/* Background glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-indigo-500/5" />

            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Pronto para fechar mais negócios?
              </h2>
              <p className="mt-4 text-gray-400 text-lg max-w-lg mx-auto">
                Crie sua conta em menos de 2 minutos e comece a organizar seus leads hoje.
              </p>
              <div className="mt-8">
                <Link href="/sign-up">
                  <Button
                    size="lg"
                    className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-10 h-13 text-base font-semibold shadow-xl shadow-blue-600/25 cursor-pointer"
                  >
                    Criar Conta Grátis
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Building2 className="w-4 h-4" />
            <span>© 2026 Leilão Ágil. Todos os direitos reservados.</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <a href="#" className="hover:text-gray-300 transition-colors">Termos</a>
            <a href="#" className="hover:text-gray-300 transition-colors">Privacidade</a>
            <a href="#" className="hover:text-gray-300 transition-colors">Suporte</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
