/**
 * In-memory Web Bluetooth stand-ins for tests: a device with services and characteristics that can notify values
 * and record writes. Only the parts of the API the app uses.
 */
export class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  readonly writes: number[][] = [];
  notifying = false;
  onWrite: ((bytes: number[]) => void) | null = null;

  async startNotifications(): Promise<this> {
    this.notifying = true;
    return this;
  }

  async writeValueWithResponse(data: BufferSource): Promise<void> {
    const bytes = Array.from(
      new Uint8Array(data instanceof ArrayBuffer ? data : (data as ArrayBufferView).buffer),
    );
    this.writes.push(bytes);
    this.onWrite?.(bytes);
  }

  notify(bytes: number[] | Uint8Array): void {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

export class FakeService {
  constructor(readonly chars: Map<string | number, FakeCharacteristic>) {}

  async getCharacteristic(uuid: string | number): Promise<FakeCharacteristic> {
    const c = this.chars.get(uuid);
    if (!c) throw new DOMException('No characteristic', 'NotFoundError');
    return c;
  }
}

export class FakeDevice extends EventTarget {
  /** Number of connection attempts that should still fail. */
  failConnects = 0;
  connects = 0;
  readonly gatt: {
    connected: boolean;
    connect: () => Promise<unknown>;
    disconnect: () => void;
    getPrimaryService: (uuid: string | number) => Promise<FakeService>;
  };

  constructor(
    readonly id: string,
    readonly name: string,
    readonly services: Map<string | number, FakeService>,
  ) {
    super();
    const gatt = {
      connected: false,
      connect: async () => {
        this.connects++;
        if (this.failConnects > 0) {
          this.failConnects--;
          throw new DOMException('Unreachable', 'NetworkError');
        }
        gatt.connected = true;
        return gatt;
      },
      disconnect: () => {
        gatt.connected = false;
        this.dispatchEvent(new Event('gattserverdisconnected'));
      },
      getPrimaryService: async (uuid: string | number) => {
        const s = this.services.get(uuid);
        if (!s) throw new DOMException('No service', 'NotFoundError');
        return s;
      },
    };
    this.gatt = gatt;
  }

  /** The link drops (trainer switched off, out of range). */
  drop(): void {
    this.gatt.connected = false;
    this.dispatchEvent(new Event('gattserverdisconnected'));
  }

  asBluetoothDevice(): BluetoothDevice {
    return this as unknown as BluetoothDevice;
  }
}

/** A trainer answering FTMS control point requests with `result` (1 = success). */
export function fakeFtmsTrainer(result = 1) {
  const bikeData = new FakeCharacteristic();
  const control = new FakeCharacteristic();
  control.onWrite = (b) => queueMicrotask(() => control.notify([0x80, b[0], result]));
  const device = new FakeDevice(
    'ftms-1',
    'Tacx Neo 2T',
    new Map([
      [
        0x1826,
        new FakeService(
          new Map<string | number, FakeCharacteristic>([
            [0x2ad2, bikeData],
            [0x2ad9, control],
          ]),
        ),
      ],
    ]),
  );
  return { device, bikeData, control };
}
