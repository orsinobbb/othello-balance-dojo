const DB_NAME = 'othello-balance-dojo';
const DB_VERSION = 3;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

function addIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('sessions')) {
        database.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('mistakes')) {
        database.createObjectStore('mistakes', { keyPath: 'key' });
      }
      const events = database.objectStoreNames.contains('learningEvents')
        ? request.transaction.objectStore('learningEvents')
        : database.createObjectStore('learningEvents', { keyPath: 'eventId' });
      addIndex(events, 'occurredAt', 'occurredAt');
      addIndex(events, 'lessonId', 'lessonId');
      addIndex(events, 'eventType', 'eventType');
      if (!database.objectStoreNames.contains('outbox')) {
        const outbox = database.createObjectStore('outbox', { keyPath: 'eventId' });
        addIndex(outbox, 'queuedAt', 'queuedAt');
      }
      if (!database.objectStoreNames.contains('profile')) {
        database.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('masteryProjection')) {
        database.createObjectStore('masteryProjection', { keyPath: 'conceptId' });
      }
      if (!database.objectStoreNames.contains('reviewQueue')) {
        const reviews = database.createObjectStore('reviewQueue', { keyPath: 'itemId' });
        addIndex(reviews, 'dueAt', 'dueAt');
      }
      if (!database.objectStoreNames.contains('syncState')) {
        database.createObjectStore('syncState', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function newId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

async function allFromStore(database, storeName) {
  const transaction = database.transaction(storeName, 'readonly');
  const done = transactionDone(transaction);
  const rows = await requestResult(transaction.objectStore(storeName).getAll());
  await done;
  return rows;
}

export class ProgressStore {
  async initialize() {
    const database = await openDatabase();
    const transaction = database.transaction('profile', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('profile');
    let profile = await requestResult(store.get('local'));
    if (!profile) {
      profile = {
        id: 'local',
        installationId: newId('install'),
        clientSeq: 0,
        displayName: '',
        experience: 'new',
        dailyMinutes: 10,
        onboardedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.put(profile);
    }
    await done;
    database.close();
    return profile;
  }

  async getProfile() {
    const database = await openDatabase();
    const transaction = database.transaction('profile', 'readonly');
    const done = transactionDone(transaction);
    const profile = await requestResult(transaction.objectStore('profile').get('local'));
    await done;
    database.close();
    return profile || this.initialize();
  }

  async updateProfile(changes) {
    const current = await this.getProfile();
    const profile = { ...current, ...changes, id: 'local', updatedAt: new Date().toISOString() };
    const database = await openDatabase();
    const transaction = database.transaction('profile', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('profile').put(profile);
    await done;
    database.close();
    return profile;
  }

  async nextClientSeq() {
    const current = await this.getProfile();
    const updated = await this.updateProfile({ clientSeq: Number(current.clientSeq || 0) + 1 });
    return updated.clientSeq;
  }

  async appendEvent(event, { queue = true } = {}) {
    const database = await openDatabase();
    const stores = queue ? ['learningEvents', 'outbox'] : ['learningEvents'];
    const transaction = database.transaction(stores, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('learningEvents').put(event);
    if (queue) transaction.objectStore('outbox').put({ ...event, queuedAt: new Date().toISOString() });
    await done;
    database.close();
    return event;
  }

  async appendEvents(events, options = {}) {
    if (!events.length) return 0;
    const queue = options.queue !== false;
    const database = await openDatabase();
    const stores = queue ? ['learningEvents', 'outbox'] : ['learningEvents'];
    const transaction = database.transaction(stores, 'readwrite');
    const done = transactionDone(transaction);
    const eventStore = transaction.objectStore('learningEvents');
    const outbox = queue ? transaction.objectStore('outbox') : null;
    for (const event of events) {
      eventStore.put(event);
      if (outbox) outbox.put({ ...event, queuedAt: new Date().toISOString() });
    }
    await done;
    database.close();
    return events.length;
  }

  async listEvents({ limit = Number.MAX_SAFE_INTEGER } = {}) {
    const database = await openDatabase();
    const rows = await allFromStore(database, 'learningEvents');
    database.close();
    return rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.clientSeq - b.clientSeq).slice(-limit);
  }

  async countOutbox() {
    const database = await openDatabase();
    const transaction = database.transaction('outbox', 'readonly');
    const done = transactionDone(transaction);
    const count = await requestResult(transaction.objectStore('outbox').count());
    await done;
    database.close();
    return count;
  }

  async peekOutbox(limit = 100) {
    const database = await openDatabase();
    const rows = await allFromStore(database, 'outbox');
    database.close();
    return rows.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)).slice(0, limit);
  }

  async acknowledgeOutbox(eventIds) {
    if (!eventIds.length) return;
    const database = await openDatabase();
    const transaction = database.transaction('outbox', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('outbox');
    eventIds.forEach((eventId) => store.delete(eventId));
    await done;
    database.close();
  }

  async saveProjection(projection) {
    const database = await openDatabase();
    const transaction = database.transaction(['masteryProjection', 'reviewQueue'], 'readwrite');
    const done = transactionDone(transaction);
    const mastery = transaction.objectStore('masteryProjection');
    const reviews = transaction.objectStore('reviewQueue');
    mastery.clear();
    reviews.clear();
    Object.values(projection.mastery || {}).forEach((row) => mastery.put(row));
    (projection.reviewQueue || []).forEach((row) => reviews.put(row));
    await done;
    database.close();
  }

  async getSyncState(key, fallback = null) {
    const database = await openDatabase();
    const transaction = database.transaction('syncState', 'readonly');
    const done = transactionDone(transaction);
    const row = await requestResult(transaction.objectStore('syncState').get(key));
    await done;
    database.close();
    return row?.value ?? fallback;
  }

  async setSyncState(key, value) {
    const database = await openDatabase();
    const transaction = database.transaction('syncState', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('syncState').put({ key, value, updatedAt: new Date().toISOString() });
    await done;
    database.close();
  }

  async saveSession(snapshot) {
    const database = await openDatabase();
    const transaction = database.transaction(['sessions', 'mistakes'], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('sessions').add({ ...snapshot, savedAt: new Date().toISOString() });
    const mistakes = transaction.objectStore('mistakes');
    for (const attempt of snapshot.attempts.filter((item) => item.outcome === 2)) {
      const key = `${snapshot.rootId}:${attempt.nodeId}:${attempt.move}`;
      mistakes.put({ key, rootId: snapshot.rootId, ...attempt, updatedAt: new Date().toISOString() });
    }
    await done;
    database.close();
  }

  async listSessions() {
    const database = await openDatabase();
    const result = await allFromStore(database, 'sessions');
    database.close();
    return result.sort((left, right) => right.id - left.id);
  }

  async exportData() {
    const database = await openDatabase();
    const [profile, events, sessions] = await Promise.all([
      allFromStore(database, 'profile'),
      allFromStore(database, 'learningEvents'),
      allFromStore(database, 'sessions'),
    ]);
    database.close();
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), profile: profile[0] || null, events, sessions };
  }
}
