# SPECS - CRM Leilão Ágil

## STACK TECNOLÓGICA

### Frontend
- **Framework:** Next.js 15 (App Router)
- **Linguagem:** TypeScript 5+
- **UI Library:** shadcn/ui + Radix UI
- **Styling:** Tailwind CSS 3.4+
- **State Management:**
  - Zustand (client state: sidebar, modals, filtros)
  - TanStack Query v5 (server state: cache e revalidação)
- **Forms:** React Hook Form + Zod
- **Charts:** Recharts
- **Drag & Drop:** @dnd-kit/core + @dnd-kit/sortable (Kanban)
- **Date Handling:** date-fns (pt-BR locale)
- **Icons:** Lucide React

### Backend & Database
- **Database:** Supabase (PostgreSQL 15)
- **ORM:** Drizzle ORM
- **API:** Next.js Server Actions
- **Realtime:** Supabase Realtime (atualizações no pipeline)
- **Storage:** Supabase Storage (fotos de imóveis)

### Autenticação
- **Provider:** Supabase Auth
- **Features:** Email/Senha, OAuth (Google), recuperação de senha
- **Middleware:** Next.js middleware para proteção de rotas

### Email
- **Provider:** Resend
- **Templates:** React Email
- **Tipos:**
  - Boas-vindas (após cadastro)
  - Confirmação de visita agendada
  - Lembrete de visita (1h antes)
  - Alerta de lead sem contato (24h)

### Infraestrutura
- **Hosting:** Vercel (Edge Functions)
- **Repository:** GitHub
- **CI/CD:** GitHub Actions + Vercel Auto Deploy
- **Monitoring:** Vercel Analytics + Sentry (error tracking)

---

## ARQUITETURA DE ISOLAMENTO DE DADOS

### Estratégia: Row-Level Security (RLS) via `user_id`

**Por quê?**
- V1 é individual (sem multi-tenancy por organização)
- Cada usuário só vê seus próprios dados
- RLS nativo do Supabase garante isolamento no nível do banco
- Preparado para evoluir para `organization_id` no futuro

### Fluxo de Autenticação
```
Request → Supabase Auth → auth.uid() → RLS filtra por user_id
```

### Middleware de Proteção
```typescript
// middleware.ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });
  const { data: { session } } = await supabase.auth.getSession();

  // Rotas públicas
  const publicRoutes = ['/', '/login', '/sign-up', '/forgot-password'];
  if (publicRoutes.includes(req.nextUrl.pathname)) {
    if (session) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
    return res;
  }

  // Rotas protegidas
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
```

---

## SCHEMA DO BANCO DE DADOS (SUPABASE)

### Convenções
- Todas as tabelas possuem `user_id UUID NOT NULL REFERENCES auth.users(id)`
- RLS habilitado em TODAS as tabelas
- Soft deletes: `deleted_at TIMESTAMPTZ` (onde aplicável)
- Audit trail: `created_at`, `updated_at`
- UUIDs para IDs primários via `gen_random_uuid()`
- Enums para campos com valores fixos

---

### Enums

```sql
-- Tipos de imóvel
CREATE TYPE property_type AS ENUM (
  'house', 'apartment', 'land', 'commercial', 'farm', 'other'
);

-- Finalidade do imóvel
CREATE TYPE property_purpose AS ENUM ('sale', 'rent', 'both');

-- Status do imóvel
CREATE TYPE property_status AS ENUM (
  'available', 'reserved', 'sold', 'inactive'
);

-- Temperatura do lead
CREATE TYPE lead_temperature AS ENUM ('hot', 'warm', 'cold');

-- Status do lead no pipeline
CREATE TYPE lead_status AS ENUM (
  'new', 'contacted', 'visited', 'proposal', 'negotiating', 'closed', 'lost'
);

-- Origem do lead
CREATE TYPE lead_source AS ENUM (
  'website', 'referral', 'portal', 'whatsapp', 'social_media', 'other'
);

-- Status da visita
CREATE TYPE visit_status AS ENUM (
  'scheduled', 'completed', 'cancelled', 'rescheduled'
);

-- Tipo de atividade
CREATE TYPE activity_type AS ENUM (
  'call', 'whatsapp', 'email', 'visit', 'note', 'status_change', 'report_sent', 'follow_up'
);
```

---

### Tabela: profiles

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  phone TEXT,
  creci TEXT, -- registro profissional do corretor

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ language plpgsql security definer;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

### Tabela: properties (imóveis)

```sql
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  code TEXT NOT NULL, -- código auto-gerado (ex: IMV-001)
  type property_type NOT NULL DEFAULT 'house',
  purpose property_purpose NOT NULL DEFAULT 'sale',
  price NUMERIC(12,2) NOT NULL,

  city TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  address TEXT,
  state TEXT,
  zip_code TEXT,

  bedrooms INTEGER DEFAULT 0,
  bathrooms INTEGER DEFAULT 0,
  parking_spaces INTEGER DEFAULT 0,
  area NUMERIC(10,2), -- m²

  description TEXT,
  status property_status NOT NULL DEFAULT 'available',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_properties_user_id ON properties(user_id);
CREATE INDEX idx_properties_status ON properties(status);
CREATE INDEX idx_properties_city ON properties(city);
CREATE UNIQUE INDEX idx_properties_code_user ON properties(user_id, code);

-- RLS
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own properties"
  ON properties FOR SELECT
  USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can create properties"
  ON properties FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own properties"
  ON properties FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can soft-delete own properties"
  ON properties FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-generate property code
CREATE OR REPLACE FUNCTION generate_property_code()
RETURNS trigger AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(code FROM 5) AS INTEGER)
  ), 0) + 1
  INTO next_num
  FROM properties
  WHERE user_id = NEW.user_id;

  NEW.code := 'IMV-' || LPAD(next_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ language plpgsql;

CREATE TRIGGER set_property_code
  BEFORE INSERT ON properties
  FOR EACH ROW EXECUTE FUNCTION generate_property_code();
```

---

### Tabela: property_images

```sql
CREATE TABLE property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  url TEXT NOT NULL,
  storage_path TEXT NOT NULL, -- caminho no Supabase Storage
  position INTEGER DEFAULT 0, -- ordem da imagem
  is_cover BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_property_images_property ON property_images(property_id);

-- RLS
ALTER TABLE property_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own property images"
  ON property_images FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own property images"
  ON property_images FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own property images"
  ON property_images FOR DELETE
  USING (auth.uid() = user_id);
```

---

### Tabela: leads

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,

  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,

  status lead_status NOT NULL DEFAULT 'new',
  temperature lead_temperature NOT NULL DEFAULT 'warm',
  source lead_source DEFAULT 'other',
  notes TEXT,

  lost_reason TEXT, -- motivo de perda (obrigatório quando status = 'lost')
  last_contact_at TIMESTAMPTZ, -- última interação
  closed_at TIMESTAMPTZ, -- data de fechamento

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_leads_user_id ON leads(user_id);
CREATE INDEX idx_leads_property_id ON leads(property_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_temperature ON leads(temperature);
CREATE INDEX idx_leads_last_contact ON leads(last_contact_at);

-- RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own leads"
  ON leads FOR SELECT
  USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can create leads"
  ON leads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own leads"
  ON leads FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own leads"
  ON leads FOR DELETE
  USING (auth.uid() = user_id);
```

---

### Tabela: visits (visitas)

```sql
CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,

  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  notes TEXT,
  feedback TEXT, -- feedback após a visita realizada

  status visit_status NOT NULL DEFAULT 'scheduled',

  reminder_sent BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_visits_user_id ON visits(user_id);
CREATE INDEX idx_visits_lead_id ON visits(lead_id);
CREATE INDEX idx_visits_date ON visits(scheduled_date);
CREATE INDEX idx_visits_status ON visits(status);

-- RLS
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own visits"
  ON visits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create visits"
  ON visits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own visits"
  ON visits FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own visits"
  ON visits FOR DELETE
  USING (auth.uid() = user_id);
```

---

### Tabela: activities (histórico de atividades)

```sql
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  type activity_type NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB, -- dados extras (ex: status anterior, novo status)

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_activities_lead_id ON activities(lead_id);
CREATE INDEX idx_activities_user_id ON activities(user_id);
CREATE INDEX idx_activities_type ON activities(type);
CREATE INDEX idx_activities_created_at ON activities(created_at DESC);

-- RLS
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own activities"
  ON activities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create activities"
  ON activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

---

### Tabela: reports (relatórios)

```sql
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  custom_notes TEXT, -- observações do corretor
  public_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  -- token para link público compartilhável

  sent_at TIMESTAMPTZ, -- quando foi enviado via WhatsApp
  view_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_reports_user_id ON reports(user_id);
CREATE INDEX idx_reports_property_id ON reports(property_id);
CREATE INDEX idx_reports_public_token ON reports(public_token);

-- RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports"
  ON reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create reports"
  ON reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
  ON reports FOR UPDATE
  USING (auth.uid() = user_id);

-- Acesso público via token (para link compartilhável)
CREATE POLICY "Anyone can view report by public token"
  ON reports FOR SELECT
  USING (public_token IS NOT NULL);
```

---

### Função: Auto-update `updated_at`

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language plpgsql;

-- Aplicar em todas as tabelas com updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_visits_updated_at
  BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

### Função: Auto-cool leads (3 dias sem contato → frio)

```sql
-- Executar via Supabase pg_cron ou Edge Function agendada
CREATE OR REPLACE FUNCTION auto_cool_inactive_leads()
RETURNS void AS $$
BEGIN
  UPDATE leads
  SET
    temperature = 'cold',
    updated_at = NOW()
  WHERE
    temperature != 'cold'
    AND status NOT IN ('closed', 'lost')
    AND deleted_at IS NULL
    AND (
      last_contact_at IS NULL AND created_at < NOW() - INTERVAL '3 days'
      OR last_contact_at < NOW() - INTERVAL '3 days'
    );
END;
$$ language plpgsql security definer;
```

---

## DRIZZLE ORM SCHEMA

```typescript
// lib/db/schema.ts
import {
  pgTable, pgEnum, text, timestamp, uuid, numeric,
  integer, boolean, jsonb, date, time
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const propertyTypeEnum = pgEnum('property_type', [
  'house', 'apartment', 'land', 'commercial', 'farm', 'other'
]);
export const propertyPurposeEnum = pgEnum('property_purpose', ['sale', 'rent', 'both']);
export const propertyStatusEnum = pgEnum('property_status', [
  'available', 'reserved', 'sold', 'inactive'
]);
export const leadTemperatureEnum = pgEnum('lead_temperature', ['hot', 'warm', 'cold']);
export const leadStatusEnum = pgEnum('lead_status', [
  'new', 'contacted', 'visited', 'proposal', 'negotiating', 'closed', 'lost'
]);
export const leadSourceEnum = pgEnum('lead_source', [
  'website', 'referral', 'portal', 'whatsapp', 'social_media', 'other'
]);
export const visitStatusEnum = pgEnum('visit_status', [
  'scheduled', 'completed', 'cancelled', 'rescheduled'
]);
export const activityTypeEnum = pgEnum('activity_type', [
  'call', 'whatsapp', 'email', 'visit', 'note', 'status_change', 'report_sent', 'follow_up'
]);

// Tables
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  avatarUrl: text('avatar_url'),
  phone: text('phone'),
  creci: text('creci'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const properties = pgTable('properties', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  title: text('title').notNull(),
  code: text('code').notNull(),
  type: propertyTypeEnum('type').notNull().default('house'),
  purpose: propertyPurposeEnum('purpose').notNull().default('sale'),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  city: text('city').notNull(),
  neighborhood: text('neighborhood').notNull(),
  address: text('address'),
  state: text('state'),
  zipCode: text('zip_code'),
  bedrooms: integer('bedrooms').default(0),
  bathrooms: integer('bathrooms').default(0),
  parkingSpaces: integer('parking_spaces').default(0),
  area: numeric('area', { precision: 10, scale: 2 }),
  description: text('description'),
  status: propertyStatusEnum('status').notNull().default('available'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const propertyImages = pgTable('property_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull(),
  userId: uuid('user_id').notNull(),
  url: text('url').notNull(),
  storagePath: text('storage_path').notNull(),
  position: integer('position').default(0),
  isCover: boolean('is_cover').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  propertyId: uuid('property_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  status: leadStatusEnum('status').notNull().default('new'),
  temperature: leadTemperatureEnum('temperature').notNull().default('warm'),
  source: leadSourceEnum('source').default('other'),
  notes: text('notes'),
  lostReason: text('lost_reason'),
  lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const visits = pgTable('visits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  propertyId: uuid('property_id').notNull(),
  scheduledDate: date('scheduled_date').notNull(),
  scheduledTime: time('scheduled_time').notNull(),
  notes: text('notes'),
  feedback: text('feedback'),
  status: visitStatusEnum('status').notNull().default('scheduled'),
  reminderSent: boolean('reminder_sent').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const activities = pgTable('activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  type: activityTypeEnum('type').notNull(),
  description: text('description').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  propertyId: uuid('property_id').notNull(),
  leadId: uuid('lead_id'),
  customNotes: text('custom_notes'),
  publicToken: text('public_token').unique().notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  viewCount: integer('view_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Relations
export const propertiesRelations = relations(properties, ({ one, many }) => ({
  owner: one(profiles, { fields: [properties.userId], references: [profiles.id] }),
  leads: many(leads),
  images: many(propertyImages),
  visits: many(visits),
  reports: many(reports),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  owner: one(profiles, { fields: [leads.userId], references: [profiles.id] }),
  property: one(properties, { fields: [leads.propertyId], references: [properties.id] }),
  visits: many(visits),
  activities: many(activities),
  reports: many(reports),
}));

export const visitsRelations = relations(visits, ({ one }) => ({
  lead: one(leads, { fields: [visits.leadId], references: [leads.id] }),
  property: one(properties, { fields: [visits.propertyId], references: [properties.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  lead: one(leads, { fields: [activities.leadId], references: [leads.id] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  property: one(properties, { fields: [reports.propertyId], references: [properties.id] }),
  lead: one(leads, { fields: [reports.leadId], references: [leads.id] }),
}));
```

---

## SUPABASE INTEGRATION

### Client Setup

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

```typescript
// lib/supabase/server.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch { /* Server Component */ }
        },
      },
    }
  );
}
```

### Drizzle DB Client

```typescript
// lib/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
export const db = drizzle(client, { schema });
```

### Storage Setup (Fotos de Imóveis)

```sql
-- Criar bucket no Supabase
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-images', 'property-images', true);

-- Policy: upload apenas pelo dono
CREATE POLICY "Users can upload property images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policy: visualização pública
CREATE POLICY "Public can view property images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images');

-- Policy: delete pelo dono
CREATE POLICY "Users can delete own images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

---

## RESEND INTEGRATION

### Email Templates

```typescript
// emails/welcome.tsx
import { Html, Head, Body, Container, Text, Button, Hr } from '@react-email/components';

interface WelcomeEmailProps {
  userName: string;
}

export function WelcomeEmail({ userName }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', background: '#f4f4f5' }}>
        <Container style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
          <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
            Bem-vindo ao Leilão Ágil! 🏠
          </Text>
          <Text>Olá {userName}, sua conta foi criada com sucesso.</Text>
          <Text>Comece cadastrando seu primeiro imóvel e seus leads.</Text>
          <Button
            href={`${process.env.NEXT_PUBLIC_URL}/dashboard`}
            style={{ background: '#2563eb', color: '#fff', padding: '12px 24px', borderRadius: 8 }}
          >
            Acessar Dashboard
          </Button>
          <Hr />
          <Text style={{ color: '#71717a', fontSize: 12 }}>
            CRM Leilão Ágil — Feche mais negócios.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

```typescript
// emails/visit-reminder.tsx
import { Html, Head, Body, Container, Text, Hr } from '@react-email/components';

interface VisitReminderProps {
  userName: string;
  leadName: string;
  propertyTitle: string;
  date: string;
  time: string;
}

export function VisitReminderEmail(props: VisitReminderProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', background: '#f4f4f5' }}>
        <Container style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: 'bold' }}>
            ⏰ Lembrete de Visita
          </Text>
          <Text>Olá {props.userName},</Text>
          <Text>
            Você tem uma visita agendada em <strong>1 hora</strong>:
          </Text>
          <Text>
            📍 <strong>{props.propertyTitle}</strong><br />
            👤 Lead: {props.leadName}<br />
            📅 {props.date} às {props.time}
          </Text>
          <Hr />
          <Text style={{ color: '#71717a', fontSize: 12 }}>
            CRM Leilão Ágil
          </Text>
        </Container>
      </Body>
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
import { VisitReminderEmail } from '@/emails/visit-reminder';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Leilão Ágil <noreply@leilaoagil.com.br>';

export async function sendWelcomeEmail(email: string, name: string) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Bem-vindo ao Leilão Ágil! 🏠',
    react: WelcomeEmail({ userName: name }),
  });
}

export async function sendVisitReminder(
  email: string,
  data: { userName: string; leadName: string; propertyTitle: string; date: string; time: string }
) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `⏰ Visita em 1h: ${data.propertyTitle}`,
    react: VisitReminderEmail(data),
  });
}
```

---

## WHATSAPP INTEGRATION

### Helper de Mensagens

```typescript
// lib/whatsapp.ts

function formatPhone(phone: string): string {
  // Remove tudo que não é número
  const clean = phone.replace(/\D/g, '');
  // Adiciona código do país se necessário
  if (clean.startsWith('55')) return clean;
  return `55${clean}`;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const formattedPhone = formatPhone(phone);
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
}

// Templates de mensagem
export const whatsappTemplates = {
  firstContact: (leadName: string, propertyTitle: string) =>
    `Olá ${leadName}! 👋\n\nSou corretor de imóveis e vi que você tem interesse no imóvel *${propertyTitle}*.\n\nPosso te passar mais informações? 🏠`,

  visitConfirmation: (leadName: string, propertyTitle: string, date: string, time: string) =>
    `Olá ${leadName}! ✅\n\nConfirmando sua visita:\n\n📍 *${propertyTitle}*\n📅 ${date}\n🕐 ${time}\n\nTe espero lá! 😊`,

  reportShare: (leadName: string, propertyTitle: string, reportUrl: string) =>
    `Olá ${leadName}! 📋\n\nPreparei um relatório completo do imóvel *${propertyTitle}* para você:\n\n🔗 ${reportUrl}\n\nQualquer dúvida, estou à disposição! 🏠`,

  followUp: (leadName: string, propertyTitle: string) =>
    `Olá ${leadName}! 😊\n\nEstou passando para saber se você tem alguma dúvida sobre o imóvel *${propertyTitle}*.\n\nPosso agendar uma visita para você conhecer pessoalmente? 📅`,
};
```

---

## COMPONENTES PRINCIPAIS

### Estrutura de Pastas

```
/app
  /(auth)
    /login/page.tsx
    /sign-up/page.tsx
    /forgot-password/page.tsx
  /(app)
    /layout.tsx           -- sidebar + header
    /dashboard/page.tsx
    /leads/page.tsx
    /leads/[id]/page.tsx
    /properties/page.tsx
    /properties/[id]/page.tsx
    /pipeline/page.tsx
    /visits/page.tsx
    /reports/page.tsx
    /reports/[token]/page.tsx  -- relatório público
    /settings/page.tsx
  /api
    /cron
      /cool-leads/route.ts    -- auto-cool leads inativos
      /visit-reminders/route.ts
/components
  /layout
    sidebar.tsx
    header.tsx
    mobile-nav.tsx
  /dashboard
    metrics-cards.tsx
    sales-funnel-chart.tsx
    leads-by-source-chart.tsx
    visits-chart.tsx
    attention-leads.tsx
    recent-activities.tsx
  /leads
    lead-form.tsx
    lead-table.tsx
    lead-card.tsx
    lead-details.tsx
    lead-activity-timeline.tsx
  /properties
    property-form.tsx
    property-card.tsx
    property-grid.tsx
    property-details.tsx
    image-upload.tsx
  /pipeline
    kanban-board.tsx
    kanban-column.tsx
    kanban-card.tsx
  /visits
    visit-form.tsx
    visit-list.tsx
    visit-calendar.tsx
  /reports
    report-generator.tsx
    report-preview.tsx
    report-public-view.tsx
  /shared
    whatsapp-button.tsx
    empty-state.tsx
    confirm-dialog.tsx
    data-table.tsx
    stats-card.tsx
  /ui  -- shadcn/ui
/lib
  /db
    index.ts
    schema.ts
  /supabase
    client.ts
    server.ts
  /actions
    leads.ts
    properties.ts
    visits.ts
    reports.ts
    activities.ts
    email.ts
  /hooks
    use-leads.ts
    use-properties.ts
    use-visits.ts
  /whatsapp.ts
  /utils.ts
  /validations.ts
/emails
  welcome.tsx
  visit-reminder.tsx
  follow-up-alert.tsx
```

### Componente: WhatsApp Button

```typescript
// components/shared/whatsapp-button.tsx
'use client';

import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

interface WhatsAppButtonProps {
  phone: string;
  message: string;
  size?: 'sm' | 'default' | 'lg';
  label?: string;
}

export function WhatsAppButton({ phone, message, size = 'default', label }: WhatsAppButtonProps) {
  const url = buildWhatsAppUrl(phone, message);

  return (
    <Button
      asChild
      size={size}
      className="bg-green-600 hover:bg-green-700 text-white"
    >
      <a href={url} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="w-4 h-4 mr-2" />
        {label || 'WhatsApp'}
      </a>
    </Button>
  );
}
```

### Componente: Kanban Card

```typescript
// components/pipeline/kanban-card.tsx
'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WhatsAppButton } from '@/components/shared/whatsapp-button';
import { whatsappTemplates } from '@/lib/whatsapp';
import { Building2, Clock, Flame, CloudSun, Snowflake } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const temperatureIcons = {
  hot: <Flame className="w-3 h-3 text-red-500" />,
  warm: <CloudSun className="w-3 h-3 text-amber-500" />,
  cold: <Snowflake className="w-3 h-3 text-blue-400" />,
};

interface KanbanCardProps {
  lead: {
    id: string;
    name: string;
    phone: string;
    temperature: 'hot' | 'warm' | 'cold';
    createdAt: string;
    property: { title: string };
  };
}

export function KanbanCard({ lead }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm truncate">{lead.name}</span>
            {temperatureIcons[lead.temperature]}
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="w-3 h-3" />
            <span className="truncate">{lead.property.title}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(new Date(lead.createdAt), { locale: ptBR, addSuffix: true })}
            </span>

            <WhatsAppButton
              phone={lead.phone}
              message={whatsappTemplates.followUp(lead.name, lead.property.title)}
              size="sm"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## DESIGN SYSTEM

### Cores (Tailwind Config)

```javascript
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        // Brand
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6', // principal
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Pipeline status colors
        pipeline: {
          new:         '#6366f1', // indigo
          contacted:   '#8b5cf6', // violet
          visited:     '#f59e0b', // amber
          proposal:    '#3b82f6', // blue
          negotiating: '#f97316', // orange
          closed:      '#22c55e', // green
          lost:        '#ef4444', // red
        },
        // Temperature
        temperature: {
          hot:  '#ef4444',
          warm: '#f59e0b',
          cold: '#60a5fa',
        },
      },
    },
  },
};
```

### Typography
- **Headings:** Inter (weight 600-700), tracking-tight
- **Body:** Inter (weight 400), text-sm/base
- **Small/Labels:** Inter (weight 500), text-xs, text-muted-foreground

### Componentes shadcn/ui necessários
- Button, Card, Badge, Input, Textarea, Select
- Dialog, AlertDialog, Sheet (mobile sidebar)
- Table, Tabs, Tooltip
- DropdownMenu, Command (search)
- Calendar, Popover (date picker)
- Form (React Hook Form integration)
- Separator, Avatar, Skeleton
- Toast (sonner)

---

## SERVER ACTIONS

### Padrão Base

```typescript
// lib/actions/base.ts
import { createServerSupabase } from '@/lib/supabase/server';

export async function getAuthUser() {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Não autorizado');
  }

  return user;
}
```

### Leads Actions

```typescript
// lib/actions/leads.ts
'use server';

import { db } from '@/lib/db';
import { leads, activities } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getAuthUser } from './base';
import { z } from 'zod';

const createLeadSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  phone: z.string().min(10, 'Telefone inválido'),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  propertyId: z.string().uuid('Imóvel obrigatório'),
  source: z.enum(['website', 'referral', 'portal', 'whatsapp', 'social_media', 'other']).optional(),
  notes: z.string().optional(),
});

export async function createLead(data: z.infer<typeof createLeadSchema>) {
  const user = await getAuthUser();
  const validated = createLeadSchema.parse(data);

  const [newLead] = await db.insert(leads).values({
    ...validated,
    userId: user.id,
    temperature: 'warm',
    status: 'new',
    lastContactAt: new Date(),
  }).returning();

  // Registrar atividade
  await db.insert(activities).values({
    userId: user.id,
    leadId: newLead.id,
    type: 'note',
    description: 'Lead criado no sistema',
  });

  revalidatePath('/leads');
  revalidatePath('/pipeline');
  revalidatePath('/dashboard');

  return { success: true, lead: newLead };
}

export async function updateLeadStatus(
  leadId: string,
  newStatus: string,
  lostReason?: string
) {
  const user = await getAuthUser();

  const updateData: Record<string, unknown> = {
    status: newStatus,
    lastContactAt: new Date(),
  };

  if (newStatus === 'lost') {
    if (!lostReason) throw new Error('Motivo de perda obrigatório');
    updateData.lostReason = lostReason;
  }

  if (newStatus === 'closed') {
    updateData.closedAt = new Date();
  }

  await db.update(leads)
    .set(updateData)
    .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)));

  // Registrar atividade
  await db.insert(activities).values({
    userId: user.id,
    leadId,
    type: 'status_change',
    description: `Status alterado para ${newStatus}`,
    metadata: { newStatus, lostReason },
  });

  revalidatePath('/pipeline');
  revalidatePath('/leads');
  revalidatePath('/dashboard');

  return { success: true };
}
```

### Properties Actions

```typescript
// lib/actions/properties.ts
'use server';

import { db } from '@/lib/db';
import { properties } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getAuthUser } from './base';
import { z } from 'zod';

const createPropertySchema = z.object({
  title: z.string().min(3, 'Título deve ter pelo menos 3 caracteres'),
  type: z.enum(['house', 'apartment', 'land', 'commercial', 'farm', 'other']),
  purpose: z.enum(['sale', 'rent', 'both']),
  price: z.number().positive('Preço deve ser maior que zero'),
  city: z.string().min(2),
  neighborhood: z.string().min(2),
  address: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  parkingSpaces: z.number().int().min(0).optional(),
  area: z.number().positive().optional(),
  description: z.string().optional(),
});

export async function createProperty(data: z.infer<typeof createPropertySchema>) {
  const user = await getAuthUser();
  const validated = createPropertySchema.parse(data);

  const [newProperty] = await db.insert(properties).values({
    ...validated,
    price: validated.price.toString(),
    area: validated.area?.toString(),
    userId: user.id,
  }).returning();

  revalidatePath('/properties');
  revalidatePath('/dashboard');

  return { success: true, property: newProperty };
}
```

### Reports Actions

```typescript
// lib/actions/reports.ts
'use server';

import { db } from '@/lib/db';
import { reports, activities } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getAuthUser } from './base';

export async function generateReport(propertyId: string, leadId?: string, customNotes?: string) {
  const user = await getAuthUser();

  const [report] = await db.insert(reports).values({
    userId: user.id,
    propertyId,
    leadId: leadId || null,
    customNotes,
  }).returning();

  // Registrar atividade se vinculado a um lead
  if (leadId) {
    await db.insert(activities).values({
      userId: user.id,
      leadId,
      type: 'report_sent',
      description: 'Relatório do imóvel gerado',
    });
  }

  revalidatePath('/reports');
  return { success: true, report };
}

export async function markReportSent(reportId: string) {
  const user = await getAuthUser();

  await db.update(reports)
    .set({ sentAt: new Date() })
    .where(and(eq(reports.id, reportId), eq(reports.userId, user.id)));

  revalidatePath('/reports');
  return { success: true };
}
```

---

## SEGURANÇA

### Checklist
- ✅ RLS habilitado em **todas** as tabelas
- ✅ Todas as queries filtram por `user_id` (via RLS + Server Actions)
- ✅ Server Actions validam `getAuthUser()` antes de qualquer operação
- ✅ Zod validation em todos os formulários (client + server)
- ✅ Variáveis de ambiente em `.env.local` (nunca commitadas)
- ✅ CORS configurado via Supabase Dashboard
- ✅ Rate limiting (Vercel Edge)
- ✅ Soft deletes para preservar histórico

### Exemplo de Query Segura

```typescript
// ✅ CORRETO — Server Action com auth
export async function getMyLeads() {
  const user = await getAuthUser();
  return db.query.leads.findMany({
    where: (leads, { eq, isNull, and }) =>
      and(eq(leads.userId, user.id), isNull(leads.deletedAt)),
    with: { property: true },
    orderBy: (leads, { desc }) => [desc(leads.createdAt)],
  });
}

// ❌ ERRADO — sem autenticação, sem filtro
export async function getLeads() {
  return db.query.leads.findMany();
}
```

---

## PERFORMANCE

### Otimizações
- React Server Components por padrão (dados no servidor)
- Client Components apenas onde necessário (forms, kanban, charts)
- Streaming SSR com `loading.tsx` e `Suspense`
- Image optimization via `next/image` + Supabase Storage CDN
- `revalidatePath` para invalidar cache cirurgicamente
- Indexes no banco para queries frequentes (user_id, status, date)

### Metas
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Lighthouse Score: > 90
- Kanban drag response: < 100ms

---

## GITHUB WORKFLOW

### Branch Strategy

```
main (produção)
  └── develop (staging)
       └── feature/* (desenvolvimento)
       └── fix/* (correções)
```

### CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

---

## DEPLOY CHECKLIST

### Variáveis de Ambiente (Vercel)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Resend
RESEND_API_KEY=

# App
NEXT_PUBLIC_URL=https://leilaoagil.com.br
```

### Passos

1. Criar repositório no GitHub
2. Criar projeto no Supabase (região: sa-east-1)
3. Executar migrations SQL no Supabase (schema + enums + triggers + RLS)
4. Criar bucket `property-images` no Supabase Storage
5. Configurar Resend (verificar domínio)
6. Conectar GitHub ao Vercel
7. Configurar variáveis de ambiente no Vercel
8. Deploy automático via push na `main`
9. Configurar domínio customizado

---

## ROADMAP TÉCNICO

### Fase 1 — MVP (Semana 1-2)
- [x] Setup: Next.js + Tailwind + shadcn/ui
- [ ] Supabase: schema, enums, RLS, triggers
- [ ] Auth: login, sign-up, middleware, perfil
- [ ] Imóveis: CRUD completo + upload de fotos
- [ ] Leads: CRUD + vinculação a imóvel
- [ ] Pipeline: Kanban com drag-and-drop
- [ ] Dashboard: métricas básicas + gráficos

### Fase 2 — Core Features (Semana 3-4)
- [ ] Visitas: agendamento + calendário
- [ ] Relatórios: geração + link público + envio WhatsApp
- [ ] WhatsApp: templates + botão em todos os contextos
- [ ] Atividades: timeline no lead
- [ ] Automação: lead frio após 3 dias

### Fase 3 — Polish e Lançamento (Semana 5+)
- [ ] Emails transacionais (Resend)
- [ ] Onboarding: checklist de primeiros passos
- [ ] Responsividade: tablet + mobile
- [ ] CI/CD: GitHub Actions + Vercel
- [ ] Monitoramento: Sentry + Vercel Analytics
- [ ] Landing page
- [ ] Documentação
