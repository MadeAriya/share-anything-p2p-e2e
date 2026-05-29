// src/ui/room-screen.js
import { generateRoomCode } from '../utils/helpers.js';

export class RoomScreen {
  constructor(app) {
    this.app = app;
    this.element = document.createElement('div');
    this.element.className = 'screen room-screen';
    this.render();
  }

  render() {
    this.element.innerHTML = `
      <div class="room-content">
        <h1 class="room-title">Share Anything. <br/> <span class="text-gradient">Securely.</span></h1>
        <p class="room-subtitle">Create a room to share clipboard text and files instantly across devices. End-to-end encrypted.</p>
        
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
      this.render(); // Reset UI
    });
  }

  showConnectingState() {
    const status = this.element.querySelector('#connection-status');
    status.style.display = 'flex';
    status.querySelector('span').textContent = 'Establishing P2P connection...';
    
    // Disable inputs
    this.element.querySelector('#input-code').disabled = true;
    this.element.querySelector('#btn-join').disabled = true;
    this.element.querySelector('#btn-create').disabled = true;
  }
}
