import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/sync/sync-engine.js';

test('sync pushes the outbox, acknowledges accepted events, then pulls without requeueing', async () => {
  const calls = [];
  const store = {
    countOutbox: async () => 0,
    getSyncState: async () => ({ cursor: 4 }),
    peekOutbox: async () => [{ eventId: 'e1', eventType: 'move_attempted', queuedAt: 'now' }],
    acknowledgeOutbox: async (ids) => calls.push(['ack', ids]),
    appendEvents: async (events, options) => calls.push(['append', events, options]),
    setSyncState: async (key, value) => calls.push(['state', key, value])
  };
  const authProvider = { kind: 'supabase', getIdentity: async () => ({ authenticated: true, userId: 'u1' }) };
  const adapter = {
    push: async (events) => { calls.push(['push', events]); return ['e1']; },
    pull: async (cursor) => ({ events: [{ eventId: 'e2' }], cursor: cursor + 1 })
  };
  await new SyncEngine({ store, authProvider, adapter }).run();
  assert.deepEqual(calls[0], ['push', [{ eventId: 'e1', eventType: 'move_attempted' }]]);
  assert.deepEqual(calls[1], ['ack', ['e1']]);
  assert.deepEqual(calls[2], ['append', [{ eventId: 'e2' }], { queue: false }]);
});
