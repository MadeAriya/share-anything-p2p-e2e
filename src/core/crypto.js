// src/core/crypto.js

export class E2EEManager {
  constructor() {
    this.keyPair = null;
    this.sharedKey = null;
  }

  // 1. Generate local ECDH key pair
  async generateKeyPair() {
    this.keyPair = await window.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey"]
    );
    return this.keyPair;
  }

  // 2. Export public key to send via signaling
  async exportPublicKey() {
    if (!this.keyPair) await this.generateKeyPair();
    return await window.crypto.subtle.exportKey("jwk", this.keyPair.publicKey);
  }

  // 3. Import peer's public key and derive shared AES-GCM secret
  async deriveSharedKey(peerPublicKeyJwk) {
    if (!this.keyPair) throw new Error("Local key pair not generated");

    const peerPublicKey = await window.crypto.subtle.importKey(
      "jwk",
      peerPublicKeyJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );

    this.sharedKey = await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPublicKey },
      this.keyPair.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    return this.sharedKey;
  }

  // 4. Encrypt data (returns ArrayBuffer [IV 12 bytes] + [Ciphertext])
  async encrypt(data) {
    if (!this.sharedKey) throw new Error("Shared key not derived yet");

    // data can be string or ArrayBuffer
    let dataBuffer;
    if (typeof data === 'string') {
      dataBuffer = new TextEncoder().encode(data);
    } else {
      dataBuffer = data;
    }

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.sharedKey,
      dataBuffer
    );

    // Combine IV and ciphertext for transmission
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return combined.buffer;
  }

  // 5. Decrypt data (expects ArrayBuffer [IV 12 bytes] + [Ciphertext])
  async decrypt(dataBuffer) {
    if (!this.sharedKey) throw new Error("Shared key not derived yet");

    const combined = new Uint8Array(dataBuffer);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintext = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      this.sharedKey,
      ciphertext
    );

    return plaintext;
  }
  
  // Helper to decrypt to string
  async decryptToString(dataBuffer) {
    const plaintext = await this.decrypt(dataBuffer);
    return new TextDecoder().decode(plaintext);
  }
}
