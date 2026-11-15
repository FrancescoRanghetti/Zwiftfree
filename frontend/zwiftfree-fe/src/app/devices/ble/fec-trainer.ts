import { Observable, Subject } from 'rxjs';
import { TrainerData, TrainerDevice } from '../trainer';
import { BleDevice, GradeThrottle } from './ble-device';
import { FEC_RX, FEC_SERVICE, FEC_TX, parsePage, trackResistance, unwrapAnt } from './fec-protocol';

/** Older Tacx trainers without FTMS: ANT+ FE-C pages over Bluetooth LE. */
export class FecTrainer extends BleDevice implements TrainerDevice {
  readonly kind = 'FE-C';
  private readonly data = new Subject<TrainerData>();
  readonly data$: Observable<TrainerData> = this.data.asObservable();
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private crr = 0.004;
  /** Page 25 brings power/cadence, page 16 speed: merge them into one reading. */
  private last: TrainerData = {};
  private readonly throttle = new GradeThrottle(async (g) => {
    if (!this.tx) throw new Error('Rullo non collegato');
    await this.tx.writeValueWithResponse(trackResistance(g, this.crr) as Uint8Array<ArrayBuffer>);
  });

  async setSimulation(gradePercent: number, _windMs?: number, crr = 0.004): Promise<void> {
    this.crr = crr;
    this.throttle.push(gradePercent);
  }

  override async disconnect(): Promise<void> {
    this.throttle.reset();
    await super.disconnect();
  }

  protected override async setup(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(FEC_SERVICE);
    const rx = await service.getCharacteristic(FEC_RX);
    this.tx = await service.getCharacteristic(FEC_TX);
    rx.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!v) return;
      const page = unwrapAnt(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      if (!page) return;
      const d = parsePage(page);
      if (!Object.keys(d).length) return;
      this.last = { ...this.last, ...d };
      this.data.next(this.last);
    });
    await rx.startNotifications();
  }

  protected override afterReconnect(): void {
    this.throttle.resend();
  }
}
