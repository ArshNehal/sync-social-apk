import { Response } from 'express';

interface Client {
  userId: string;
  res: Response;
}

class EventManager {
  private clients: Map<string, Set<Response>> = new Map();

  addClient(userId: string, res: Response) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(res);

    // Keepalive ping every 25 seconds
    const interval = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch (e) {
        clearInterval(interval);
      }
    }, 25000);

    res.on('close', () => {
      clearInterval(interval);
      const userConns = this.clients.get(userId);
      if (userConns) {
        userConns.delete(res);
        if (userConns.size === 0) {
          this.clients.delete(userId);
        }
      }
    });
  }

  sendToUser(userId: string, event: string, data: any) {
    const userConns = this.clients.get(userId);
    if (!userConns) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of userConns) {
      try {
        res.write(payload);
      } catch (err) {
        // Connection dropped
      }
    }
  }

  broadcast(event: string, data: any) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, conns] of this.clients.entries()) {
      for (const res of conns) {
        try {
          res.write(payload);
        } catch (err) {
          // ignore
        }
      }
    }
  }
}

export const eventManager = new EventManager();
