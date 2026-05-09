import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'EVOLUTION_API_URL',
  'EVOLUTION_API_KEY',
  'EVOLUTION_INSTANCE_NAME',
  'EVOLUTION_WEBHOOK_SECRET',
] as const;

function exists(name: (typeof REQUIRED_ENV)[number]) {
  return Boolean(process.env[name]);
}

function maskSecret(value: string | undefined) {
  if (!value) return null;
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL: exists('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: exists('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: exists('SUPABASE_SERVICE_ROLE_KEY'),
    EVOLUTION_API_URL: exists('EVOLUTION_API_URL'),
    EVOLUTION_API_KEY: exists('EVOLUTION_API_KEY'),
    EVOLUTION_INSTANCE_NAME: exists('EVOLUTION_INSTANCE_NAME'),
    EVOLUTION_WEBHOOK_SECRET: exists('EVOLUTION_WEBHOOK_SECRET'),
    masked: {
      EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || null,
      EVOLUTION_INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME || null,
      EVOLUTION_API_KEY: maskSecret(process.env.EVOLUTION_API_KEY),
      EVOLUTION_WEBHOOK_SECRET: maskSecret(process.env.EVOLUTION_WEBHOOK_SECRET),
      SUPABASE_SERVICE_ROLE_KEY: maskSecret(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
  });
}
