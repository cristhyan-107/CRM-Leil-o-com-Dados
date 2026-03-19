# CRM Leilão Ágil — Plano de Implementação: Módulos Core

O objetivo agora é substituir as páginas temporárias (placeholders) pelos módulos reais da aplicação, conectando-os ao banco de dados Supabase.

## Módulos a serem implementados

### 1. Leads (`/leads`)
- **Tabela Relacionada:** `leads`
- **Funcionalidades:**
  - Tabela listando todos os leads com status, temperatura e origem.
  - Botão "Novo Lead" para adicionar leads através de um modal/Sheet.
  - Filtros simples (ex: por temperatura ou status).
  - Ações na tabela: Editar, Ver Detalhes, Botão WhatsApp.
- **Componentes Novos:** `LeadsTable`, `LeadFormSheet`.

### 2. Imóveis (`/properties`)
- **Tabela Relacionada:** `properties`
- **Funcionalidades:**
  - Grid de cartões ou tabela listando os imóveis cadastrados.
  - Status do imóvel (Disponível, Vendido, etc) e Preço.
  - Botão "Novo Imóvel" (Formulário simples inicial).
- **Componentes Novos:** `PropertiesGrid`, `PropertyFormSheet`.

### 3. Pipeline (`/pipeline`)
- **Tabela Relacionada:** `leads`
- **Funcionalidades:**
  - Quadro Kanban usando `@dnd-kit/core`.
  - Colunas baseadas no enum `lead_status` (Novo, Contatado, Visitou, Proposta, Negociando).
  - Cards arrastáveis para atualizar o status do lead no banco em tempo real.
- **Componentes Novos:** `KanbanBoard`, `KanbanColumn`, `KanbanCard`.

### 4. Visitas (`/visits`)
- **Tabela Relacionada:** `visits`
- **Funcionalidades:**
  - Lista de visitas agendadas.
  - Modal para agendar nova visita vinculada a um lead e a um imóvel.

## Próximos Passos (Execução)
Como o usuário apontou os placeholders como "erros", iniciaremos imediatamente a construção estrutural das páginas de **Leads** e **Imóveis** com tabelas/grids vazios e modais de criação para dar funcionalidade real ao dashboard.
