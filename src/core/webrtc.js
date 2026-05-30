// src/core/webrtc.js
import { SignalingClient } from './signaling.js';
import { ICE_SERVERS } from '../utils/constants.js';

export class WebRTCManager {
  constructor(signalingUrl) {
    this.signaling = new SignalingClient(signalingUrl);
    this.pc = null;
    this.controlChannel = null;
    this.transferChannel = null;
    this.isHost = false;
    
    // Callbacks
    this.onConnectionStateChange = null;
    this.onControlMessage = null;
    this.onTransferMessage = null;
    this.onTransferBufferedAmountLow = null;
    this.onPubkeyReceived = null;
  }

  async init(roomCode, isHost) {
    this.isHost = isHost;
    await this.signaling.connect();

    this.signaling.on('peer_joined', () => {
      console.log('Peer joined! isHost:', isHost);
      // If WebRTC is already active, peer temporarily lost signaling and reconnected. Don't reset.
      if (this.pc && (this.pc.connectionState === 'connected' || this.pc.connectionState === 'connecting')) {
        console.warn('Ignoring peer_joined because WebRTC is already active.');
        return;
      }

      if (isHost) {
        // Host initiates the connection when peer joins
        this.createPeerConnection();
        this.createOffer();
      }
    });

    // FIX: Unwrap the relay message — the server sends { type: 'relay', payload: {...} }
    // We need to pass payload (the inner object), not the full message
    this.signaling.on('relay', async (msg) => {
      console.log('Relay received:', msg.payload?.type);
      await this.handleSignalingMessage(msg.payload);
    });
    
    this.signaling.on('peer_left', () => {
      console.log('Peer left');
      
      // If WebRTC is active, a signaling drop (like mobile backgrounding) shouldn't kill P2P immediately.
      if (this.pc && (this.pc.connectionState === 'connected' || this.pc.connectionState === 'connecting')) {
        console.warn('Ignoring peer_left because WebRTC is active. Trusting WebRTC state instead.');
        return;
      }

      this.close();
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('peer_left');
      }
    });

    this.signaling.on('error', (msg) => {
      console.error('Signaling error:', msg.message);
    });

    if (isHost) {
      this.signaling.createRoom(roomCode);
    } else {
      this.signaling.joinRoom(roomCode);
    }
  }

  createPeerConnection() {
    if (this.pc) return;

    console.log('Creating RTCPeerConnection...');
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate');
        this.signaling.relay({
          type: 'ice_candidate',
          candidate: event.candidate
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('Connection state:', this.pc.connectionState);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.pc.connectionState);
      }
    };

    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      console.log('Received data channel:', channel.label);
      if (channel.label === 'control') {
        this.setupControlChannel(channel);
      } else if (channel.label === 'transfer') {
        this.setupTransferChannel(channel);
      }
    };

    // If host, create channels
    if (this.isHost) {
      console.log('Creating data channels (host)');
      this.setupControlChannel(this.pc.createDataChannel('control', { ordered: true }));
      this.setupTransferChannel(this.pc.createDataChannel('transfer', { ordered: true }));
    }
  }

  setupControlChannel(channel) {
    this.controlChannel = channel;
    this.controlChannel.binaryType = 'arraybuffer';
    this.controlChannel.onopen = () => {
      console.log('Control channel open');
    };
    this.controlChannel.onmessage = (event) => {
      if (this.onControlMessage) {
        this.onControlMessage(event.data);
      }
    };
  }

  setupTransferChannel(channel) {
    this.transferChannel = channel;
    this.transferChannel.binaryType = 'arraybuffer';
    
    // For flow control
    this.transferChannel.bufferedAmountLowThreshold = 256 * 1024; // 256KB
    this.transferChannel.onopen = () => {
      console.log('Transfer channel open');
    };
    this.transferChannel.onbufferedamountlow = () => {
      if (this.onTransferBufferedAmountLow) {
        this.onTransferBufferedAmountLow();
      }
    };

    this.transferChannel.onmessage = (event) => {
      if (this.onTransferMessage) {
        this.onTransferMessage(event.data);
      }
    };
  }

  async handleSignalingMessage(payload) {
    if (!payload || !payload.type) {
      console.warn('Received invalid signaling payload:', payload);
      return;
    }

    if (payload.type === 'offer') {
      console.log('Received SDP offer');
      this.createPeerConnection();
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log('Sending SDP answer');
      this.signaling.relay({ type: 'answer', answer });
      
    } else if (payload.type === 'answer') {
      console.log('Received SDP answer');
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
      
    } else if (payload.type === 'ice_candidate') {
      if (this.pc) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) {
          console.error('Error adding ICE candidate', e);
        }
      }
      
    } else if (payload.type === 'pubkey') {
      console.log('Received peer public key');
      if (this.onPubkeyReceived) {
        this.onPubkeyReceived(payload.pubkey);
      }
    }
  }

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log('Sending SDP offer');
    this.signaling.relay({ type: 'offer', offer });
  }
  
  sendPubkey(pubkeyJwk) {
    console.log('Sending public key via signaling');
    this.signaling.relay({ type: 'pubkey', pubkey: pubkeyJwk });
  }

  sendControlMessage(dataBuffer) {
    if (this.controlChannel && this.controlChannel.readyState === 'open') {
      this.controlChannel.send(dataBuffer);
    } else {
      console.warn('Control channel not open. State:', this.controlChannel?.readyState);
    }
  }

  sendTransferMessage(dataBuffer) {
    if (this.transferChannel && this.transferChannel.readyState === 'open') {
      this.transferChannel.send(dataBuffer);
    }
  }

  getTransferBufferedAmount() {
    return this.transferChannel ? this.transferChannel.bufferedAmount : 0;
  }
  
  getTransferLowThreshold() {
    return this.transferChannel ? this.transferChannel.bufferedAmountLowThreshold : 0;
  }

  close() {
    if (this.controlChannel) this.controlChannel.close();
    if (this.transferChannel) this.transferChannel.close();
    if (this.pc) this.pc.close();
    this.signaling.disconnect();
    
    this.pc = null;
    this.controlChannel = null;
    this.transferChannel = null;
  }
}
