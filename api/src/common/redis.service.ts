import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private isConnected = false;
  private memoryStore = new Map<string, any>();

  async onModuleInit() {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            // Only retry 3 times, then stop to keep the terminal clean
            if (retries > 3) {
              return false; // stop retrying
            }
            return 1000; // retry after 1s
          }
        }
      }) as RedisClientType;

      this.client.on('error', (err) => {
        // Suppress errors during connection attempts
      });

      // Wrap connect in a 5s timeout to prevent hanging startup
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 5000))
      ]);

      this.isConnected = true;
      console.log('Redis connected successfully');
    } catch (error: any) {
      this.isConnected = false;
      console.warn('Redis connection failed (timeout or error). Falling back to in-memory store.');
    }
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      await this.client.disconnect();
      console.log('Redis disconnected');
    }
  }

  // Session state management
  async setSessionState(sessionId: string, state: any): Promise<void> {
    if (this.isConnected) {
      await this.client.set(`session:${sessionId}`, JSON.stringify(state), {
        EX: 3600,
      });
    } else {
      this.memoryStore.set(`session:${sessionId}`, state);
    }
  }

  async getSessionState(sessionId: string): Promise<any> {
    if (this.isConnected) {
      const state = await this.client.get(`session:${sessionId}`);
      return state ? JSON.parse(state as string) : null;
    }
    return this.memoryStore.get(`session:${sessionId}`) || null;
  }

  async deleteSessionState(sessionId: string): Promise<void> {
    if (this.isConnected) {
      await this.client.del(`session:${sessionId}`);
    } else {
      this.memoryStore.delete(`session:${sessionId}`);
    }
  }

  // User presence management
  async setUserOnline(userId: string, sessionId: string): Promise<void> {
    if (this.isConnected) {
      await this.client.set(`user:${userId}:online`, sessionId, {
        EX: 300,
      });
    } else {
      this.memoryStore.set(`user:${userId}:online`, sessionId);
    }
  }

  async setUserOffline(userId: string): Promise<void> {
    if (this.isConnected) {
      await this.client.del(`user:${userId}:online`);
    } else {
      this.memoryStore.delete(`user:${userId}:online`);
    }
  }

  async isUserOnline(userId: string): Promise<boolean> {
    if (this.isConnected) {
      const result = await this.client.get(`user:${userId}:online`);
      return result !== null;
    }
    return this.memoryStore.has(`user:${userId}:online`);
  }

  // Real-time collaboration metrics
  async incrementMetric(sessionId: string, metric: string, value: number = 1): Promise<void> {
    const key = `session:${sessionId}:metric:${metric}`;
    if (this.isConnected) {
      for (let i = 0; i < value; i++) {
        await this.client.incr(key);
      }
    } else {
      const current = this.memoryStore.get(key) || 0;
      this.memoryStore.set(key, current + value);
    }
  }

  async getMetric(sessionId: string, metric: string): Promise<number> {
    const key = `session:${sessionId}:metric:${metric}`;
    if (this.isConnected) {
      const result = await this.client.get(key);
      return result ? parseInt(result as string, 10) : 0;
    }
    return this.memoryStore.get(key) || 0;
  }

  // Intervention cooldown management
  async setInterventionCooldown(sessionId: string, interventionType: string): Promise<void> {
    const key = `session:${sessionId}:intervention:${interventionType}`;
    if (this.isConnected) {
      await this.client.set(key, '1', { EX: 300 });
    } else {
      this.memoryStore.set(key, '1');
      setTimeout(() => this.memoryStore.delete(key), 300000); // 5 mins
    }
  }

  async canShowIntervention(sessionId: string, interventionType: string): Promise<boolean> {
    const key = `session:${sessionId}:intervention:${interventionType}`;
    if (this.isConnected) {
      const result = await this.client.get(key);
      return result === null;
    }
    return !this.memoryStore.has(key);
  }

  // Event logging
  async logEvent(sessionId: string, event: any): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      sessionId,
      ...event
    };
    const key = `session:${sessionId}:events`;
    
    if (this.isConnected) {
      await this.client.lPush(key, JSON.stringify(logEntry));
      await this.client.lTrim(key, 0, 99);
    } else {
      const events = this.memoryStore.get(key) || [];
      events.unshift(logEntry);
      if (events.length > 100) events.pop();
      this.memoryStore.set(key, events);
    }
  }

  async getSessionEvents(sessionId: string): Promise<any[]> {
    const key = `session:${sessionId}:events`;
    if (this.isConnected) {
      const events = await this.client.lRange(key, 0, -1);
      return events.map(event => JSON.parse(event));
    }
    return this.memoryStore.get(key) || [];
  }
}
