import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY;

let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase env vars not configured');
  }
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _client;
}

export interface Lead {
  source: 'form' | 'chatbot';
  nombre?: string | null;
  email?: string | null;
  telefono?: string | null;
  empresa?: string | null;
  servicio?: string | null;
  desafio?: string | null;
  conversacion?: any;
  estado?: string;
  notas?: string;
}
