// server/index.js
import { WebSocketServer } from 'ws';
import roomManager from './room-manager.js';
import http from 'http';

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
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

  // Extract client IP once at connection time
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (messageAsString) => {
    try {
      const msg = JSON.parse(messageAsString);
      
      switch (msg.type) {
        case 'pong': {
          ws.isAlive = true;
          break;
        }
        case 'create_room': {
          const { code } = msg;
          if (!code || typeof code !== 'string') {
            return sendTo(ws, { type: 'error', message: 'Invalid room code' });
          }
          const created = roomManager.createRoom(code);
          if (created) {
            currentRoom = code;
            roomManager.joinRoom(code, ws);
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
            const others = roomManager.getOtherClients(code, ws);
            others.forEach(client => sendTo(client, { type: 'peer_joined' }));
            if (others.length > 0) {
              sendTo(ws, { type: 'peer_joined' });
            }
          } else {
            sendTo(ws, { type: 'error', message: result.error });
          }
          break;
        }
        
        case 'relay': {
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

        // ── Presence / Auto-Discovery messages ──────────────────────

        case 'register_presence': {
          const { clientId, deviceName } = msg;
          if (!clientId || typeof clientId !== 'string') {
            return sendTo(ws, { type: 'error', message: 'Invalid clientId' });
          }
          if (!deviceName || typeof deviceName !== 'string') {
            return sendTo(ws, { type: 'error', message: 'Invalid deviceName' });
          }

          roomManager.registerPresence(clientIp, ws, clientId, deviceName);
          console.log(`Presence registered: ${deviceName} (${clientId}) on IP ${clientIp}`);

          // Broadcast updated nearby list to every client on this IP
          broadcastNearbyUpdate(clientIp);
          break;
        }

        case 'get_nearby': {
          const devices = roomManager.getNearbyDevices(clientIp, ws);
          sendTo(ws, { type: 'nearby_list', devices });
          break;
        }

        case 'invite_peer': {
          const { targetClientId, roomCode } = msg;
          if (!targetClientId || !roomCode) {
            return sendTo(ws, { type: 'error', message: 'Missing targetClientId or roomCode' });
          }

          // Look up the sender's info so we can include fromClientId / fromDeviceName
          const senderInfo = roomManager.findPresenceByClientId(msg.fromClientId || '');
          // Also try to find by ws directly
          let fromClientId = null;
          let fromDeviceName = null;
          // Search all presence entries for this ws
          for (const [, group] of roomManager.presenceMap.entries()) {
            for (const entry of group) {
              if (entry.ws === ws) {
                fromClientId = entry.clientId;
                fromDeviceName = entry.deviceName;
                break;
              }
            }
            if (fromClientId) break;
          }

          const target = roomManager.findPresenceByClientId(targetClientId);
          if (!target) {
            return sendTo(ws, { type: 'error', message: 'Target device not found' });
          }

          sendTo(target.ws, {
            type: 'invite_received',
            fromClientId,
            fromDeviceName,
            roomCode
          });
          console.log(`Invite sent from ${fromClientId} to ${targetClientId} for room ${roomCode}`);
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
    // Clean up room membership
    const { removedFromCode } = roomManager.removeClient(disconnectedWs);
    if (removedFromCode) {
      const others = roomManager.getOtherClients(removedFromCode, disconnectedWs);
      others.forEach(client => sendTo(client, { type: 'peer_left' }));
    }

    // Clean up presence and notify remaining same-IP clients
    const presenceIp = roomManager.removePresence(disconnectedWs);
    if (presenceIp) {
      broadcastNearbyUpdate(presenceIp);
    }
  }
});

/**
 * Broadcast an updated nearby_list to every client registered under the given IP.
 */
function broadcastNearbyUpdate(ip) {
  const allWs = roomManager.getPresenceWsByIp(ip);
  for (const clientWs of allWs) {
    const devices = roomManager.getNearbyDevices(ip, clientWs);
    sendTo(clientWs, { type: 'nearby_update', devices });
  }
}

function sendTo(ws, data) {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {
      console.error('Error sending message:', e);
    }
  }
}

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('Terminating dead connection');
      const { removedFromCode } = roomManager.removeClient(ws);
      if (removedFromCode) {
        const others = roomManager.getOtherClients(removedFromCode, ws);
        others.forEach(client => sendTo(client, { type: 'peer_left' }));
      }
      // Also clean up presence for dead connections
      const presenceIp = roomManager.removePresence(ws);
      if (presenceIp) {
        broadcastNearbyUpdate(presenceIp);
      }
      return ws.terminate();
    }
    ws.isAlive = false;
    sendTo(ws, { type: 'ping' });
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
