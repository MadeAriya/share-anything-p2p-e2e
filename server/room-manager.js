// server/room-manager.js

class RoomManager {
  constructor() {
    // Map of roomCode -> { clients: Set<WebSocket>, createdAt: number }
    this.rooms = new Map();
    
    // Map of ip -> failed attempts (simple in-memory rate limiting)
    this.rateLimits = new Map();
    
    // Cleanup old rooms every minute
    setInterval(() => this.cleanupOldRooms(), 60 * 1000);
    // Cleanup rate limits every 15 minutes
    setInterval(() => this.rateLimits.clear(), 15 * 60 * 1000);
  }

  createRoom(code) {
    if (this.rooms.has(code)) {
      return false; // Room already exists
    }
    
    this.rooms.set(code, {
      clients: new Set(),
      createdAt: Date.now()
    });
    
    return true;
  }

  isRateLimited(ip) {
    if (!ip) return false;
    const attempts = this.rateLimits.get(ip) || 0;
    return attempts >= 5;
  }

  recordFailedAttempt(ip) {
    if (!ip) return;
    const attempts = this.rateLimits.get(ip) || 0;
    this.rateLimits.set(ip, attempts + 1);
  }

  joinRoom(code, ws, ip) {
    if (this.isRateLimited(ip)) {
      return { success: false, error: 'Too many failed attempts. Try again later.' };
    }

    const room = this.rooms.get(code);
    
    if (!room) {
      this.recordFailedAttempt(ip);
      return { success: false, error: 'Room not found' };
    }
    
    if (room.clients.size >= 2) {
      return { success: false, error: 'Room is full (max 2 participants)' };
    }
    
    room.clients.add(ws);

    // If room is now full, we can logically "destroy" the code for new joins
    // but we keep the room object alive for relaying between the 2 clients
    if (room.clients.size === 2) {
      room.locked = true;
    }

    return { success: true };
  }

  removeClient(ws) {
    let removedFromCode = null;
    let roomDestroyed = false;

    // Find the room the client is in
    for (const [code, room] of this.rooms.entries()) {
      if (room.clients.has(ws)) {
        room.clients.delete(ws);
        removedFromCode = code;
        
        // Destroy room if empty
        if (room.clients.size === 0) {
          this.rooms.delete(code);
          roomDestroyed = true;
        }
        break;
      }
    }

    return { removedFromCode, roomDestroyed };
  }

  getOtherClients(code, excludeWs) {
    const room = this.rooms.get(code);
    if (!room) return [];
    
    return Array.from(room.clients).filter(client => client !== excludeWs);
  }

  cleanupOldRooms() {
    const now = Date.now();
    // 1. Logika sesi sementara: 5 menit kedaluwarsa jika tidak ada yang bergabung
    const MAX_AGE_PENDING = 5 * 60 * 1000; 
    
    for (const [code, room] of this.rooms.entries()) {
      // If room has been pending for > 5 mins
      if (room.clients.size < 2 && (now - room.createdAt > MAX_AGE_PENDING)) {
        // Disconnect remaining clients
        for (const ws of room.clients) {
          try {
            ws.send(JSON.stringify({ type: 'error', message: 'Room expired' }));
            ws.close();
          } catch (e) {
            // Ignore error if already closed
          }
        }
        this.rooms.delete(code);
        console.log(`Garbage collected expired room: ${code}`);
      }
    }
  }
}

export default new RoomManager();
