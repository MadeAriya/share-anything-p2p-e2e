// src/ui/app.js
import { RoomScreen } from './room-screen.js';
import { ChatScreen } from './chat-screen.js';
import { SettingsScreen } from './settings-screen.js';
import { WebRTCManager } from '../core/webrtc.js';
import { E2EEManager } from '../core/crypto.js';
import { ClipboardManager } from '../core/clipboard.js';
import { FileTransferManager } from '../core/file-transfer.js';
import { HistoryManager } from '../core/history.js';
import { SignalingClient } from '../core/signaling.js';
import { SIGNALING_URL } from '../utils/constants.js';
import { generateRoomCode, inferMimeType } from '../utils/helpers.js';
import { toast } from './toast.js';

export class App {
  constructor() {
    this.container = document.getElementById('app');
    this.screens = {
      room: new RoomScreen(this),
      chat: new ChatScreen(this)
    };
    this.settings = new SettingsScreen(this);
    document.body.appendChild(this.settings.element);
    
    this.clipboard = new ClipboardManager();
    this.webrtc = null;
    this.crypto = null;
    this.fileTransfer = null;
    this.history = new HistoryManager();
    
    // Discovery signaling (persistent connection for nearby devices)
    this.discoverySignaling = null;
    
    this.activeTransferUI = null;
    this.pendingShares = []; // Files/text from PWA share target

    this.showScreen('room');
    this.clipboard.checkPermission();
    this._initHistory();
    this._initDiscovery();
    this._checkPendingShares();
    this._setupSettingsButton();
    this._setupGlobalDragAndDrop();
  }

  async _initHistory() {
    try {
      await this.history.init();
      const ttl = HistoryManager.getSavedTTL();
      if (ttl === 0) {
        await this.history.clearAll();
      } else {
        await this.history.garbageCollect(ttl);
      }
    } catch (e) {
      console.error('Failed to init history:', e);
    }
  }

  async _initDiscovery() {
    try {
      this.discoverySignaling = new SignalingClient(SIGNALING_URL);
      await this.discoverySignaling.connect();
      
      this.discoverySignaling.on('nearby_update', (msg) => {
        this.screens.room.updateNearbyDevices(msg.devices);
      });

      this.discoverySignaling.on('nearby_list', (msg) => {
        this.screens.room.updateNearbyDevices(msg.devices);
      });

      this.discoverySignaling.on('invite_received', (msg) => {
        toast.info(`${msg.fromDeviceName} wants to connect!`);
        // Auto-accept: Wait 500ms for Host to create room, then join
        setTimeout(() => {
          if (this.discoverySignaling) {
            this.discoverySignaling.disconnect();
            this.discoverySignaling = null;
          }
          this.joinRoom(msg.roomCode);
        }, 500);
      });

      // Request nearby devices
      this.discoverySignaling.requestNearby();
    } catch (e) {
      console.error('Discovery init failed:', e);
    }
  }

  _setupSettingsButton() {
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this.settings.toggle());
    }
  }

  async _checkPendingShares() {
    try {
      const request = indexedDB.open('clipsync_shares', 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('pending_shares')) {
          db.createObjectStore('pending_shares', { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction('pending_shares', 'readwrite');
        const store = tx.objectStore('pending_shares');
        const getAll = store.getAll();

        getAll.onsuccess = () => {
          const shares = getAll.result;
          if (shares.length > 0) {
            this.pendingShares = shares;
            store.clear();
            toast.info(`📎 ${shares.length} shared item(s) ready to send. Connect to a peer first!`);
          }
        };
        tx.oncomplete = () => db.close();
      };
    } catch (e) {
      console.error('Error checking pending shares:', e);
    }
  }

  _setupGlobalDragAndDrop() {
    const preventDefaults = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    let dragCounter = 0;

    document.body.addEventListener('dragenter', (e) => {
      dragCounter++;
      document.body.classList.add('global-drag-over');
    }, false);

    document.body.addEventListener('dragleave', (e) => {
      dragCounter--;
      if (dragCounter === 0) {
        document.body.classList.remove('global-drag-over');
      }
    }, false);

    document.body.addEventListener('drop', async (e) => {
      dragCounter = 0;
      document.body.classList.remove('global-drag-over');
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (this.webrtc && this.crypto && this.crypto.sharedKey) {
          this.sendFile(file);
        } else {
          // Not connected, queue the file
          const buffer = await file.arrayBuffer();
          this.pendingShares.push({
            type: 'file',
            name: file.name,
            mime: inferMimeType(file.name, file.type),
            size: file.size,
            data: buffer,
            timestamp: Date.now()
          });
          toast.info(`📎 File queued. It will be sent once you connect.`);
        }
      }
    }, false);
  }

  showScreen(name) {
    Object.values(this.screens).forEach(screen => {
      screen.element.classList.remove('active');
    });
    
    if (!this.container.contains(this.screens[name].element)) {
      this.container.appendChild(this.screens[name].element);
    }
    
    requestAnimationFrame(() => {
      this.screens[name].element.classList.add('active');
    });

    const connectionBadge = document.getElementById('connection-badge');
    if (name === 'chat') {
      connectionBadge.style.display = 'flex';
    } else {
      connectionBadge.style.display = 'none';
    }
  }

  async initConnection(roomCode, isHost) {
    // Disconnect discovery signaling to free the WS connection
    if (this.discoverySignaling) {
      this.discoverySignaling.disconnect();
      this.discoverySignaling = null;
    }

    this.webrtc = new WebRTCManager(SIGNALING_URL);
    this.crypto = new E2EEManager();
    
    await this.crypto.generateKeyPair();
    
    this.fileTransfer = new FileTransferManager(this.webrtc, this.crypto);

    this.webrtc.onConnectionStateChange = (state) => this.handleConnectionState(state);
    
    this.webrtc.onPubkeyReceived = async (peerPubkey) => {
      console.log('Deriving shared E2EE key...');
      try {
        await this.crypto.deriveSharedKey(peerPubkey);
        console.log('E2EE key derived successfully!');
        toast.success("🔒 End-to-End Encryption Established");
        this.showScreen('chat');
        this._sendPendingShares();
        
        // --- Resume Transfer Check ---
        const incomplete = await this.fileTransfer.checkForIncompleteTransfer();
        if (incomplete) {
          toast.info(`Resuming transfer for ${incomplete.metadata.name}...`);
          this.fileTransfer.sendResumeRequest(incomplete.fileId, incomplete.lastChunkIndex);
        }
      } catch (e) {
        console.error('Failed to derive shared key:', e);
        toast.error("Failed to establish encryption.");
      }
    };

    this.webrtc.onControlMessage = async (data) => {
      try {
        const decryptedStr = await this.crypto.decryptToString(data);
        const parsed = JSON.parse(decryptedStr);
        
        if (parsed.type === 'text') {
          this.screens.chat.addMessageToHistory(parsed.content, 'received');
          this.history.addEntry('text', parsed.content, 'received').catch(() => {});
        } else if (parsed.type === 'file_start' || parsed.type === 'file_complete' || parsed.type === 'resume_ack') {
          await this.fileTransfer.handleControlMessage(parsed);
        } else if (parsed.type === 'resume_request') {
          this.fileTransfer.handleResumeRequest(parsed.fileId, parsed.lastChunkIndex);
        }
      } catch (e) {
        console.error("Failed to decrypt control message:", e);
      }
    };

    this.webrtc.onTransferMessage = async (data) => {
      await this.fileTransfer.handleTransferMessage(data);
    };

    this.webrtc.onTransferBufferedAmountLow = () => {
      this.fileTransfer.handleBufferedAmountLow();
    };
    
    this.fileTransfer.onProgress = (percent, isReceiving, metadata) => {
      if (!this.activeTransferUI) {
        this.activeTransferUI = this.screens.chat.createFileTransferElement(
          metadata, 
          isReceiving ? 'receiving' : 'sending'
        );
      }
      this.activeTransferUI.updateProgress(percent);
    };
    
    this.fileTransfer.onComplete = (blob, metadata) => {
      if (this.activeTransferUI) {
        this.activeTransferUI.complete(blob);
        this.activeTransferUI = null;
      }
      if (metadata && metadata.name) {
        this.history.addEntry('file', metadata.name, metadata.type === 'sent' ? 'sent' : 'received').catch(() => {});
      }
    };
    
    this.fileTransfer.onError = (e) => {
      toast.error("File transfer failed");
      this.activeTransferUI = null;
    };

    await this.webrtc.init(roomCode, isHost);
  }

  handleConnectionState(state) {
    console.log('P2P Connection State:', state);
    if (state === 'connected') {
      toast.info("P2P connected! Exchanging encryption keys...");
      this.crypto.exportPublicKey().then(pubkey => {
        this.webrtc.sendPubkey(pubkey);
      });
    } else if (state === 'failed') {
      toast.error("Peer connection failed.");
      this.disconnect();
    } else if (state === 'peer_left') {
      toast.error("Peer disconnected.");
      this.disconnect();
    }
  }

  connectToNearbyDevice(device) {
    const code = generateRoomCode();
    // Tell the discovery signaling to invite the peer
    if (this.discoverySignaling) {
      this.discoverySignaling.invitePeer(device.clientId, code);
    }
    // Give it a tiny delay to ensure the invite_peer message is flushed before closing socket
    setTimeout(() => {
      this.createRoom(code);
    }, 150);
  }

  createRoom(code) {
    this.initConnection(code, true);
  }

  joinRoom(code) {
    this.initConnection(code, false);
  }

  disconnect() {
    if (this.webrtc) {
      this.webrtc.close();
      this.webrtc = null;
    }
    this.showScreen('room');
    this.screens.room.render();
    // Re-init discovery for nearby devices
    this._initDiscovery();
  }

  async sendText(text) {
    if (!this.webrtc || !this.crypto.sharedKey) {
      toast.error("Not connected or encryption not established.");
      return;
    }
    try {
      const msg = { type: 'text', content: text };
      const encrypted = await this.crypto.encrypt(JSON.stringify(msg));
      this.webrtc.sendControlMessage(encrypted);
      this.history.addEntry('text', text, 'sent').catch(() => {});
    } catch (e) {
      console.error("Error sending text:", e);
      toast.error("Failed to send text.");
    }
  }
  
  async sendFile(file) {
    if (!this.webrtc || !this.crypto.sharedKey) {
      toast.error("Not connected or encryption not established.");
      return;
    }
    try {
      await this.fileTransfer.startSending(file);
    } catch (e) {
      console.error("Error starting file transfer:", e);
      toast.error("Failed to send file.");
    }
  }

  async _sendPendingShares() {
    if (this.pendingShares.length === 0) return;
    
    for (const share of this.pendingShares) {
      if (share.type === 'text') {
        this.sendText(share.content);
        this.screens.chat.addMessageToHistory(share.content, 'sent');
      } else if (share.type === 'file') {
        const file = new File([share.data], share.name, { type: share.mime });
        await this.sendFile(file);
      }
    }
    this.pendingShares = [];
    toast.success("Shared items sent!");
  }
}
