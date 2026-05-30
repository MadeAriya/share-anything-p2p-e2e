// src/core/signaling.js

export class SignalingClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.listeners = new Map();
    this.reconnectTimeout = null;
    this.roomCode = null;
    this.isHost = false;
    this.clientId = crypto.randomUUID().slice(0, 8);
    this.deviceName = this._detectDeviceName();
  }

  _detectDeviceName() {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return 'Android Phone';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows PC';
    if (/Linux/i.test(ua)) return 'Linux PC';
    return 'Unknown Device';
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        resolve();
        return;
      }

      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('Signaling server connected');
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        // Register presence for auto-discovery
        this.send({ 
          type: 'register_presence', 
          clientId: this.clientId, 
          deviceName: this.deviceName 
        });
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ping') {
            this.send({ type: 'pong' });
            return;
          }
          this.emit(msg.type, msg);
        } catch (e) {
          console.error('Failed to parse signaling message', e);
        }
      };

      this.ws.onclose = () => {
        console.log('Signaling server disconnected');
        this.emit('disconnected');
        this.attemptReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('Signaling WebSocket error', err);
      };
    });
  }

  attemptReconnect() {
    if (this.roomCode) {
      this.reconnectTimeout = setTimeout(() => {
        console.log('Attempting to reconnect...');
        this.connect().then(() => {
          if (this.isHost) {
            this.send({ type: 'create_room', code: this.roomCode });
          } else {
            this.send({ type: 'join_room', code: this.roomCode });
          }
        });
      }, 3000);
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not open. Cannot send message:', data);
    }
  }

  createRoom(code) {
    this.roomCode = code;
    this.isHost = true;
    this.send({ type: 'create_room', code });
  }

  joinRoom(code) {
    this.roomCode = code;
    this.isHost = false;
    this.send({ type: 'join_room', code });
  }

  relay(payload) {
    this.send({ type: 'relay', payload });
  }

  // --- Auto-Discovery Methods ---
  requestNearby() {
    this.send({ type: 'get_nearby' });
  }

  invitePeer(targetClientId, roomCode) {
    this.send({ type: 'invite_peer', targetClientId, roomCode });
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event).filter(cb => cb !== callback);
      this.listeners.set(event, callbacks);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
  }

  disconnect() {
    this.roomCode = null;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
