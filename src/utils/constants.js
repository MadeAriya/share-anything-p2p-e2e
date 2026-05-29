// src/utils/constants.js

// Determine signaling URL based on environment
// For local dev with Vite proxy, use /ws
// For production, use current host (assuming deployed on same domain) or hardcoded
const IS_DEV = import.meta.env.DEV;
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
export const SIGNALING_URL = IS_DEV 
  ? `ws://localhost:3001`
  : `${WS_PROTOCOL}//${window.location.host}`;

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:3478' },
  // Open Relay TURN server fallback for Symmetric NAT / Strict Firewalls
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

export const EVENTS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  TEXT_RECEIVED: 'text_received',
  FILE_PROGRESS: 'file_progress',
  FILE_RECEIVED: 'file_received',
  ERROR: 'error'
};
