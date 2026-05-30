// src/core/storage.js

export class IndexedDBStorage {
  constructor(dbName = 'clipsync_db') {
    this.dbName = dbName;
    this.db = null;
    this.chunkIndex = 0;
    this._initPromise = null;
  }

  async init() {
    if (this.db) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 4);

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

        // Transfer state store for resume functionality
        if (!db.objectStoreNames.contains('transfer_state')) {
          db.createObjectStore('transfer_state', { keyPath: 'fileId' });
        }
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

  async getChunkCount() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chunks'], 'readonly');
      const store = transaction.objectStore('chunks');
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
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
        results.sort((a, b) => a.seq - b.seq);
        const buffers = results.map(item => item.data);
        const blob = new Blob(buffers, { type: mimeType });

        const clearTx = this.db.transaction(['chunks'], 'readwrite');
        clearTx.objectStore('chunks').clear();
        clearTx.oncomplete = () => {
          this.chunkIndex = 0;
          resolve(blob);
        };
        clearTx.onerror = () => {
          this.chunkIndex = 0;
          resolve(blob);
        };
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  // --- Transfer State Persistence for Resume ---

  async saveTransferState(fileId, metadata) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['transfer_state'], 'readwrite');
      const store = tx.objectStore('transfer_state');
      store.put({ fileId, ...metadata, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getTransferState(fileId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['transfer_state'], 'readonly');
      const store = tx.objectStore('transfer_state');
      const request = store.get(fileId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getIncompleteTransfer() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['transfer_state'], 'readonly');
      const store = tx.objectStore('transfer_state');
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result;
        // Return the most recent incomplete transfer, if any
        resolve(results.length > 0 ? results[results.length - 1] : null);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async clearTransferState(fileId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['transfer_state'], 'readwrite');
      const store = tx.objectStore('transfer_state');
      if (fileId) {
        store.delete(fileId);
      } else {
        store.clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
}
