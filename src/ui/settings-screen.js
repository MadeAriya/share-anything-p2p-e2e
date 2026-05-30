// src/ui/settings-screen.js
import { HistoryManager } from '../core/history.js';
import { toast } from './toast.js';

export class SettingsScreen {
  constructor(app) {
    this.app = app;
    this.element = document.createElement('div');
    this.element.className = 'settings-overlay';
    this.element.style.display = 'none';
    this.render();
  }

  render() {
    const ttlOptions = HistoryManager.getTTLOptions();
    const savedTTL = HistoryManager.getSavedTTL();

    const optionsHTML = ttlOptions
      .map(
        (opt) =>
          `<option value="${opt.value}" ${opt.value === savedTTL ? 'selected' : ''}>${opt.label}</option>`
      )
      .join('');

    this.element.innerHTML = `
      <div class="settings-modal">
        <div class="settings-header">
          <h2 class="settings-title">Pengaturan/Settings</h2>
          <button class="settings-close-btn" aria-label="Close settings">&times;</button>
        </div>

        <div class="settings-body">
          <div class="settings-section">
            <label class="settings-label">Durasi Retensi Riwayat</label>
            <p class="settings-description">Pilih berapa lama Anda ingin menyimpan riwayat papan klip.</p>
            <select class="settings-select" id="settings-ttl-select">
              ${optionsHTML}
            </select>
          </div>

          <div class="settings-section">
            <label class="settings-label">Manajemen Data</label>
            <p class="settings-description">Hapus semua entri riwayat yang tersimpan secara permanen.</p>
            <button class="settings-btn-danger" id="settings-clear-btn">
              Hapus Semua Riwayat
            </button>
          </div>
        </div>

        <div class="settings-footer">
          <span class="settings-version">ClipSync v2.0</span>
        </div>
      </div>
    `;

    // Close button
    const closeBtn = this.element.querySelector('.settings-close-btn');
    closeBtn.addEventListener('click', () => this.hide());

    // Click overlay backdrop to close
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.hide();
      }
    });

    // TTL dropdown change
    const ttlSelect = this.element.querySelector('#settings-ttl-select');
    ttlSelect.addEventListener('change', (e) => {
      const ttlMs = parseInt(e.target.value, 10);
      HistoryManager.saveTTL(ttlMs);
      const selected = ttlOptions.find((opt) => opt.value === ttlMs);
      toast(`History retention set to "${selected ? selected.label : 'Unknown'}"`);
    });

    // Clear all history button
    const clearBtn = this.element.querySelector('#settings-clear-btn');
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear all history? This cannot be undone.')) {
        return;
      }

      try {
        if (this.app && this.app.history) {
          await this.app.history.clearAll();
        } else {
          const historyManager = new HistoryManager();
          await historyManager.init();
          await historyManager.clearAll();
        }
        toast('All history cleared');
      } catch (err) {
        console.error('Failed to clear history:', err);
        toast('Failed to clear history');
      }
    });
  }

  show() {
    this.element.style.display = 'flex';
  }

  hide() {
    this.element.style.display = 'none';
  }

  toggle() {
    this.element.style.display === 'none' ? this.show() : this.hide();
  }
}
