// server/room-manager.js

class RoomManager {
  constructor() {
    // Map of roomCode -> { clients: Set<WebSocket>, createdAt: number }
    this.rooms = new Map();
    
    // Map of ip -> failed attempts (simple in-memory rate limiting)
    this.rateLimits = new Map();

    // Map of ip -> Set<{ws, clientId, deviceName}> for local WiFi presence
    this.presenceMap = new Map();
    
    // Cleanup old rooms every minute
    setInterval(() => this.cleanupOldRooms(), 60 * 1000);
    // Cleanup rate limits every 15 minutes
    setInterval(() => this.rateLimits.clear(), 15 * 60 * 1000);
  }

  createRoom(code) {
    if (this.rooms.has(code)) {
      return false;
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
    if (room.clients.size === 2) {
      room.locked = true;
    }
    return { success: true };
  }

  removeClient(ws) {
    let removedFromCode = null;
    let roomDestroyed = false;
    for (const [code, room] of this.rooms.entries()) {
      if (room.clients.has(ws)) {
        room.clients.delete(ws);
        removedFromCode = code;
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
    const MAX_AGE_PENDING = 5 * 60 * 1000;
    for (const [code, room] of this.rooms.entries()) {
      if (room.clients.size < 2 && (now - room.createdAt > MAX_AGE_PENDING)) {
        for (const ws of room.clients) {
          try {
            ws.send(JSON.stringify({ type: 'error', message: 'Room expired' }));
            ws.close();
          } catch (e) {}
        }
        this.rooms.delete(code);
        console.log(`Garbage collected expired room: ${code}`);
      }
    }
  }

  // ── Presence Tracking (WiFi Auto-Discovery) ──────────────────────────

  /**
   * Register a client's presence under its public IP.
   * Returns the list of OTHER nearby devices on the same IP.
   */
  registerPresence(ip, ws, clientId, deviceName) {
    if (!this.presenceMap.has(ip)) {
      this.presenceMap.set(ip, new Set());
    }

    const group = this.presenceMap.get(ip);

    // Remove any stale entry for the same ws (re-register scenario)
    for (const entry of group) {
      if (entry.ws === ws) {
        group.delete(entry);
        break;
      }
    }

    group.add({ ws, clientId, deviceName });

    return this.getNearbyDevices(ip, ws);
  }

  /**
   * Remove a client from the presence map.
   * Returns the IP the client was registered under (or null).
   */
  removePresence(ws) {
    for (const [ip, group] of this.presenceMap.entries()) {
      for (const entry of group) {
        if (entry.ws === ws) {
          group.delete(entry);
          if (group.size === 0) {
            this.presenceMap.delete(ip);
          }
          return ip;
        }
      }
    }
    return null;
  }

  /**
   * Get all nearby devices sharing the same IP, excluding the caller's ws.
   * Returns an array of { clientId, deviceName }.
   */
  getNearbyDevices(ip, excludeWs) {
    const group = this.presenceMap.get(ip);
    if (!group) return [];

    const devices = [];
    for (const entry of group) {
      if (entry.ws !== excludeWs) {
        devices.push({ clientId: entry.clientId, deviceName: entry.deviceName });
      }
    }
    return devices;
  }

  /**
   * Find the WebSocket for a given clientId across all IP groups.
   * Returns { ws, ip, deviceName } or null.
   */
  findPresenceByClientId(clientId) {
    for (const [ip, group] of this.presenceMap.entries()) {
      for (const entry of group) {
        if (entry.clientId === clientId) {
          return { ws: entry.ws, ip, deviceName: entry.deviceName };
        }
      }
    }
    return null;
  }

  /**
   * Get all WebSockets registered under a given IP.
   */
  getPresenceWsByIp(ip) {
    const group = this.presenceMap.get(ip);
    if (!group) return [];
    return Array.from(group).map(e => e.ws);
  }
}

export default new RoomManager();
