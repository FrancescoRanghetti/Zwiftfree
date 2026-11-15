import { Observable, Subject } from 'rxjs';
import { TrainerData, TrainerDevice } from '../trainer';
import { BleDevice, GradeThrottle } from './ble-device';
import {
  FTMS_CONTROL_POINT,
  FTMS_SERVICE,
  FtmsResult,
  INDOOR_BIKE_DATA,
  parseControlResponse,
  parseIndoorBikeData,
  requestControl,
  simulationParams,
  startOrResume,
} from './ftms-protocol';

/** How long to wait for a Control Point indication before giving up on a request. */
export const FTMS_RESPONSE_TIMEOUT_MS = 3000;

/** Smart trainer speaking FTMS (recent Tacx, Wahoo, Elite...). */
export class FtmsTrainer extends BleDevice implements TrainerDevice {
  readonly kind = 'FTMS';
  private readonly data = new Subject<TrainerData>();
  readonly data$: Observable<TrainerData> = this.data.asObservable();
  private control: BluetoothRemoteGATTCharacteristic | null = null;
  private waiting: { op: number; resolve: (result: number) => void } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private params = { windMs: 0, crr: 0.004, cw: 0.51 };
  private readonly throttle = new GradeThrottle(async (g) => {
    const result = await this.request(
      simulationParams(g, this.params.windMs, this.params.crr, this.params.cw),
    );
    if (result !== FtmsResult.Success) console.warn('FTMS simulation rejected, result', result);
  });

  async setSimulation(gradePercent: number, windMs = 0, crr = 0.004, cwa = 0.51): Promise<void> {
    this.params = { windMs, crr, cw: cwa };
    this.throttle.push(gradePercent);
  }

  override async disconnect(): Promise<void> {
    this.throttle.reset();
    await super.disconnect();
  }

  protected override async setup(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(FTMS_SERVICE);
    const bikeData = await service.getCharacteristic(INDOOR_BIKE_DATA);
    const control = await service.getCharacteristic(FTMS_CONTROL_POINT);
    bikeData.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (v) this.data.next(parseIndoorBikeData(v));
    });
    control.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      const r = v ? parseControlResponse(v) : null;
      if (r && this.waiting?.op === r.request) {
        this.waiting.resolve(r.result);
        this.waiting = null;
      }
    });
    await control.startNotifications();
    await bikeData.startNotifications();
    this.control = control;
    const granted = await this.request(requestControl());
    if (granted !== FtmsResult.Success) {
      throw new Error("Il rullo non concede il controllo (un'altra app è collegata?)");
    }
    await this.request(startOrResume());
  }

  protected override afterReconnect(): void {
    this.throttle.resend();
  }

  /** Writes a Control Point request and waits for its indication; requests are sent one at a time. */
  private request(bytes: Uint8Array): Promise<number> {
    const run = async () => {
      const control = this.control;
      if (!control) throw new Error('Rullo non collegato');
      const op = bytes[0];
      const answer = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.waiting?.op === op) this.waiting = null;
          reject(new Error(`FTMS: nessuna risposta a 0x${op.toString(16)}`));
        }, FTMS_RESPONSE_TIMEOUT_MS);
        this.waiting = {
          op,
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
        };
      });
      await control.writeValueWithResponse(bytes as Uint8Array<ArrayBuffer>);
      return answer;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
