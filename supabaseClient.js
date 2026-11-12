const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugjigaqblwhwlhsophsw.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnamlnYXFibHdod2xoc29waHN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0MjQwNTcsImV4cCI6MjExMDAwMDA1N30.VrtzZnwDK0TK7NBi0G9s9d-Oy30UsclNc2Bejk1uQX0';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

module.exports = {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
};
