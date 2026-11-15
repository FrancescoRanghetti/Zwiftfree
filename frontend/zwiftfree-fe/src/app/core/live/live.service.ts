import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import { AuthService } from '../auth/auth.service';

/** What the ride screen publishes once a second. */
export interface LivePosition {
  routeId: string | null;
  distanceM: number;
  speedKmh: number;
  power: number;
  cadence: number;
  hr: number | null;
  grade: number;
  lat: number | null;
  lon: number | null;
  remainingM: number | null;
  elapsedS: number;
  avatarState: string;
  road: string | null;
  title: string | null;
}

/** What the server forwards (to the second screen and to the route's topic). */
export interface LiveRider extends Omit<LivePosition, 'routeId'> {
  userId: string;
  displayName: string;
  routeId: string;
  at: string;
}

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * STOMP over WebSocket on /ws (spec §10). The client library is loaded on first use, so it is not in the startup
 * bundle. Authenticates in the CONNECT frame with the current access token (refreshed before every reconnect);
 * reconnects by itself every 5 s. Publishing while disconnected silently drops the position — it is live data.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly auth = inject(AuthService);
  private client: Client | null = null;
  private starting: Promise<Client> | null = null;
  private users = 0;
  private readonly subscriptions = new Map<string, Set<(m: LiveRider) => void>>();
  private readonly active = new Map<string, StompSubscription>();

  readonly status = signal<LiveStatus>('idle');

  /** Keeps the connection open while at least one user (ride screen, second screen) holds it. */
  async acquire(destroyRef?: DestroyRef): Promise<void> {
    this.users++;
    destroyRef?.onDestroy(() => this.release());
    await this.start();
  }

  release(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0) void this.stop();
  }

  publish(position: LivePosition): void {
    const c = this.client;
    if (!c?.connected) return;
    c.publish({ destination: '/app/live/position', body: JSON.stringify(position) });
  }

  /** Own positions, from any device of the same user. Returns the unsubscribe function. */
  onMyPosition(handler: (m: LiveRider) => void): () => void {
    return this.subscribe('/user/queue/live', handler);
  }

  private subscribe(destination: string, handler: (m: LiveRider) => void): () => void {
    let handlers = this.subscriptions.get(destination);
    if (!handlers) {
      handlers = new Set();
      this.subscriptions.set(destination, handlers);
    }
    handlers.add(handler);
    if (this.client?.connected && !this.active.has(destination))
      this.listen(this.client, destination);
    return () => {
      handlers.delete(handler);
      if (!handlers.size) {
        this.subscriptions.delete(destination);
        this.active.get(destination)?.unsubscribe();
        this.active.delete(destination);
      }
    };
  }

  private listen(client: Client, destination: string): void {
    this.active.set(
      destination,
      client.subscribe(destination, (msg: IMessage) => {
        let rider: LiveRider;
        try {
          rider = JSON.parse(msg.body) as LiveRider;
        } catch {
          return;
        }
        for (const h of this.subscriptions.get(destination) ?? []) h(rider);
      }),
    );
  }

  private start(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    if (!this.starting) {
      this.starting = import('@stomp/stompjs').then(({ Client }) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const client = new Client({
          brokerURL: `${proto}://${location.host}/ws`,
          reconnectDelay: 5000,
          heartbeatIncoming: 10_000,
          heartbeatOutgoing: 10_000,
          beforeConnect: async () => {
            this.status.set('connecting');
            const token = await this.auth.freshAccessToken();
            client.connectHeaders = token ? { Authorization: `Bearer ${token}` } : {};
          },
          onConnect: () => {
            this.status.set('connected');
            this.active.clear();
            for (const destination of this.subscriptions.keys()) this.listen(client, destination);
          },
          onStompError: () => this.status.set('error'),
          onWebSocketClose: () => {
            if (this.client) this.status.set('connecting');
          },
        });
        this.client = client;
        client.activate();
        // Everyone let go while the library was loading.
        if (this.users === 0) void this.stop();
        return client;
      });
    }
    return this.starting;
  }

  private async stop(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.starting = null;
    this.active.clear();
    this.status.set('idle');
    await c?.deactivate();
  }
}
