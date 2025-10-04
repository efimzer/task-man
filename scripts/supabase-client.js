import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jkyhbvihckgsinhoygey.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpreWhidmloY2tnc2luaG95Z2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2MTM2NzIsImV4cCI6MjA3NTE4OTY3Mn0.yK4KWXAAO_1KDLYyleQXuGtOvDTyL65-GnnkiBZpGwc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error('Get user error:', error);
    return null;
  }
  return user;
}

export async function isAuthenticated() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}
