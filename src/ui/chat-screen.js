// src/ui/chat-screen.js
import { formatBytes } from '../utils/helpers.js';
import { toast } from './toast.js';

export class ChatScreen {
  constructor(app) {
    this.app = app;
    this.element = document.createElement('div');
    this.element.className = 'screen chat-screen';
    this.render();
    this.setupDragAndDrop();
  }

  render() {
    this.element.innerHTML = `
      <div class="chat-container">
        <div class="info-bar">
          <div class="status-indicator">
            <div class="status-dot connected"></div>
            <span>Connected to Peer</span>
          </div>
          <button id="btn-disconnect" class="btn">Disconnect</button>
        </div>
        
        <div class="history-area" id="history-area">
          <div style="text-align: center; color: var(--text-secondary); opacity: 0.5; margin-top: auto; margin-bottom: auto;">
            Connection established. Messages and files are end-to-end encrypted.
          </div>
        </div>
        
        <div class="quick-actions">
          <button id="btn-paste" class="btn quick-btn" title="Send clipboard contents">
            📋 Clipboard
          </button>
          <button id="btn-file" class="btn quick-btn" title="Send a file">
            📎 File
          </button>
          <input type="file" id="file-input" style="display: none;" />
        </div>

        <div class="input-bar">
          <input type="text" id="text-input" class="text-input" placeholder="Type a message..." autocomplete="off" />
          <button id="btn-send" class="btn btn-primary send-btn" title="Send message">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    this.element.querySelector('#btn-disconnect').addEventListener('click', () => {
      this.app.disconnect();
    });

    // --- Text input ---
    const textInput = this.element.querySelector('#text-input');
    const btnSend = this.element.querySelector('#btn-send');

    const sendTextFromInput = () => {
      const text = textInput.value.trim();
      if (text) {
        this.app.sendText(text);
        this.addMessageToHistory(text, 'sent');
        textInput.value = '';
      }
    };

    btnSend.addEventListener('click', sendTextFromInput);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTextFromInput();
      }
    });

    // --- Clipboard button ---
    const btnPaste = this.element.querySelector('#btn-paste');
    btnPaste.addEventListener('click', async () => {
      try {
        const text = await this.app.clipboard.readText();
        if (text) {
          this.app.sendText(text);
          this.addMessageToHistory(text, 'sent');
        } else {
          toast.info("Clipboard is empty.");
        }
      } catch (e) {
        toast.error("Failed to read clipboard. Check permissions.");
      }
    });

    // --- File button ---
    const btnFile = this.element.querySelector('#btn-file');
    const fileInput = this.element.querySelector('#file-input');
    
    btnFile.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.app.sendFile(e.target.files[0]);
      }
      e.target.value = '';
    });

    // --- Global Ctrl+V paste (only when text input is NOT focused) ---
    document.addEventListener('paste', this.handleGlobalPaste.bind(this));
  }

  handleGlobalPaste(e) {
    if (!this.element.classList.contains('active')) return;
    
    // Ignore global paste if user is typing in the input field
    if (document.activeElement === this.element.querySelector('#text-input')) return;
    
    const items = e.clipboardData.items;
    let fileFound = false;
    
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          this.app.sendFile(file);
          fileFound = true;
          break;
        }
      }
    }
    
    if (!fileFound) {
      const text = e.clipboardData.getData('text');
      if (text) {
        this.app.sendText(text);
        this.addMessageToHistory(text, 'sent');
      }
    }
  }

  setupDragAndDrop() {
    const preventDefaults = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    let dragCounter = 0;

    document.body.addEventListener('dragenter', (e) => {
      if (!this.element.classList.contains('active')) return;
      dragCounter++;
      document.body.classList.add('drag-over');
    }, false);

    document.body.addEventListener('dragleave', (e) => {
      if (!this.element.classList.contains('active')) return;
      dragCounter--;
      if (dragCounter === 0) {
        document.body.classList.remove('drag-over');
      }
    }, false);

    document.body.addEventListener('drop', (e) => {
      if (!this.element.classList.contains('active')) return;
      dragCounter = 0;
      document.body.classList.remove('drag-over');
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.app.sendFile(files[0]);
      }
    }, false);
  }

  addMessageToHistory(text, type = 'received') {
    const historyArea = this.element.querySelector('#history-area');
    
    // Remove empty state message if exists
    const emptyState = historyArea.querySelector('div[style*="text-align: center"]');
    if (emptyState) emptyState.remove();

    const msgEl = document.createElement('div');
    msgEl.className = `message ${type}`;
    
    // Escape HTML to prevent XSS
    const escapedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    msgEl.innerHTML = `
      <div class="message-content">${escapedText}</div>
      <div class="message-meta">
        <span>${new Date().toLocaleTimeString()}</span>
        ${type === 'received' ? '<span style="cursor:pointer; text-decoration:underline;" class="copy-trigger">Copy</span>' : ''}
      </div>
    `;

    if (type === 'received') {
      msgEl.querySelector('.copy-trigger').addEventListener('click', () => {
        this.app.clipboard.writeText(text)
          .then(() => toast.success("Copied to clipboard"))
          .catch(() => toast.error("Failed to copy"));
      });
    }

    historyArea.appendChild(msgEl);
    this.scrollToBottom();
  }

  createFileTransferElement(fileMeta, type = 'sending') {
    const historyArea = this.element.querySelector('#history-area');
    const emptyState = historyArea.querySelector('div[style*="text-align: center"]');
    if (emptyState) emptyState.remove();

    const id = `file-${Date.now()}`;
    const el = document.createElement('div');
    el.className = `file-item`;
    el.id = id;
    
    el.innerHTML = `
      <div class="file-icon">📄</div>
      <div class="file-details">
        <div class="file-name" title="${fileMeta.name}">${fileMeta.name}</div>
        <div class="file-size">${formatBytes(fileMeta.size)} • ${type === 'sending' ? 'Sending...' : 'Receiving...'} <span id="${id}-percent">0%</span></div>
        <div class="progress-container">
          <div class="progress-bar" id="${id}-progress"></div>
        </div>
        <div id="${id}-actions" class="file-actions" style="margin-top: 0.5rem; display: none;"></div>
      </div>
    `;
    
    historyArea.appendChild(el);
    this.scrollToBottom();
    
    const actionsContainer = document.getElementById(`${id}-actions`);
    let accepted = false;

    return {
      updateProgress: (percent) => {
        const progressEl = document.getElementById(`${id}-progress`);
        const percentEl = document.getElementById(`${id}-percent`);
        if (progressEl && percentEl) {
          progressEl.style.width = `${percent}%`;
          percentEl.textContent = `${percent}%`;
        }
      },
      complete: (blob = null) => {
        const progressContainer = el.querySelector('.progress-container');
        const percentEl = document.getElementById(`${id}-percent`);
        if (progressContainer) progressContainer.remove();
        
        if (type === 'sending') {
          percentEl.textContent = 'Sent ✅';
        } else if (blob) {
          percentEl.textContent = 'Ready to Assemble ⏳';
          
          // Show accept button before assembly
          actionsContainer.style.display = 'block';
          
          const acceptBtn = document.createElement('button');
          acceptBtn.className = 'btn btn-primary';
          acceptBtn.style.padding = '0.5rem';
          acceptBtn.textContent = 'Accept & Assemble File';
          
          acceptBtn.addEventListener('click', () => {
            if (accepted) return;
            accepted = true;
            acceptBtn.remove();
            percentEl.textContent = 'Received ✅';
            
            // Add download button
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn';
            downloadBtn.style.padding = '0.5rem';
            downloadBtn.textContent = 'Download File';
            
            const url = URL.createObjectURL(blob);
            downloadBtn.addEventListener('click', () => {
              const a = document.createElement('a');
              a.href = url;
              a.download = fileMeta.name;
              a.click();
            });
            
            actionsContainer.appendChild(downloadBtn);
            
            // If image, show preview
            if (fileMeta.mime.startsWith('image/')) {
              const img = document.createElement('img');
              img.src = url;
              img.style.maxWidth = '100%';
              img.style.maxHeight = '200px';
              img.style.borderRadius = '8px';
              img.style.marginTop = '0.5rem';
              img.style.display = 'block';
              actionsContainer.appendChild(img);
            }
          });
          
          actionsContainer.appendChild(acceptBtn);
        }
      }
    };
  }

  scrollToBottom() {
    const historyArea = this.element.querySelector('#history-area');
    historyArea.scrollTop = historyArea.scrollHeight;
  }
}
