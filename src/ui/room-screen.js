// src/ui/room-screen.js
import { generateRoomCode } from '../utils/helpers.js';

export class RoomScreen {
  constructor(app) {
    this.app = app;
    this.element = document.createElement('div');
    this.element.className = 'screen room-screen';
    this.nearbyDevices = [];
    this.render();
  }

  render() {
    this.element.innerHTML = `
      <div class="room-content">
        <h1 class="room-title">Share Anything. <br/> <span class="text-gradient">Securely.</span></h1>
        <p class="room-subtitle">Create a room to share clipboard text and files instantly across devices. End-to-end encrypted.</p>
        
        <div id="nearby-section" class="nearby-section" style="display: none;">
          <div class="nearby-header">
            <span class="nearby-pulse"></span>
            <span>Perangkat Ditemukan di Sekitar Anda</span>
          </div>
          <div id="nearby-list" class="nearby-list"></div>
        </div>

        <div class="room-actions">
          <button id="btn-create" class="btn btn-primary" style="width: 100%; padding: 1rem; font-size: 1.1rem;">
            <span>Create New Room</span>
          </button>
          
          <div class="divider"><span>OR JOIN</span></div>
          
          <div class="code-input-group">
            <input type="text" id="input-code" class="code-input" placeholder="000000" maxlength="6" autocomplete="off" />
          </div>
          <button id="btn-join" class="btn" style="width: 100%; padding: 1rem; font-size: 1.1rem;">
            <span>Join Room</span>
          </button>
        </div>
        
        <div id="connection-status" class="connection-status" style="display: none;">
          <div class="spinner"></div>
          <span>Connecting to signaling server...</span>
        </div>
      </div>

      <section class="seo-info-container">
        <div class="seo-overview text-center">
          <h2>What is Clip Sync?</h2>
          <p>Clip Sync is a lightning-fast, cross-device peer-to-peer (P2P) utility that transfers text and files in real-time.</p>
        </div>

        <div class="seo-grid features-grid">
          <div class="seo-card">
            <div class="seo-icon">🎯</div>
            <h3>Simple Interface</h3>
            <p>No complex menus or logins. Just enter a 6-digit room code to start transferring instantly.</p>
          </div>
          <div class="seo-card">
            <div class="seo-icon">🚀</div>
            <h3>No File Size Limits</h3>
            <p>Because it's P2P, you can send files as large as you want without server restrictions or artificial caps.</p>
          </div>
          <div class="seo-card">
            <div class="seo-icon">🔄</div>
            <h3>Resume Transfer</h3>
            <p>Utilizes IndexedDB to safely pause and automatically resume file transfers if your connection drops.</p>
          </div>
          <div class="seo-card">
            <div class="seo-icon">🕒</div>
            <h3>Local History</h3>
            <p>Your copy-paste history is securely stored in your local browser with customizable retention times.</p>
          </div>
        </div>

        <div class="seo-grid info-grid">
          <div class="seo-card">
            <h3>How does it work?</h3>
            <p>Enter a Room Code to pair your devices. Clip Sync establishes a direct WebRTC bridge between them. If you are on the same Wi-Fi, your data flows instantly over your local network without ever touching the internet.</p>
          </div>
          <div class="seo-card">
            <h3>Privacy & Security</h3>
            <p>Your data is 100% End-to-End Encrypted (E2EE). We enforce a zero-knowledge architecture—we do not have database servers to store your files or clipboard data. What happens on your device stays on your device.</p>
          </div>
          <div class="seo-card">
            <h3>Browser Compatibility</h3>
            <p>Clip Sync runs seamlessly on modern browsers including Chrome, Firefox, Safari, and Edge that support WebRTC and the File System Access API.</p>
          </div>
          <div class="seo-card">
            <h3>Quick Access / App Integration</h3>
            <p>Add Clip Sync to your Homescreen (PWA) for instant access. Once installed, you can share files directly to Clip Sync using your phone's native "Share" menu!</p>
          </div>
        </div>
      </section>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const btnCreate = this.element.querySelector('#btn-create');
    const btnJoin = this.element.querySelector('#btn-join');
    const inputCode = this.element.querySelector('#input-code');

    btnCreate.addEventListener('click', () => {
      const code = generateRoomCode();
      this.app.createRoom(code);
      this.showWaitingState(code);
    });

    btnJoin.addEventListener('click', () => {
      const code = inputCode.value.trim().toUpperCase();
      if (code.length === 6) {
        this.app.joinRoom(code);
        this.showConnectingState();
      } else {
        import('./toast.js').then(({ toast }) => {
          toast.error('Please enter a valid 6-character room code.');
        });
      }
    });

    inputCode.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
      if (e.target.value.length === 6) {
        btnJoin.classList.add('btn-primary');
      } else {
        btnJoin.classList.remove('btn-primary');
      }
    });

    inputCode.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        btnJoin.click();
      }
    });
  }

  updateNearbyDevices(devices) {
    this.nearbyDevices = devices || [];
    const section = this.element.querySelector('#nearby-section');
    const list = this.element.querySelector('#nearby-list');
    
    if (!section || !list) return;

    if (this.nearbyDevices.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    list.innerHTML = '';

    this.nearbyDevices.forEach(device => {
      const card = document.createElement('div');
      card.className = 'nearby-device-card';
      
      const icon = this._getDeviceIcon(device.deviceName);
      card.innerHTML = `
        <div class="nearby-device-icon">${icon}</div>
        <div class="nearby-device-info">
          <div class="nearby-device-name">${device.deviceName}</div>
          <div class="nearby-device-id">ID: ${device.clientId}</div>
        </div>
        <button class="btn btn-primary nearby-connect-btn">Connect</button>
      `;

      card.querySelector('.nearby-connect-btn').addEventListener('click', () => {
        this.app.connectToNearbyDevice(device);
      });

      list.appendChild(card);
    });
  }

  _getDeviceIcon(name) {
    if (/Android/i.test(name)) return '📱';
    if (/iPhone|iPad/i.test(name)) return '📱';
    if (/Mac/i.test(name)) return '💻';
    if (/Windows/i.test(name)) return '🖥️';
    if (/Linux/i.test(name)) return '🐧';
    return '📟';
  }

  showWaitingState(code) {
    const content = this.element.querySelector('.room-actions');
    content.innerHTML = `
      <div class="code-display">
        <h3>Room Code</h3>
        <div class="code-text" id="display-code">${code}</div>
        <button id="btn-copy-code" class="btn" style="margin-top: 1rem; width: 100%;">
          Copy Code
        </button>
      </div>
      <div class="connection-status">
        <div class="spinner"></div>
        <span>Waiting for peer to join...</span>
      </div>
      <button id="btn-cancel" class="btn" style="margin-top: 2rem;">Cancel</button>
    `;

    this.element.querySelector('#btn-copy-code').addEventListener('click', () => {
      navigator.clipboard.writeText(code).then(() => {
        import('./toast.js').then(({ toast }) => {
          toast.success('Room code copied to clipboard!');
        });
      });
    });

    this.element.querySelector('#btn-cancel').addEventListener('click', () => {
      this.app.disconnect();
      this.render();
    });
  }

  showConnectingState() {
    const status = this.element.querySelector('#connection-status');
    status.style.display = 'flex';
    status.querySelector('span').textContent = 'Establishing P2P connection...';
    
    this.element.querySelector('#input-code').disabled = true;
    this.element.querySelector('#btn-join').disabled = true;
    this.element.querySelector('#btn-create').disabled = true;
  }
}
