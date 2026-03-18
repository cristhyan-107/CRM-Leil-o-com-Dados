# PRD - CRM Leilão Ágil

## 1. VISÃO DO PRODUTO

O **CRM Leilão Ágil** é um sistema SaaS voltado para corretores de imóveis e pequenas imobiliárias, com foco em organizar leads por imóvel, aumentar a taxa de visitas e acelerar o fechamento de vendas.

O sistema combina organização comercial com ferramentas práticas de conversão, incluindo pipeline visual (Kanban), automação de follow-up, geração de relatórios profissionais para envio ao cliente e integração direta com WhatsApp.

## 2. OBJETIVOS DE NEGÓCIO

- Reduzir a perda de leads por falta de acompanhamento sistematizado
- Aumentar a taxa de visitas agendadas e realizadas em pelo menos 30%
- Acelerar o ciclo de vendas com follow-up automatizado e relatórios profissionais
- Oferecer uma experiência de uso simples, focada em conversão e não apenas organização
- Posicionar-se como ferramenta essencial do corretor moderno com integração WhatsApp

## 3. PERSONAS

### Carlos — Corretor Autônomo
- 28-45 anos, trabalha de forma independente
- Usa WhatsApp como principal canal de comunicação com clientes
- Gerencia 10-50 leads ativos simultaneamente
- Perde negócios por esquecer de fazer follow-up
- **Necessidade principal:** organizar leads por imóvel e nunca perder timing de contato

### Marina — Gestora de Imobiliária
- 35-55 anos, lidera equipe de 3-10 corretores
- Precisa acompanhar o desempenho da equipe e o status das negociações
- Quer padronizar o processo comercial da equipe
- **Necessidade principal:** visão centralizada dos imóveis, leads e pipeline de vendas

## 4. FUNCIONALIDADES CORE

### 4.1 Autenticação (Supabase Auth)
- Login com email/senha
- Login com OAuth (Google)
- Recuperação de senha por email
- Sessão persistente com refresh automático
- Perfil do usuário com nome e avatar

### 4.2 Cadastro de Imóveis
**Descrição:**
Permite ao corretor cadastrar imóveis com todas as informações relevantes para apresentação ao cliente e vinculação com leads.

**Requisitos:**
- Campos obrigatórios: título, tipo (casa, apartamento, terreno, comercial), finalidade (venda/aluguel), preço, cidade, bairro
- Campos opcionais: endereço completo, quartos, banheiros, vagas, área (m²), descrição detalhada
- Código único auto-gerado por imóvel
- Status do imóvel: Disponível, Reservado, Vendido, Inativo
- Upload de fotos do imóvel (Supabase Storage)

**Fluxo do usuário:**
1. Acessa a página `/properties`
2. Clica em "Novo Imóvel"
3. Preenche o formulário com dados do imóvel
4. Adiciona fotos
5. Salva e o imóvel aparece na listagem

### 4.3 Cadastro de Leads
**Descrição:**
Registro de potenciais compradores/inquilinos com vinculação obrigatória a um imóvel de interesse.

**Requisitos:**
- Campos obrigatórios: nome, telefone, imóvel de interesse
- Campos opcionais: email, origem do lead (site, indicação, portal, WhatsApp, outro), notas
- Temperatura do lead: Quente 🔥, Morno 🌤️, Frio ❄️
- Status: Novo, Em Contato, Visitou, Proposta, Negociando, Fechado, Perdido
- Histórico completo de atividades/interações

**Fluxo do usuário:**
1. Acessa `/leads` ou cria lead a partir de um imóvel
2. Preenche dados do lead
3. Vincula ao imóvel de interesse
4. Lead aparece automaticamente no pipeline

### 4.4 Pipeline de Vendas (Kanban)
**Descrição:**
Visualização Kanban do funil de vendas com drag-and-drop para mover leads entre etapas.

**Requisitos:**
- Colunas: Novo Lead → Em Contato → Visitou → Proposta → Negociando → Fechado
- Coluna separada: Perdido (com motivo obrigatório)
- Drag-and-drop entre colunas
- Cards com: nome do lead, imóvel, temperatura, dias na etapa
- Filtros por imóvel, temperatura e período
- Contador de leads por coluna

**Fluxo do usuário:**
1. Acessa `/pipeline`
2. Visualiza todos os leads organizados por etapa
3. Arrasta lead para avançar na negociação
4. Se marcar como "Perdido", informa o motivo
5. Ao mover para "Fechado", registra a venda

### 4.5 Agenda de Visitas
**Descrição:**
Agendamento e controle de visitas a imóveis com lembretes automáticos.

**Requisitos:**
- Vincular visita a lead + imóvel
- Data, horário e observações
- Status da visita: Agendada, Realizada, Cancelada, Reagendada
- Visualização em lista e calendário (data da visita)
- Lembrete automático (email) 1h antes da visita

**Fluxo do usuário:**
1. Acessa `/visits` ou agenda a partir do lead
2. Seleciona lead e imóvel
3. Define data, horário e observações
4. Recebe lembrete antes da visita
5. Após a visita, marca como Realizada e adiciona observações

### 4.6 Geração de Relatórios para Clientes (Diferencial)
**Descrição:**
Gera relatórios profissionais do imóvel para envio direto ao cliente via WhatsApp, elevando a percepção de profissionalismo.

**Requisitos:**
- Relatório inclui: dados do imóvel, preço, fotos, descrição, observações do corretor
- Layout profissional e responsivo (visualizável no celular)
- Geração de link público compartilhável
- Botão "Enviar no WhatsApp" com mensagem automática personalizada
- Registro de quando o relatório foi gerado e enviado

**Fluxo do usuário:**
1. Acessa um imóvel ou acessa `/reports`
2. Clica em "Gerar Relatório"
3. Sistema monta o relatório automaticamente
4. Corretor pode adicionar observações personalizadas
5. Clica em "Enviar no WhatsApp"
6. Abre WhatsApp com mensagem pré-formatada + link do relatório

### 4.7 Integração WhatsApp
**Descrição:**
Envio rápido de mensagens pré-formatadas via WhatsApp Web/App com um clique.

**Requisitos:**
- Botão "WhatsApp" disponível em: card do lead, detalhes do lead, relatório
- URL format: `https://wa.me/{telefone}?text={mensagem}`
- Templates de mensagem automática baseados no contexto:
  - Primeiro contato com lead
  - Confirmação de visita agendada
  - Envio de relatório do imóvel
  - Follow-up pós-visita
- Personalização com nome do lead e dados do imóvel

### 4.8 Automação de Follow-up
**Descrição:**
Sistema de alertas e automações para garantir que nenhum lead fique sem contato.

**Requisitos:**
- Lead sem contato por 24h → alerta visual no dashboard
- Lead sem interação por 3 dias → temperatura muda automaticamente para "Frio" ❄️
- Após visita realizada → gerar lembrete de follow-up (24h depois)
- Painel de "Leads que precisam de atenção" no dashboard

### 4.9 Dashboard com Métricas
**Descrição:**
Painel com visão geral do desempenho comercial do corretor.

**Requisitos:**
- Cards de métricas: total de leads, visitas agendadas (mês), taxa de conversão, leads quentes
- Gráfico de funil de vendas (Recharts)
- Gráfico de leads por origem
- Gráfico de visitas por mês
- Lista de "Leads que precisam de atenção" (sem contato recente)
- Atividades recentes

## 5. REQUISITOS NÃO-FUNCIONAIS

- **Performance:** Página inicial carrega em < 2s, transições no Kanban instantâneas
- **Segurança:** RLS ativo em todas as tabelas, dados isolados por `user_id`, validação server-side
- **Escalabilidade:** Preparado para até 10.000 usuários com isolamento por `user_id`
- **Responsividade:** Desktop-first, adaptado para tablet. Mobile funcional (consulta)
- **Disponibilidade:** 99.9% uptime (Vercel + Supabase)

## 6. FORA DO ESCOPO V1

❌ Gestão financeira e controle de caixa
❌ Controle e cálculo de comissão
❌ Integração com portais imobiliários (ZAP, OLX, VivaReal)
❌ Automação avançada com IA
❌ Chatbot integrado
❌ App mobile nativo
❌ Multi-tenancy com organizações (será individual na V1)
❌ Importação/exportação em massa de leads

## 7. ONBOARDING

**Fluxo:**
1. Usuário acessa a landing page `/`
2. Clica em "Começar Grátis" → redirecionado para `/sign-up`
3. Cria conta com email/senha ou Google
4. Redirecionado para `/dashboard`
5. Dashboard exibe checklist de primeiros passos

**Checklist de Primeiros Passos:**
- [ ] Cadastre seu primeiro imóvel
- [ ] Adicione seu primeiro lead
- [ ] Agende uma visita
- [ ] Gere seu primeiro relatório
- [ ] Envie um relatório via WhatsApp

## 8. MÉTRICAS DE SUCESSO

- **Leads cadastrados por usuário/mês:** ≥ 10
- **Visitas agendadas por usuário/mês:** ≥ 5
- **Taxa de conversão (Lead → Fechado):** ≥ 8%
- **Tempo médio de resposta ao lead:** < 24h
- **Relatórios gerados e enviados/mês:** ≥ 3 por usuário
- **Retenção mensal (MAU):** ≥ 60%
- **NPS:** ≥ 40
