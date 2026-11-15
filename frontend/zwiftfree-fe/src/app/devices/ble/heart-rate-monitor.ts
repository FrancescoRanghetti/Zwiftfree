import { Observable, Subject } from 'rxjs';
import { HeartRateDevice } from '../trainer';
import { BleDevice } from './ble-device';
import { HR_MEASUREMENT, HR_SERVICE, parseHeartRate } from './hr-protocol';

/** Chest strap or watch broadcasting the standard Heart Rate Service (Garmin HRM...). */
export class HeartRateMonitor extends BleDevice implements HeartRateDevice {
  private readonly hr = new Subject<number>();
  readonly hr$: Observable<number> = this.hr.asObservable();

  protected override async setup(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(HR_SERVICE);
    const ch = await service.getCharacteristic(HR_MEASUREMENT);
    ch.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (v) this.hr.next(parseHeartRate(v));
    });
    await ch.startNotifications();
  }
}
