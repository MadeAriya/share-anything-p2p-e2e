# ClipSync - P2P Encrypted Clipboard & File Transfer

ClipSync is a cross-device clipboard sync utility with real-time P2P transfer, end-to-end encryption, and a zero-knowledge architecture. No accounts, no servers storing data, no installation required.

## Features
- **True P2P**: Uses WebRTC DataChannels. The signaling server is only used for the initial handshake.
- **End-to-End Encryption (E2EE)**: ECDH P-256 Key Exchange and AES-256-GCM Payload Encryption via the Web Crypto API.
- **Zero-Knowledge Backend**: The backend is a blind WebSocket relay. It cannot read your data.
- **File Transfer**: Supports large files using a 64KB chunking strategy and DataChannel backpressure management.
- **PWA Ready**: Can be installed on desktop and mobile.

## Development

```bash
# Install dependencies
npm install

# Start both the frontend (Vite) and signaling server (Node/ws) concurrently
npm run dev:all
```

The frontend will run on `http://localhost:5173` and the signaling server on `ws://localhost:3001`. Vite is configured to proxy `/ws` to the backend automatically.

## 100% Free Deployment Architecture

To host this project completely for free:

1. **Frontend**: Deploy the Vite app to **Vercel**, **Netlify**, or **Cloudflare Pages**.
2. **Signaling Server**: 
   - Deploy the `server/` directory as a Web Service on **Render** (Free Tier - spins down after inactivity) or **Koyeb** (Free Tier - 1 nano service, better uptime).
   - *Note: On Render/Koyeb, you will receive a public HTTPS/WSS URL (e.g., `wss://clipsync-backend.onrender.com`). You will need to update `src/utils/constants.js` to point to this URL instead of dynamically using `window.location.host`.*
3. **TURN Server**: 
   - Direct P2P (STUN) will work for ~80-90% of connections. 
   - For the remaining connections (Symmetric NAT), sign up for the **Metered.ca Free Tier** (500MB/month) and insert their credentials into `src/utils/constants.js` `ICE_SERVERS`.

## Security Considerations
The signaling server relies on ephemeral rooms. Rooms are automatically destroyed when all participants disconnect, or garbage collected after 30 minutes. Keys are generated fresh for every connection and never stored.
