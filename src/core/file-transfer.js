// src/core/file-transfer.js

import { IndexedDBStorage } from './storage.js';

export class FileTransferManager {
  constructor(webrtcManager, cryptoManager) {
    this.webrtc = webrtcManager;
    this.crypto = cryptoManager;
    this.storage = new IndexedDBStorage();
    this.CHUNK_SIZE = 64 * 1024; // 64KB
    
    // Send state
    this.sendFile = null;
    this.sendOffset = 0;
    this.sendId = null;
    this.isSending = false;
    
    // Receive state
    this.receiveId = null;
    this.receiveMetadata = null;
    this.receiveSize = 0;
    this.transferCompleteSignaled = false; // Flag: sender said "done"
    this.storageReady = false; // Flag: IndexedDB is initialized
    
    // Callbacks
    this.onProgress = null; // (percentage, isReceiving, metadata)
    this.onComplete = null; // (blob, metadata)
    this.onError = null;
  }

  // --- SENDING ---

  async startSending(file) {
    if (this.isSending) throw new Error("Already sending a file");
    
    this.isSending = true;
    this.sendFile = file;
    this.sendOffset = 0;
    this.sendId = crypto.randomUUID();
    
    const metadata = {
      type: 'file_start',
      id: this.sendId,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    };
    
    // Send metadata over control channel
    const encryptedMeta = await this.crypto.encrypt(JSON.stringify(metadata));
    this.webrtc.sendControlMessage(encryptedMeta);
    
    // Start sending chunks
    this._sendNextChunk();
  }

  async _sendNextChunk() {
    if (!this.isSending || !this.sendFile) return;
    
    // Flow control: strictly wait if buffer is too full
    const maxThreshold = 1024 * 1024; // 1MB strict limit
    
    while (this.sendOffset < this.sendFile.size) {
      if (this.webrtc.getTransferBufferedAmount() > maxThreshold) {
        // Stop sending, wait for bufferedAmountLow event to resume
        return;
      }
      
      const slice = this.sendFile.slice(this.sendOffset, this.sendOffset + this.CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      
      // Encrypt chunk
      const encryptedChunk = await this.crypto.encrypt(buffer);
      
      this.webrtc.sendTransferMessage(encryptedChunk);
      
      this.sendOffset += buffer.byteLength;
      
      // Progress event
      if (this.onProgress) {
        const percent = Math.min(100, Math.round((this.sendOffset / this.sendFile.size) * 100));
        this.onProgress(percent, false, { name: this.sendFile.name, size: this.sendFile.size });
      }
      
      if (this.sendOffset >= this.sendFile.size) {
        this._finishSending();
        break;
      }
    }
  }
  
  // Call this when transfer channel bufferedAmountLow event fires
  handleBufferedAmountLow() {
    if (this.isSending) {
      this._sendNextChunk();
    }
  }

  async _finishSending() {
    const metadata = {
      type: 'file_complete',
      id: this.sendId
    };
    const encryptedMeta = await this.crypto.encrypt(JSON.stringify(metadata));
    this.webrtc.sendControlMessage(encryptedMeta);
    
    this.isSending = false;
    this.sendFile = null;
    
    if (this.onComplete) {
      this.onComplete(null, { type: 'sent' });
    }
  }

  // --- RECEIVING ---

  async handleControlMessage(parsedMeta) {
    if (parsedMeta.type === 'file_start') {
      // Sanitize filename to prevent path traversal
      let sanitizedName = parsedMeta.name.replace(/^.*[\\\/]/, '').replace(/[^a-zA-Z0-9.\-_ ()]/g, '');
      if (!sanitizedName) sanitizedName = 'unnamed_file';
      
      this.receiveId = parsedMeta.id;
      this.receiveMetadata = { ...parsedMeta, name: sanitizedName };
      this.receiveSize = 0;
      this.transferCompleteSignaled = false;
      this.storageReady = false;
      
      // Initialize IndexedDB and clear stale data BEFORE accepting chunks
      try {
        await this.storage.init();
        await this.storage.clear();
        this.storageReady = true;
      } catch (e) {
        console.error("Failed to init IndexedDB:", e);
      }
      
      if (this.onProgress) {
        this.onProgress(0, true, this.receiveMetadata);
      }
      
    } else if (parsedMeta.type === 'file_complete') {
      if (parsedMeta.id === this.receiveId) {
        this.transferCompleteSignaled = true;
        // Only assemble if ALL bytes have been received
        this._tryAssemble();
      }
    }
  }

  async handleTransferMessage(encryptedChunkBuffer) {
    if (!this.receiveId) return; // Not expecting a file
    
    // Wait for storage to be ready if it hasn't finished initializing yet
    if (!this.storageReady) {
      try {
        await this.storage.init();
        this.storageReady = true;
      } catch (e) {
        console.error("Storage not ready, dropping chunk:", e);
        return;
      }
    }
    
    try {
      const decryptedBuffer = await this.crypto.decrypt(encryptedChunkBuffer);
      await this.storage.storeChunk(decryptedBuffer);
      this.receiveSize += decryptedBuffer.byteLength;
      
      if (this.onProgress && this.receiveMetadata) {
        const percent = Math.min(100, Math.round((this.receiveSize / this.receiveMetadata.size) * 100));
        this.onProgress(percent, true, this.receiveMetadata);
      }

      // If the sender already signaled "complete" and we now have all bytes, assemble
      if (this.transferCompleteSignaled) {
        this._tryAssemble();
      }
    } catch (e) {
      console.error("Failed to decrypt incoming file chunk", e);
      if (this.onError) this.onError(e);
    }
  }

  _tryAssemble() {
    // Only assemble when we have received ALL expected bytes
    if (!this.transferCompleteSignaled) return;
    if (!this.receiveMetadata) return;
    if (this.receiveSize < this.receiveMetadata.size) return;
    
    this._assembleFile();
  }

  async _assembleFile() {
    try {
      const blob = await this.storage.assembleBlob(this.receiveMetadata.mime);
      if (this.onComplete) {
        this.onComplete(blob, this.receiveMetadata);
      }
    } catch (e) {
      if (this.onError) this.onError(e);
    } finally {
      this.receiveId = null;
      this.receiveMetadata = null;
      this.receiveSize = 0;
      this.transferCompleteSignaled = false;
      this.storageReady = false;
    }
  }
}
