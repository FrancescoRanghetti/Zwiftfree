import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { LiveService } from './live.service';

/** Minimal stand-in for @stomp/stompjs' Client: records what the service does with it. */
class FakeClient {
  static last: FakeClient | null = null;
  connected = false;
  connectHeaders: Record<string, string> = {};
  activated = false;
  deactivated = false;
  published: { destination: string; body: string }[] = [];
  subscribed: { destination: string; handler: (m: { body: string }) => void }[] = [];

  constructor(readonly config: Record<string, unknown> & { brokerURL: string }) {
    FakeClient.last = this;
  }

  activate(): void {
    this.activated = true;
  }

  async deactivate(): Promise<void> {
    this.deactivated = true;
    this.connected = false;
  }

  publish(p: { destination: string; body: string }): void {
    this.published.push(p);
  }

  subscribe(destination: string, handler: (m: { body: string }) => void) {
    this.subscribed.push({ destination, handler });
    return { unsubscribe: () => undefined };
  }

  /** Simulates the broker accepting the connection. */
  async connect(): Promise<void> {
    await (this.config['beforeConnect'] as () => Promise<void>)();
    this.connected = true;
    (this.config['onConnect'] as () => void)();
  }
}

vi.mock('@stomp/stompjs', () => ({ Client: FakeClient }));

describe('LiveService', () => {
  let service: LiveService;

  beforeEach(() => {
    FakeClient.last = null;
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { freshAccessToken: async () => 'tok-123' } }],
    });
    service = TestBed.inject(LiveService);
  });

  it('connects to /ws with the access token in the CONNECT headers', async () => {
    await service.acquire();
    const client = FakeClient.last!;
    expect(client.activated).toBe(true);
    expect(client.config.brokerURL).toBe(`ws://${location.host}/ws`);
    await client.connect();
    expect(client.connectHeaders).toEqual({ Authorization: 'Bearer tok-123' });
    expect(service.status()).toBe('connected');
  });

  it('publishes positions only while connected', async () => {
    await service.acquire();
    const client = FakeClient.last!;
    const position = {
      routeId: null,
      distanceM: 10,
      speedKmh: 30,
      power: 200,
      cadence: 90,
      hr: null,
      grade: 1,
      lat: 46,
      lon: 9,
      remainingM: null,
      elapsedS: 3,
      avatarState: 'RIDING',
      road: null,
      title: null,
    };
    service.publish(position);
    expect(client.published).toEqual([]);
    await client.connect();
    service.publish(position);
    expect(client.published).toHaveLength(1);
    expect(client.published[0].destination).toBe('/app/live/position');
    expect(JSON.parse(client.published[0].body)).toMatchObject({
      power: 200,
      avatarState: 'RIDING',
    });
  });

  it('subscribes to the own queue (also after a reconnect) and delivers parsed positions', async () => {
    await service.acquire();
    const got: unknown[] = [];
    const off = service.onMyPosition((r) => got.push(r));
    const client = FakeClient.last!;
    await client.connect();
    expect(client.subscribed.map((s) => s.destination)).toEqual(['/user/queue/live']);
    client.subscribed[0].handler({ body: JSON.stringify({ power: 321 }) });
    client.subscribed[0].handler({ body: 'not json' });
    expect(got).toEqual([{ power: 321 }]);
    // Reconnect: the subscription is made again.
    await client.connect();
    expect(client.subscribed).toHaveLength(2);
    off();
  });

  it('disconnects when the last user lets go', async () => {
    await service.acquire();
    await service.acquire();
    const client = FakeClient.last!;
    service.release();
    expect(client.deactivated).toBe(false);
    service.release();
    expect(client.deactivated).toBe(true);
    expect(service.status()).toBe('idle');
  });
});
