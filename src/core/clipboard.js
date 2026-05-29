// src/core/clipboard.js

export class ClipboardManager {
  constructor() {
    this.hasPermission = false;
  }

  async checkPermission() {
    try {
      const status = await navigator.permissions.query({ name: 'clipboard-read' });
      this.hasPermission = status.state === 'granted';
      
      status.onchange = () => {
        this.hasPermission = status.state === 'granted';
      };
      
      return status.state;
    } catch (e) {
      console.warn("Clipboard permissions API not supported", e);
      return 'prompt';
    }
  }

  async readText() {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      console.error("Failed to read clipboard text", e);
      throw e;
    }
  }

  async writeText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.error("Failed to write clipboard text", e);
      throw e;
    }
  }

  async readImage() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('image/png')) {
          const blob = await item.getType('image/png');
          return blob;
        }
      }
      return null;
    } catch (e) {
      console.error("Failed to read clipboard image", e);
      throw e;
    }
  }

  async writeImage(blob) {
    try {
      const item = new ClipboardItem({ [blob.type || 'image/png']: blob });
      await navigator.clipboard.write([item]);
      return true;
    } catch (e) {
      console.error("Failed to write clipboard image", e);
      throw e;
    }
  }
}
