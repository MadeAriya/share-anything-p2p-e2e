// src/core/storage.js

export class IndexedDBStorage {
  constructor(dbName = 'clipsync_db') {
    this.dbName = dbName;
    this.db = null;
    this.chunkIndex = 0;
    this._initPromise = null; // Singleton init to prevent race conditions
  }

  async init() {
    // If already initialized, return immediately
    if (this.db) return;
    // If init is in progress, wait for it (prevents parallel init calls)
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 3);

      request.onerror = (event) => {
        console.error("IndexedDB error:", event.target.error);
        this._initPromise = null;
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (db.objectStoreNames.contains('chunks')) {
          db.deleteObjectStore('chunks');
        }
        db.createObjectStore('chunks', { keyPath: 'seq' });
      };
    });

    return this._initPromise;
  }

  async clear() {
    if (!this.db) await this.init();
    this.chunkIndex = 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chunks'], 'readwrite');
      const store = transaction.objectStore('chunks');
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async storeChunk(chunkBuffer) {
    if (!this.db) await this.init();

    const seq = this.chunkIndex++;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chunks'], 'readwrite');
      const store = transaction.objectStore('chunks');
      const request = store.add({ seq, data: chunkBuffer });

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async assembleBlob(mimeType) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chunks'], 'readonly');
      const store = transaction.objectStore('chunks');
      const request = store.getAll();

      request.onsuccess = (event) => {
        const results = event.target.result;
        // Sort by sequence number to guarantee correct byte order
        results.sort((a, b) => a.seq - b.seq);
        const buffers = results.map(item => item.data);
        const blob = new Blob(buffers, { type: mimeType });

        // Clear after assembly in a separate transaction
        const clearTx = this.db.transaction(['chunks'], 'readwrite');
        clearTx.objectStore('chunks').clear();
        clearTx.oncomplete = () => {
          this.chunkIndex = 0;
          resolve(blob);
        };
        clearTx.onerror = () => {
          this.chunkIndex = 0;
          resolve(blob); // still return blob even if clear fails
        };
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }
}
