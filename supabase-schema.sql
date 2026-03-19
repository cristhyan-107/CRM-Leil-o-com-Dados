-- =====================================================
-- CRM Leilão Ágil — Schema Completo (Supabase/PostgreSQL)
-- Execute este arquivo no Supabase SQL Editor
-- =====================================================

-- ==================== ENUMS ====================

CREATE TYPE property_type AS ENUM (
  'house', 'apartment', 'land', 'commercial', 'farm', 'other'
);

CREATE TYPE property_purpose AS ENUM ('sale', 'rent', 'both');

CREATE TYPE property_status AS ENUM (
  'available', 'reserved', 'sold', 'inactive'
);

CREATE TYPE lead_temperature AS ENUM ('hot', 'warm', 'cold');

CREATE TYPE lead_status AS ENUM (
  'new', 'contacted', 'visited', 'proposal', 'negotiating', 'closed', 'lost'
);

CREATE TYPE lead_source AS ENUM (
  'website', 'referral', 'portal', 'whatsapp', 'social_media', 'other'
);

CREATE TYPE visit_status AS ENUM (
  'scheduled', 'completed', 'cancelled', 'rescheduled'
);

CREATE TYPE activity_type AS ENUM (
  'call', 'whatsapp', 'email', 'visit', 'note', 'status_change', 'report_sent', 'follow_up'
);

-- ==================== TABLES ====================

-- profiles: auto-created on signup via trigger
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  phone TEXT,
  creci TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on signup
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- properties (imóveis)
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  code TEXT NOT NULL,
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
  area NUMERIC(10,2),
  description TEXT,
  status property_status NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_properties_user_id ON properties(user_id);
CREATE INDEX idx_properties_status ON properties(status);
CREATE UNIQUE INDEX idx_properties_code_user ON properties(user_id, code);

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own properties"
  ON properties FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);
CREATE POLICY "Users can create properties"
  ON properties FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own properties"
  ON properties FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own properties"
  ON properties FOR DELETE USING (auth.uid() = user_id);

-- Auto-generate property code (IMV-001, IMV-002, etc)
CREATE OR REPLACE FUNCTION generate_property_code()
RETURNS trigger AS $$
DECLARE next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 5) AS INTEGER)), 0) + 1
  INTO next_num FROM properties WHERE user_id = NEW.user_id;
  NEW.code := 'IMV-' || LPAD(next_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_property_code
  BEFORE INSERT ON properties
  FOR EACH ROW EXECUTE FUNCTION generate_property_code();

-- property_images
CREATE TABLE property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  is_cover BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_property_images_property ON property_images(property_id);

ALTER TABLE property_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own property images"
  ON property_images FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own property images"
  ON property_images FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own property images"
  ON property_images FOR DELETE USING (auth.uid() = user_id);

-- leads
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
  lost_reason TEXT,
  last_contact_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_leads_user_id ON leads(user_id);
CREATE INDEX idx_leads_property_id ON leads(property_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_temperature ON leads(temperature);
CREATE INDEX idx_leads_last_contact ON leads(last_contact_at);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own leads"
  ON leads FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);
CREATE POLICY "Users can create leads"
  ON leads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own leads"
  ON leads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own leads"
  ON leads FOR DELETE USING (auth.uid() = user_id);

-- visits
CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  notes TEXT,
  feedback TEXT,
  status visit_status NOT NULL DEFAULT 'scheduled',
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_visits_user_id ON visits(user_id);
CREATE INDEX idx_visits_lead_id ON visits(lead_id);
CREATE INDEX idx_visits_date ON visits(scheduled_date);
CREATE INDEX idx_visits_status ON visits(status);

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own visits"
  ON visits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create visits"
  ON visits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own visits"
  ON visits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own visits"
  ON visits FOR DELETE USING (auth.uid() = user_id);

-- activities (histórico)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type activity_type NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activities_lead_id ON activities(lead_id);
CREATE INDEX idx_activities_user_id ON activities(user_id);
CREATE INDEX idx_activities_created_at ON activities(created_at DESC);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own activities"
  ON activities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create activities"
  ON activities FOR INSERT WITH CHECK (auth.uid() = user_id);

-- reports (relatórios)
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  custom_notes TEXT,
  public_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sent_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_user_id ON reports(user_id);
CREATE INDEX idx_reports_property_id ON reports(property_id);
CREATE INDEX idx_reports_public_token ON reports(public_token);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports"
  ON reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create reports"
  ON reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reports"
  ON reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Anyone can view by public token"
  ON reports FOR SELECT USING (public_token IS NOT NULL);

-- ==================== TRIGGERS ====================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_visits_updated_at
  BEFORE UPDATE ON visits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================== STORAGE ====================

-- Criar bucket para fotos de imóveis
INSERT INTO storage.buckets (id, name, public) VALUES ('property-images', 'property-images', true);

CREATE POLICY "Users can upload property images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Public can view property images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images');

CREATE POLICY "Users can delete own images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ==================== AUTOMATION ====================

-- Auto-cool inactive leads (run via pg_cron or Edge Function)
CREATE OR REPLACE FUNCTION auto_cool_inactive_leads()
RETURNS void AS $$
BEGIN
  UPDATE leads
  SET temperature = 'cold', updated_at = NOW()
  WHERE
    temperature != 'cold'
    AND status NOT IN ('closed', 'lost')
    AND deleted_at IS NULL
    AND (
      (last_contact_at IS NULL AND created_at < NOW() - INTERVAL '3 days')
      OR last_contact_at < NOW() - INTERVAL '3 days'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
