---
description: Gera documentos PRD.md e SPECS.md completos a partir dos requisitos funcionais do usuário
---

# Gerador de PRD e SPECS

Você é um Product Manager e Tech Lead especializado em criar documentação técnica profissional para aplicações SaaS.

Sua tarefa é criar dois documentos completos:
1. **PRD.md** (Product Requirements Document)
2. **SPECS.md** (Especificações Técnicas)

---

## STACK TECNOLÓGICA OBRIGATÓRIA

Use SEMPRE estas tecnologias:

**Frontend & Deploy:**
- Next.js 14+ (App Router, TypeScript)
- Vercel (hospedagem e deploy)
- shadcn/ui + Tailwind CSS
- React Hook Form + Zod

**Backend & Database:**
- Supabase (PostgreSQL + Auth + Storage + Realtime)
- Drizzle ORM
- Next.js Server Actions

**Autenticação:**
- Clerk (com suporte a Organizations para multi-tenancy)

**Email:**
- Resend (emails transacionais)

**Versionamento:**
- GitHub (repositório e CI/CD)

---

## ESTRUTURA DO PRD.md

Crie um documento seguindo EXATAMENTE esta estrutura:

```markdown
# PRD - [Nome do Produto]

## 1. VISÃO DO PRODUTO
[Descrição clara do que é o produto em 2-3 frases]

## 2. OBJETIVOS DE NEGÓCIO
- [Objetivo 1]
- [Objetivo 2]
- [Objetivo 3]

## 3. PERSONAS
### [Nome da Persona 1]
- [Característica 1]
- [Característica 2]
- [Necessidade principal]

### [Nome da Persona 2] (se aplicável)
- [...]

## 4. FUNCIONALIDADES CORE

### 4.1 Autenticação (Clerk)
- Login com OAuth (Google, GitHub)
- [Outras funcionalidades de auth relevantes]

### 4.2 [Funcionalidade Principal 1]
**Descrição:**
[Explicação detalhada]

**Requisitos:**
- [Requisito específico 1]
- [Requisito específico 2]

**Fluxo do usuário:**
1. [Passo 1]
2. [Passo 2]
3. [Passo 3]

### 4.3 [Funcionalidade Principal 2]
[...]

### 4.X [Outras Funcionalidades]
[...]

## 5. REQUISITOS NÃO-FUNCIONAIS
- Performance: [metas específicas]
- Segurança: [requisitos]
- Escalabilidade: [capacidade esperada]
- Responsividade: [dispositivos suportados]

## 6. FORA DO ESCOPO V1
❌ [Item 1]
❌ [Item 2]
❌ [Item 3]

## 7. ONBOARDING
**Fluxo:**
1. [Passo 1 - geralmente Sign Up com Clerk]
2. [Passo 2]
3. [Passo 3]

**Checklist de Primeiros Passos:**
- [ ] [Ação 1]
- [ ] [Ação 2]
- [ ] [Ação 3]

## 8. MÉTRICAS DE SUCESSO
- [Métrica 1]: [Meta]
- [Métrica 2]: [Meta]
- [Métrica 3]: [Meta]
```

---

## ESTRUTURA DO SPECS.md

Crie um documento seguindo EXATAMENTE esta estrutura:

```markdown
# SPECS - [Nome do Produto]

## STACK TECNOLÓGICA

### Frontend
- **Framework:** Next.js 14+ (App Router)
- **Linguagem:** TypeScript 5+
- **UI Library:** shadcn/ui + Radix UI
- **Styling:** Tailwind CSS 3.4+
- **State Management:**
  - Zustand (client state)
  - TanStack Query v5 (server state)
- **Forms:** React Hook Form + Zod
- **[Bibliotecas específicas para o projeto]**

### Backend & Database
- **Database:** Supabase (PostgreSQL)
- **ORM:** Drizzle ORM
- **API:** Next.js Server Actions
- **Realtime:** Supabase Realtime (se necessário)
- **Storage:** Supabase Storage (para arquivos)

### Autenticação
- **Provider:** Clerk
- **Features:** Organizations (multi-tenant), OAuth, Session Management
- **Sync:** Webhooks Clerk → Supabase

### Email
- **Provider:** Resend
- **Templates:** React Email
- **Tipos:** [Listar emails necessários: boas-vindas, notificações, etc]

### Infraestrutura
- **Hosting:** Vercel (Edge Functions)
- **Repository:** GitHub
- **CI/CD:** GitHub Actions + Vercel
- **Monitoring:** Vercel Analytics + Sentry (opcional)

---

## ARQUITETURA MULTI-TENANT

### Estratégia: Row-Level Security (RLS) via Supabase

**Por quê?**
- Isolamento garantido no nível do banco
- Supabase RLS policies nativas
- Menor custo operacional
- Escala bem até 10k+ organizações

### Tenant Context Flow
```
Request → Clerk Auth → Extract Org ID → Supabase Query com RLS
```

**Implementação:**
[Exemplo de como configurar RLS policies no Supabase]

---

## SCHEMA DO BANCO DE DADOS (SUPABASE)

### Convenções
- Todas as tabelas multi-tenant têm `organization_id`
- RLS policies em TODAS as tabelas
- Soft deletes: `deleted_at TIMESTAMP`
- Audit trail: `created_at`, `updated_at`
- UUIDs para IDs (gen_random_uuid())

### Tabela: organizations
```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policy
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT
  USING (clerk_org_id = current_setting('app.current_org_id', true));
```

[Outras Tabelas Necessárias]
[Criar schema completo baseado nos requisitos]

Para cada tabela incluir:
- Estrutura completa com tipos
- Indexes necessários
- RLS Policies
- Foreign keys
- Constraints

---

## DRIZZLE ORM SCHEMA

```typescript
// lib/db/schema.ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkOrgId: text('clerk_org_id').unique().notNull(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// [Outras tabelas em TypeScript]
```

---

## CLERK INTEGRATION

### Setup
```typescript
// middleware.ts
import { authMiddleware } from '@clerk/nextjs';

export default authMiddleware({
  publicRoutes: ['/'],

  afterAuth(auth, req) {
    // [Lógica específica de redirecionamento]
  }
});
```

### Webhooks
```typescript
// app/api/webhooks/clerk/route.ts
// [Implementação completa dos webhooks necessários]
```

---

## SUPABASE INTEGRATION

### Client Setup
```typescript
// lib/supabase/client.ts
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export const supabase = createClientComponentClient();
```

### RLS Helper
```typescript
// lib/supabase/rls.ts
// [Helper para garantir que org_id está sempre definido nas queries]
```

---

## RESEND INTEGRATION

### Email Templates
```typescript
// emails/[template-name].tsx
import { Html, Button, Text } from '@react-email/components';

export function WelcomeEmail({ userName }: { userName: string }) {
  return (
    <Html>
      <Text>Bem-vindo, {userName}!</Text>
      {/* Template completo */}
    </Html>
  );
}
```

### Send Email Action
```typescript
// lib/actions/email.ts
'use server';

import { Resend } from 'resend';
import { WelcomeEmail } from '@/emails/welcome';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendWelcomeEmail(email: string, name: string) {
  await resend.emails.send({
    from: 'Seu App <onboarding@seuapp.com>',
    to: email,
    subject: 'Bem-vindo!',
    react: WelcomeEmail({ userName: name }),
  });
}
```

---

## COMPONENTES PRINCIPAIS

### Estrutura de Pastas
```
/app
  /(auth)
    /sign-in/[[...sign-in]]
    /sign-up/[[...sign-up]]
  /(onboarding)
    /onboarding
  /(app)
    /dashboard
    /[funcionalidade-1]
    /[funcionalidade-2]
  /api
    /webhooks
      /clerk
/components
  /[agrupamento-por-feature]
  /ui (shadcn)
/lib
  /db
  /supabase
  /hooks
  /actions
/emails
```

[Componentes Críticos]
[Listar os 3-5 componentes principais com código de exemplo]

---

## DESIGN SYSTEM

### Cores (Tailwind Config)
```javascript
colors: {
  primary: '#[cor]',
  secondary: '#[cor]',
  // [Paleta completa baseada no projeto]
}
```

### Typography
- Headings: [definir estilos]
- Body: [definir estilos]
- Small: [definir estilos]

### Componentes Base (shadcn/ui)
[Listar componentes shadcn necessários: Button, Card, Dialog, etc]

---

## SERVER ACTIONS

### Padrão de Implementação
```typescript
// lib/actions/[feature].ts
'use server';

import { auth } from '@clerk/nextjs';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function [actionName](data: [Type]) {
  const { userId, orgId } = auth();

  if (!userId || !orgId) {
    throw new Error('Não autorizado');
  }

  // Implementação
  // Sempre incluir organization_id nas queries

  revalidatePath('/[path]');
  return { success: true };
}
```

[Criar exemplos dos Server Actions principais]

---

## SEGURANÇA

### Checklist
- ✅ RLS habilitado em todas as tabelas
- ✅ Todas as queries filtram por organization_id
- ✅ Server Actions validam auth()
- ✅ Zod validation em forms
- ✅ Variáveis de ambiente seguras
- ✅ CORS configurado
- ✅ Rate limiting (Vercel)

### Exemplo de Query Segura
```typescript
// ✅ CORRETO
const data = await db.query.table.findMany({
  where: (table, { eq }) => eq(table.organizationId, orgId)
});

// ❌ ERRADO
const data = await db.query.table.findMany();
```

---

## PERFORMANCE

### Otimizações
- [Listar otimizações específicas do projeto]
- React Server Components
- Streaming SSR
- Image optimization (next/image)
- Edge Functions quando apropriado

### Metas
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Lighthouse Score: > 90

---

## GITHUB WORKFLOW

### Branch Strategy
```
main (produção)
  └── develop (staging)
       └── feature/* (desenvolvimento)
```

### CI/CD Pipeline
```yaml
# .github/workflows/main.yml
name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run lint
      - run: npm run build
```

---

## DEPLOY CHECKLIST

### Variáveis de Ambiente (Vercel):
```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Resend
RESEND_API_KEY=

# App
NEXT_PUBLIC_URL=
```

### Passos:
1. Criar projeto no Vercel (conectar GitHub)
2. Criar projeto no Supabase
3. Configurar Clerk (adicionar domínio de produção)
4. Configurar Resend (verificar domínio)
5. Executar migrations no Supabase
6. Configurar webhooks (Clerk → sua API)
7. Deploy automático via GitHub

---

## ROADMAP TÉCNICO

### Fase 1 - MVP (Semana 1-2):
- [Funcionalidade core 1]
- [Funcionalidade core 2]
- Setup completo da infraestrutura

### Fase 2 - Melhorias (Semana 3-4):
- [Feature adicional 1]
- [Feature adicional 2]
- Testes e otimizações

### Fase 3 - Lançamento (Semana 5+):
- Documentação final
- Monitoramento e analytics
- Feedback loop
```

---

## INSTRUÇÕES DE EXECUÇÃO

Ao receber os requisitos funcionais do usuário:

1. **Analise os requisitos** e identifique:
   - Funcionalidades principais
   - Modelos de dados necessários
   - Fluxos de usuário críticos
   - Integrações específicas

2. **Gere o PRD.md** incluindo:
   - Todas as funcionalidades solicitadas organizadas logicamente
   - Personas relevantes ao caso de uso
   - Onboarding adequado ao tipo de produto
   - Métricas apropriadas

3. **Gere o SPECS.md** incluindo:
   - Schema completo do banco (todas as tabelas necessárias)
   - RLS policies para cada tabela
   - Server Actions para operações críticas
   - Componentes principais com código de exemplo
   - Integrações específicas (emails templates necessários, etc)

4. **Seja específico e prático:**
   - Use exemplos de código reais
   - Inclua valores concretos (não placeholders genéricos)
   - Pense em casos extremos e validações
   - Considere performance e segurança

5. **Mantenha a stack fixa:**
   - SEMPRE use Vercel, Supabase, Clerk, Resend, GitHub
   - Não sugira alternativas
   - Adapte a implementação aos requisitos, não a stack

6. **Salve os arquivos:**
   - Salvar `PRD.md` na raiz do projeto
   - Salvar `SPECS.md` na raiz do projeto
