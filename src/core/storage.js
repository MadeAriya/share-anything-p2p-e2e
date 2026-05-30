// src/core/storage.js

export class IndexedDBStorage {
  constructor(dbName = 'clipsync_db') {
    this.dbName = dbName;
    this.db = null;
    this.chunkIndex = 0; // Track insertion order explicitly
  }

  async init() {
    // Reset chunk counter for each new file transfer
    this.chunkIndex = 0;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 2);

      request.onerror = (event) => {
        console.error("IndexedDB error:", event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        // Delete old store if exists (schema upgrade)
        if (db.objectStoreNames.contains('chunks')) {
          db.deleteObjectStore('chunks');
        }
        // Create store with explicit sequential key for ordering
        db.createObjectStore('chunks', { keyPath: 'seq' });
      };
    });
  }

  async storeChunk(chunkBuffer) {
    if (!this.db) await this.init();

    const seq = this.chunkIndex++;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chunks'], 'readwrite');
      const store = transaction.objectStore('chunks');
      // Store with explicit sequence number to guarantee retrieval order
      const request = store.add({ seq, data: chunkBuffer });

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllChunksAndClear() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      // First transaction: read all chunks in key order (sorted by 'seq')
      const readTx = this.db.transaction(['chunks'], 'readonly');
      const readStore = readTx.objectStore('chunks');
      const request = readStore.getAll();

      request.onsuccess = (event) => {
        // Sort by sequence number to guarantee correct order
        const results = event.target.result;
        results.sort((a, b) => a.seq - b.seq);
        const chunks = results.map(item => item.data);

        // Second transaction: clear the store after successful read
        const clearTx = this.db.transaction(['chunks'], 'readwrite');
        const clearStore = clearTx.objectStore('chunks');
        clearStore.clear();

        clearTx.oncomplete = () => {
          this.chunkIndex = 0;
          resolve(chunks);
        };
        clearTx.onerror = () => {
          // Even if clear fails, still return chunks so user gets their file
          this.chunkIndex = 0;
          resolve(chunks);
        };
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }
}
