import { firstValueFrom, take, toArray } from 'rxjs';
import { GradeThrottle } from './ble-device';
import { FakeCharacteristic, FakeDevice, FakeService, fakeFtmsTrainer } from './fake-ble';
import { FEC_RX, FEC_SERVICE, FEC_TX, unwrapAnt, wrapAnt } from './fec-protocol';
import { FecTrainer } from './fec-trainer';
import { FtmsTrainer } from './ftms-trainer';
import { HeartRateMonitor } from './heart-rate-monitor';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('GradeThrottle', () => {
  it('sends at most once per second, only changes above 0.1 %, latest value wins', () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const sent: number[] = [];
      const t = new GradeThrottle(
        async (g) => void sent.push(g),
        1000,
        0.1,
        () => now,
      );
      t.push(2);
      t.push(2.05); // too small
      t.push(3); // too early
      t.push(4); // too early, replaces 3
      expect(sent).toEqual([2]);
      now = 1000;
      vi.advanceTimersByTime(1000);
      expect(sent).toEqual([2, 4]);
      now = 3000;
      t.push(4.1);
      expect(sent).toEqual([2, 4]);
      t.resend();
      expect(sent).toEqual([2, 4, 4]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FtmsTrainer', () => {
  it('takes control, starts, streams data and sends the grade', async () => {
    const { device, bikeData, control } = fakeFtmsTrainer();
    const trainer = new FtmsTrainer(device.asBluetoothDevice());
    await trainer.connect();
    expect(trainer.status()).toBe('connected');
    expect(trainer.name).toBe('Tacx Neo 2T');
    expect(control.writes).toEqual([[0x00], [0x07]]);
    expect(bikeData.notifying).toBe(true);

    const got = firstValueFrom(trainer.data$);
    bikeData.notify([0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00]);
    expect(await got).toEqual({ speedKmh: 25, cadence: 90, power: 250 });

    await trainer.setSimulation(4.5, 0, 0.004, 0.19);
    await flush();
    expect(control.writes[2]).toEqual([0x11, 0, 0, 0xc2, 0x01, 40, 19]);
    await trainer.disconnect();
    expect(trainer.status()).toBe('disconnected');
  });

  it('fails when the trainer refuses control', async () => {
    const { device } = fakeFtmsTrainer(0x05);
    const trainer = new FtmsTrainer(device.asBluetoothDevice());
    await expect(trainer.connect()).rejects.toThrow(/controllo/);
    expect(trainer.status()).toBe('error');
  });

  it('reconnects by itself and resends the last grade', async () => {
    const { device, control } = fakeFtmsTrainer();
    const trainer = new FtmsTrainer(device.asBluetoothDevice(), [5, 5, 5]);
    await trainer.connect();
    await trainer.setSimulation(3);
    await flush();
    device.failConnects = 1;
    device.drop();
    expect(trainer.status()).toBe('connecting');
    await new Promise((r) => setTimeout(r, 40));
    expect(trainer.status()).toBe('connected');
    expect(device.connects).toBe(3); // first connect, one failed retry, one good retry
    await flush();
    const last = control.writes[control.writes.length - 1];
    expect(last[0]).toBe(0x11);
    expect(last[3] | (last[4] << 8)).toBe(300);
  });

  it('gives up after 3 failed attempts', async () => {
    const { device } = fakeFtmsTrainer();
    const trainer = new FtmsTrainer(device.asBluetoothDevice(), [2, 2, 2]);
    await trainer.connect();
    device.failConnects = 10;
    device.drop();
    await new Promise((r) => setTimeout(r, 40));
    expect(trainer.status()).toBe('error');
    expect(device.connects).toBe(4);
  });

  it('does not reconnect after the user disconnects', async () => {
    const { device } = fakeFtmsTrainer();
    const trainer = new FtmsTrainer(device.asBluetoothDevice(), [2, 2, 2]);
    await trainer.connect();
    await trainer.disconnect();
    await new Promise((r) => setTimeout(r, 20));
    expect(device.connects).toBe(1);
    expect(trainer.status()).toBe('disconnected');
  });
});

describe('FecTrainer', () => {
  it('merges pages 25 and 16 and writes track resistance', async () => {
    const rx = new FakeCharacteristic();
    const tx = new FakeCharacteristic();
    const device = new FakeDevice(
      'fec-1',
      'Tacx Flux',
      new Map([
        [
          FEC_SERVICE,
          new FakeService(
            new Map<string | number, FakeCharacteristic>([
              [FEC_RX, rx],
              [FEC_TX, tx],
            ]),
          ),
        ],
      ]),
    );
    const trainer = new FecTrainer(device.asBluetoothDevice());
    await trainer.connect();
    const values = firstValueFrom(trainer.data$.pipe(take(2), toArray()));
    rx.notify(wrapAnt(Uint8Array.of(0x19, 1, 88, 0, 0, 0xc8, 0x30, 0), 0x4e));
    rx.notify(wrapAnt(Uint8Array.of(0x10, 25, 0, 0, 0x88, 0x13, 0, 0), 0x4e));
    const [a, b] = await values;
    expect(a).toEqual({ cadence: 88, power: 200 });
    expect(b.power).toBe(200);
    expect(b.speedKmh).toBeCloseTo(18, 5);

    await trainer.setSimulation(-3, 0, 0.005);
    await flush();
    const page = unwrapAnt(Uint8Array.from(tx.writes[0]))!;
    expect(page[0]).toBe(0x33);
    expect(page[5] | (page[6] << 8)).toBe(19700);
    expect(page[7]).toBe(100);
  });
});

describe('HeartRateMonitor', () => {
  it('streams heart rate', async () => {
    const ch = new FakeCharacteristic();
    const device = new FakeDevice(
      'hr-1',
      'HRM-Pro',
      new Map([
        [0x180d, new FakeService(new Map<string | number, FakeCharacteristic>([[0x2a37, ch]]))],
      ]),
    );
    const hrm = new HeartRateMonitor(device.asBluetoothDevice());
    await hrm.connect();
    const got = firstValueFrom(hrm.hr$);
    ch.notify([0x00, 132]);
    expect(await got).toBe(132);
  });
});
