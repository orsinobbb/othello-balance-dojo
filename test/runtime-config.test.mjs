import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupabaseConfigured, runtimeConfig } from '../src/config/runtime-config.js';

test('runtime defaults fail closed to guest mode', () => {
  const config = runtimeConfig(undefined);
  assert.equal(config.auth.provider, 'guest');
  assert.equal(config.sync.enabled, false);
  assert.equal(isSupabaseConfigured(config), false);
});

test('only a plausible public Supabase configuration enables auth', () => {
  const config = runtimeConfig({ auth: { provider: 'supabase', supabaseUrl: 'https://demo-project.supabase.co', anonKey: 'x'.repeat(80) }, sync: { enabled: true } });
  assert.equal(isSupabaseConfigured(config), true);
});
