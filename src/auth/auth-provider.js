import { isSupabaseConfigured } from '../config/runtime-config.js';

export class GuestAuthProvider {
  constructor(profile) { this.profile = profile; this.kind = 'guest'; }
  async getIdentity() {
    return { authenticated: false, provider: 'guest', userId: null, displayName: this.profile.displayName || '此裝置的學習者', email: null, profileId: this.profile.id };
  }
  async signIn() { throw new Error('尚未設定 Google 登入'); }
  async signOut() { return this.getIdentity(); }
  subscribe(callback) { callback?.(); return () => {}; }
}

export class SupabaseAuthProvider {
  constructor(config, profile) { this.config = config; this.profile = profile; this.kind = 'supabase'; this.clientPromise = null; }
  async client() {
    if (!this.clientPromise) {
      this.clientPromise = import(this.config.moduleUrl || 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm')
        .then(({ createClient }) => createClient(this.config.supabaseUrl, this.config.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        }));
    }
    return this.clientPromise;
  }
  async getIdentity() {
    const client = await this.client();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user) return new GuestAuthProvider(this.profile).getIdentity();
    return {
      authenticated: true,
      provider: user.app_metadata?.provider || 'google',
      userId: user.id,
      displayName: user.user_metadata?.full_name || user.user_metadata?.name || user.email || '學習者',
      email: user.email || null,
      avatarUrl: user.user_metadata?.avatar_url || null,
      profileId: this.profile.id
    };
  }
  async signIn() {
    const client = await this.client();
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, scopes: 'openid email profile' } });
    if (error) throw error;
  }
  async signOut() {
    const client = await this.client();
    const { error } = await client.auth.signOut();
    if (error) throw error;
    return this.getIdentity();
  }
  async subscribe(callback) {
    const client = await this.client();
    const { data } = client.auth.onAuthStateChange(() => callback?.());
    return () => data.subscription.unsubscribe();
  }
}

export function createAuthProvider(config, profile) {
  return isSupabaseConfigured(config) ? new SupabaseAuthProvider(config.auth, profile) : new GuestAuthProvider(profile);
}
