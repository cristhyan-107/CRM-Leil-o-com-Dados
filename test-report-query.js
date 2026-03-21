require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function test() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = '0fc430a65281b9fdff0c39b30c54093e'; // an existing public_token from the DB

  console.log('Testing with url:', url);
  console.log('Testing with key:', key.substring(0, 10) + '...');

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('reports')
    .select('created_at, custom_notes, properties(*)')
    .eq('public_token', token)
    .maybeSingle();

  console.log('Data:', JSON.stringify(data, null, 2));
  console.log('Error:', error);
}

test();
