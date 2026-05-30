// src/core/file-transfer.js

import { IndexedDBStorage } from './storage.js';
import { inferMimeType } from '../utils/helpers.js';

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
    this.transferCompleteSignaled = false;
    this.storageReady = false;
    
    // Callbacks
    this.onProgress = null;
    this.onComplete = null;
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
      mime: inferMimeType(file.name, file.type),
    };
    
    const encryptedMeta = await this.crypto.encrypt(JSON.stringify(metadata));
    this.webrtc.sendControlMessage(encryptedMeta);
    
    this._sendNextChunk();
  }

  async _sendNextChunk() {
    if (!this.isSending || !this.sendFile) return;
    
    const maxThreshold = 1024 * 1024; // 1MB strict limit
    
    while (this.sendOffset < this.sendFile.size) {
      if (this.webrtc.getTransferBufferedAmount() > maxThreshold) {
        return; // Wait for bufferedAmountLow
      }
      
      const slice = this.sendFile.slice(this.sendOffset, this.sendOffset + this.CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      
      const encryptedChunk = await this.crypto.encrypt(buffer);
      this.webrtc.sendTransferMessage(encryptedChunk);
      
      this.sendOffset += buffer.byteLength;
      
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

  // --- Resume Sending (respond to peer's resume request) ---

  async handleResumeRequest(fileId, lastChunkIndex) {
    if (!this.sendFile || this.sendId !== fileId) {
      console.warn('Resume request for unknown file:', fileId);
      return;
    }

    // Calculate byte offset from chunk index
    const resumeFromByte = lastChunkIndex * this.CHUNK_SIZE;
    this.sendOffset = resumeFromByte;
    this.isSending = true;

    // Send resume acknowledgement
    const ack = {
      type: 'resume_ack',
      fileId,
      resumeFromChunk: lastChunkIndex
    };
    const encryptedAck = await this.crypto.encrypt(JSON.stringify(ack));
    this.webrtc.sendControlMessage(encryptedAck);

    console.log(`Resuming send from chunk ${lastChunkIndex} (byte ${resumeFromByte})`);
    this._sendNextChunk();
  }

  // --- RECEIVING ---

  async handleControlMessage(parsedMeta) {
    if (parsedMeta.type === 'file_start') {
      // Sanitize filename
      let sanitizedName = parsedMeta.name.replace(/^.*[\\\/]/, '').replace(/[^a-zA-Z0-9.\-_ ()]/g, '');
      if (!sanitizedName) sanitizedName = 'unnamed_file';
      
      this.receiveId = parsedMeta.id;
      this.receiveMetadata = { ...parsedMeta, name: sanitizedName };
      this.receiveSize = 0;
      this.transferCompleteSignaled = false;
      this.storageReady = false;
      
      try {
        await this.storage.init();
        await this.storage.clear();
        // Save transfer state for potential resume
        await this.storage.saveTransferState(parsedMeta.id, {
          name: sanitizedName,
          size: parsedMeta.size,
          mime: parsedMeta.mime,
          status: 'receiving'
        });
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
        this._tryAssemble();
      }

    } else if (parsedMeta.type === 'resume_ack') {
      // Sender acknowledged our resume request — chunks will start flowing again
      console.log(`Resume acknowledged, receiving from chunk ${parsedMeta.resumeFromChunk}`);
    }
  }

  async handleTransferMessage(encryptedChunkBuffer) {
    if (!this.receiveId) return;
    
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

      if (this.transferCompleteSignaled) {
        this._tryAssemble();
      }
    } catch (e) {
      console.error("Failed to decrypt incoming file chunk", e);
      if (this.onError) this.onError(e);
    }
  }

  _tryAssemble() {
    if (!this.transferCompleteSignaled) return;
    if (!this.receiveMetadata) return;
    if (this.receiveSize < this.receiveMetadata.size) return;
    
    this._assembleFile();
  }

  async _assembleFile() {
    try {
      const blob = await this.storage.assembleBlob(this.receiveMetadata.mime);
      // Clear transfer state on successful assembly
      await this.storage.clearTransferState(this.receiveId);
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

  // --- Resume Request (called when reconnecting as receiver) ---

  async checkForIncompleteTransfer() {
    try {
      await this.storage.init();
      const state = await this.storage.getIncompleteTransfer();
      if (state && state.status === 'receiving') {
        const chunkCount = await this.storage.getChunkCount();
        if (chunkCount > 0) {
          return { fileId: state.fileId, lastChunkIndex: chunkCount, metadata: state };
        }
      }
    } catch (e) {
      console.error("Error checking incomplete transfer:", e);
    }
    return null;
  }

  async sendResumeRequest(fileId, lastChunkIndex) {
    const msg = {
      type: 'resume_request',
      fileId,
      lastChunkIndex
    };
    const encrypted = await this.crypto.encrypt(JSON.stringify(msg));
    this.webrtc.sendControlMessage(encrypted);
    console.log(`Sent resume request for file ${fileId} from chunk ${lastChunkIndex}`);
  }
}
