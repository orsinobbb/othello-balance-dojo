// 這些都是可公開的瀏覽器端設定；請勿放入 service-role key 或 Google client secret。
window.OTHELLO_CONFIG = Object.freeze({
  auth: {
    provider: 'supabase',
    supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
    anonKey: 'YOUR_PUBLIC_ANON_KEY',
    moduleUrl: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm'
  },
  sync: { enabled: true }
});
