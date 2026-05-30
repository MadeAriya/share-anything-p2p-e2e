// src/core/history.js

export class HistoryManager {
  constructor() {
    this.dbName = 'clipsync_history';
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to open IndexedDB: ${event.target.error}`));
      };
    });
  }

  async addEntry(type, content, direction) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('entries', 'readwrite');
      const store = transaction.objectStore('entries');

      const entry = {
        type,
        content,
        direction,
        timestamp: Date.now(),
      };

      const request = store.add(entry);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to add entry: ${event.target.error}`));
      };
    });
  }

  async getAll() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('entries', 'readonly');
      const store = transaction.objectStore('entries');
      const index = store.index('timestamp');

      const request = index.openCursor(null, 'next');
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to get entries: ${event.target.error}`));
      };
    });
  }

  async garbageCollect(ttlMs) {
    if (ttlMs === 0) {
      return this.clearAll();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('entries', 'readwrite');
      const store = transaction.objectStore('entries');
      const index = store.index('timestamp');
      const cutoff = Date.now() - ttlMs;

      const range = IDBKeyRange.upperBound(cutoff, false);
      const request = index.openCursor(range);
      let deletedCount = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to garbage collect: ${event.target.error}`));
      };
    });
  }

  async clearAll() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('entries', 'readwrite');
      const store = transaction.objectStore('entries');

      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to clear entries: ${event.target.error}`));
      };
    });
  }

  static getTTLOptions() {
    return [
      { label: 'Hapus Saat Keluar', value: 0 },
      { label: '1 Jam', value: 60 * 60 * 1000 },
      { label: '1 Hari', value: 24 * 60 * 60 * 1000 },
      { label: '7 Hari', value: 7 * 24 * 60 * 60 * 1000 },
    ];
  }

  static getSavedTTL() {
    const saved = localStorage.getItem('clipsync_history_ttl');
    return saved !== null ? parseInt(saved, 10) : 24 * 60 * 60 * 1000;
  }

  static saveTTL(ttlMs) {
    localStorage.setItem('clipsync_history_ttl', ttlMs.toString());
  }
}
