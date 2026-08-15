const DB_NAME = 'othello-balance-dojo';
const DB_VERSION = 1;

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
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class ProgressStore {
  async saveSession(snapshot) {
    const database = await openDatabase();
    const transaction = database.transaction(['sessions', 'mistakes'], 'readwrite');
    const sessions = transaction.objectStore('sessions');
    await requestResult(sessions.add({ ...snapshot, savedAt: new Date().toISOString() }));
    const mistakes = transaction.objectStore('mistakes');
    for (const attempt of snapshot.attempts.filter((item) => item.outcome === 2)) {
      const key = `${snapshot.rootId}:${attempt.nodeId}:${attempt.move}`;
      await requestResult(mistakes.put({ key, rootId: snapshot.rootId, ...attempt, updatedAt: new Date().toISOString() }));
    }
    database.close();
  }

  async listSessions() {
    const database = await openDatabase();
    const result = await requestResult(database.transaction('sessions').objectStore('sessions').getAll());
    database.close();
    return result.sort((left, right) => right.id - left.id);
  }
}
