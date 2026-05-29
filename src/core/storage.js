// src/core/storage.js

export class IndexedDBStorage {
  constructor(dbName = 'clipsync_db') {
    this.dbName = dbName;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

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
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  async storeChunk(chunkBuffer) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chunks'], 'readwrite');
      const store = transaction.objectStore('chunks');
      const request = store.add({ data: chunkBuffer });

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllChunksAndClear() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chunks'], 'readwrite');
      const store = transaction.objectStore('chunks');
      const request = store.getAll();
      const chunks = [];

      request.onsuccess = (event) => {
        event.target.result.forEach(item => chunks.push(item.data));
        store.clear(); // Clean up after retrieving
        resolve(chunks);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }
}
