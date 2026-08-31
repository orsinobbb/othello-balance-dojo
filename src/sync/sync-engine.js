export class SupabaseEventSyncAdapter {
  constructor(authProvider) { this.authProvider = authProvider; }
  async push(events, identity) {
    if (!events.length) return [];
    const client = await this.authProvider.client();
    const rows = events.map((event) => ({
      event_id: event.eventId, user_id: identity.userId, device_id: event.deviceId,
      client_seq: event.clientSeq, occurred_at: event.occurredAt, event_type: event.eventType,
      dataset_id: event.datasetId, lesson_id: event.lessonId, position_id: event.positionId, payload: event
    }));
    const { error } = await client.from('learning_events').upsert(rows, { onConflict: 'event_id', ignoreDuplicates: true });
    if (error) throw error;
    return events.map((event) => event.eventId);
  }
  async pull(cursor = 0, limit = 500) {
    const client = await this.authProvider.client();
    const { data, error } = await client.from('learning_events').select('server_seq,payload')
      .gt('server_seq', Number(cursor || 0)).order('server_seq', { ascending: true }).limit(limit);
    if (error) throw error;
    return {
      events: (data || []).map((row) => row.payload),
      cursor: (data || []).reduce((maximum, row) => Math.max(maximum, Number(row.server_seq)), Number(cursor || 0))
    };
  }
}

export class SyncEngine {
  constructor({ store, authProvider, adapter, onEventsChanged = null }) {
    this.store = store; this.authProvider = authProvider; this.adapter = adapter; this.onEventsChanged = onEventsChanged; this.running = false;
  }
  async status() {
    const identity = await this.authProvider.getIdentity();
    return { identity, configured: this.authProvider.kind === 'supabase', pending: await this.store.countOutbox(), remote: await this.store.getSyncState('remote') };
  }
  async run() {
    if (this.running) return this.status();
    this.running = true;
    try {
      const identity = await this.authProvider.getIdentity();
      if (!identity.authenticated || !this.adapter) return this.status();
      const queued = await this.store.peekOutbox(200);
      const accepted = await this.adapter.push(queued.map(({ queuedAt, ...event }) => event), identity);
      await this.store.acknowledgeOutbox(accepted);
      const remoteState = await this.store.getSyncState('remote') || { cursor: 0 };
      const pulled = await this.adapter.pull(remoteState.cursor, 500);
      await this.store.appendEvents(pulled.events, { queue: false });
      await this.store.setSyncState('remote', { cursor: pulled.cursor, syncedAt: new Date().toISOString() });
      if (this.onEventsChanged) await this.onEventsChanged();
      return this.status();
    } finally { this.running = false; }
  }
}
