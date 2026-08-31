const DEFAULT_CONFIG = Object.freeze({ auth: Object.freeze({ provider: 'guest' }), sync: Object.freeze({ enabled: false }) });

export function runtimeConfig(source = globalThis.OTHELLO_CONFIG) {
  const supplied = source && typeof source === 'object' ? source : {};
  return {
    ...DEFAULT_CONFIG,
    ...supplied,
    auth: { ...DEFAULT_CONFIG.auth, ...(supplied.auth || {}) },
    sync: { ...DEFAULT_CONFIG.sync, ...(supplied.sync || {}) }
  };
}
export function isSupabaseConfigured(config) {
  return config?.auth?.provider === 'supabase'
    && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.auth.supabaseUrl || '')
    && typeof config.auth.anonKey === 'string'
    && config.auth.anonKey.length > 40;
}
