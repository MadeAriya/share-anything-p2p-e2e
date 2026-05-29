// server/index.js
import { WebSocketServer } from 'ws';
import roomManager from './room-manager.js';
import http from 'http';

const PORT = process.env.PORT || 3001;

// Create HTTP server (required for some platforms like Render/Koyeb)
const server = http.createServer((req, res) => {
  // Simple health check endpoint
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ClipSync Signaling Server' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log('New client connected');
  let currentRoom = null;

  // Setup ping-pong to detect stale connections
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (messageAsString) => {
    try {
      const msg = JSON.parse(messageAsString);
      
      switch (msg.type) {
        case 'create_room': {
          const { code } = msg;
          if (!code || typeof code !== 'string') {
            return sendTo(ws, { type: 'error', message: 'Invalid room code' });
          }
          
          const created = roomManager.createRoom(code);
          if (created) {
            currentRoom = code;
            roomManager.joinRoom(code, ws); // Auto join as creator
            sendTo(ws, { type: 'room_created', code });
            console.log(`Room created: ${code}`);
          } else {
            sendTo(ws, { type: 'error', message: 'Room already exists' });
          }
          break;
        }
        
        case 'join_room': {
          const { code } = msg;
          if (!code || typeof code !== 'string') {
            return sendTo(ws, { type: 'error', message: 'Invalid room code' });
          }
          
          const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
          const result = roomManager.joinRoom(code, ws, ip);
          if (result.success) {
            currentRoom = code;
            console.log(`Client joined room: ${code}`);
            
            // Notify the other peer
            const others = roomManager.getOtherClients(code, ws);
            others.forEach(client => sendTo(client, { type: 'peer_joined' }));
            
            // Also notify the joining client if someone is already there
            if (others.length > 0) {
              sendTo(ws, { type: 'peer_joined' });
            }
          } else {
            sendTo(ws, { type: 'error', message: result.error });
          }
          break;
        }
        
        case 'relay': {
          // Blind relay: Forward payload to other clients in the room
          // The server does not inspect the payload content (SDP, ICE, PubKeys)
          if (!currentRoom) {
            return sendTo(ws, { type: 'error', message: 'Not in a room' });
          }
          
          const others = roomManager.getOtherClients(currentRoom, ws);
          others.forEach(client => sendTo(client, { 
            type: 'relay', 
            payload: msg.payload 
          }));
          break;
        }
        
        default:
          console.warn(`Unknown message type: ${msg.type}. Raw:`, messageAsString.toString());
      }
    } catch (e) {
      console.error('Failed to parse message:', e);
      sendTo(ws, { type: 'error', message: 'Invalid JSON message' });
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    handleDisconnect(ws);
  });

  function handleDisconnect(disconnectedWs) {
    const { removedFromCode } = roomManager.removeClient(disconnectedWs);
    
    if (removedFromCode) {
      // Notify remaining peer that they are alone now
      const others = roomManager.getOtherClients(removedFromCode, disconnectedWs);
      others.forEach(client => sendTo(client, { type: 'peer_left' }));
    }
  }
});

// Helper to send messages safely
function sendTo(ws, data) {
  if (ws.readyState === 1 /* OPEN */) {
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {
      console.error('Error sending message:', e);
    }
  }
}

// Heartbeat interval to clean up dead connections
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('Terminating dead connection');
      const { removedFromCode } = roomManager.removeClient(ws);
      if (removedFromCode) {
        const others = roomManager.getOtherClients(removedFromCode, ws);
        others.forEach(client => sendTo(client, { type: 'peer_left' }));
      }
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
