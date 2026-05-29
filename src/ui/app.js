// src/ui/app.js
import { RoomScreen } from './room-screen.js';
import { ChatScreen } from './chat-screen.js';
import { WebRTCManager } from '../core/webrtc.js';
import { E2EEManager } from '../core/crypto.js';
import { ClipboardManager } from '../core/clipboard.js';
import { FileTransferManager } from '../core/file-transfer.js';
import { SIGNALING_URL } from '../utils/constants.js';
import { toast } from './toast.js';

export class App {
  constructor() {
    this.container = document.getElementById('app');
    this.screens = {
      room: new RoomScreen(this),
      chat: new ChatScreen(this)
    };
    
    this.clipboard = new ClipboardManager();
    this.webrtc = null;
    this.crypto = null;
    this.fileTransfer = null;
    
    this.activeTransferUI = null;

    this.showScreen('room');
    this.clipboard.checkPermission();
  }

  showScreen(name) {
    Object.values(this.screens).forEach(screen => {
      screen.element.classList.remove('active');
    });
    
    if (!this.container.contains(this.screens[name].element)) {
      this.container.appendChild(this.screens[name].element);
    }
    
    // Slight delay for animation
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
    this.webrtc = new WebRTCManager(SIGNALING_URL);
    this.crypto = new E2EEManager();
    
    await this.crypto.generateKeyPair();
    
    this.fileTransfer = new FileTransferManager(this.webrtc, this.crypto);

    // --- Wire up WebRTC events ---

    // Connection state changes
    this.webrtc.onConnectionStateChange = (state) => this.handleConnectionState(state);
    
    // Public key received from peer (via signaling relay, unencrypted)
    this.webrtc.onPubkeyReceived = async (peerPubkey) => {
      console.log('Deriving shared E2EE key...');
      try {
        await this.crypto.deriveSharedKey(peerPubkey);
        console.log('E2EE key derived successfully!');
        toast.success("🔒 End-to-End Encryption Established");
        this.showScreen('chat');
      } catch (e) {
        console.error('Failed to derive shared key:', e);
        toast.error("Failed to establish encryption.");
      }
    };

    // Encrypted control messages received via DataChannel
    this.webrtc.onControlMessage = async (data) => {
      try {
        const decryptedStr = await this.crypto.decryptToString(data);
        const parsed = JSON.parse(decryptedStr);
        
        if (parsed.type === 'text') {
          this.screens.chat.addMessageToHistory(parsed.content, 'received');
        } else if (parsed.type === 'file_start' || parsed.type === 'file_complete') {
          this.fileTransfer.handleControlMessage(parsed);
        }
      } catch (e) {
        console.error("Failed to decrypt control message:", e);
      }
    };

    // Encrypted file chunks received via DataChannel
    this.webrtc.onTransferMessage = async (data) => {
      await this.fileTransfer.handleTransferMessage(data);
    };

    // Flow control for file sending
    this.webrtc.onTransferBufferedAmountLow = () => {
      this.fileTransfer.handleBufferedAmountLow();
    };
    
    // --- Wire up file transfer UI callbacks ---
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
    };
    
    this.fileTransfer.onError = (e) => {
      toast.error("File transfer failed");
      this.activeTransferUI = null;
    };

    // --- Start the connection ---
    await this.webrtc.init(roomCode, isHost);
  }

  handleConnectionState(state) {
    console.log('P2P Connection State:', state);
    if (state === 'connected') {
      // WebRTC P2P link is up. Now exchange public keys for E2EE.
      toast.info("P2P connected! Exchanging encryption keys...");
      this.crypto.exportPublicKey().then(pubkey => {
        this.webrtc.sendPubkey(pubkey);
      });
    } else if (state === 'disconnected' || state === 'failed') {
      toast.error("Peer disconnected.");
      this.disconnect();
    }
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
    this.screens.room.render(); // Reset UI state
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
}
