import { TestBed } from '@angular/core/testing';
import { FakeCharacteristic, FakeDevice, FakeService, fakeFtmsTrainer } from './ble/fake-ble';
import { FEC_RX, FEC_SERVICE, FEC_TX } from './ble/fec-protocol';
import { FTMS_SERVICE } from './ble/ftms-protocol';
import { HR_SERVICE } from './ble/hr-protocol';
import { FecTrainer } from './ble/fec-trainer';
import { FtmsTrainer } from './ble/ftms-trainer';
import { BLUETOOTH, DeviceManager } from './device-manager.service';
import { DeviceStatusService } from './device-status.service';
import { KnownDevicesService } from './known-devices.service';

function fecDevice() {
  const chars = new Map<string | number, FakeCharacteristic>([
    [FEC_RX, new FakeCharacteristic()],
    [FEC_TX, new FakeCharacteristic()],
  ]);
  return new FakeDevice('fec-1', 'Tacx Flux', new Map([[FEC_SERVICE, new FakeService(chars)]]));
}

function hrDevice() {
  const chars = new Map<string | number, FakeCharacteristic>([[0x2a37, new FakeCharacteristic()]]);
  return new FakeDevice('hr-1', 'HRM-Pro', new Map([[0x180d, new FakeService(chars)]]));
}

describe('DeviceManager', () => {
  let chosen: FakeDevice;
  let paired: FakeDevice[];
  const bluetooth = {
    requestDevice: vi.fn(async () => chosen.asBluetoothDevice()),
    getDevices: vi.fn(async () => paired.map((d) => d.asBluetoothDevice())),
  };

  function setup(bt: unknown = bluetooth) {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: BLUETOOTH, useValue: bt }] });
    return {
      manager: TestBed.inject(DeviceManager),
      status: TestBed.inject(DeviceStatusService),
      known: TestBed.inject(KnownDevicesService),
    };
  }

  beforeEach(() => {
    paired = [];
    bluetooth.requestDevice.mockClear();
  });

  it('pairs an FTMS trainer, remembers it and shows its status', async () => {
    const { manager, status, known } = setup();
    chosen = fakeFtmsTrainer().device;
    const t = await manager.pairTrainer();
    expect(t).toBeInstanceOf(FtmsTrainer);
    expect(status.trainer()).toBe('connected');
    expect(status.trainerName()).toBe('Tacx Neo 2T');
    expect(known.devices()[0]).toMatchObject({ id: 'ftms-1', kind: 'trainer' });
    const opts = bluetooth.requestDevice.mock.calls[0] as unknown as [RequestDeviceOptions];
    expect(opts[0].optionalServices).toContain(0x1826);
    await manager.disconnect('trainer');
    expect(status.trainer()).toBe('disconnected');
  });

  it('falls back to FE-C when the trainer has no FTMS', async () => {
    const { manager } = setup();
    chosen = fecDevice();
    expect(await manager.pairTrainer()).toBeInstanceOf(FecTrainer);
  });

  it('pairs a heart-rate strap', async () => {
    const { manager, status } = setup();
    chosen = hrDevice();
    await manager.pairHeartRate();
    expect(status.heartRate()).toBe('connected');
    expect(status.heartRateName()).toBe('HRM-Pro');
  });

  it('reconnects a remembered device without the chooser', async () => {
    const { manager } = setup();
    const { device } = fakeFtmsTrainer();
    paired = [device];
    await manager.reconnect({
      id: 'ftms-1',
      name: 'Tacx Neo 2T',
      kind: 'trainer',
      lastConnectedAt: '',
    });
    expect(manager.trainer()?.status()).toBe('connected');
    expect(bluetooth.requestDevice).not.toHaveBeenCalled();
    await expect(
      manager.reconnect({ id: 'gone', name: 'Vecchio', kind: 'heartRate', lastConnectedAt: '' }),
    ).rejects.toThrow(/Vecchio/);
  });

  it('forgets a device', async () => {
    const { manager, known } = setup();
    chosen = hrDevice();
    await manager.pairHeartRate();
    await manager.forget('hr-1');
    expect(manager.heartRate()).toBeNull();
    expect(known.devices()).toEqual([]);
  });

  it('asks the chooser for the same services the protocol code uses', async () => {
    const { manager } = setup();
    chosen = fakeFtmsTrainer().device;
    await manager.pairTrainer();
    const opts = bluetooth.requestDevice.mock.calls[0] as unknown as [RequestDeviceOptions];
    expect(opts[0].optionalServices).toEqual([FTMS_SERVICE, FEC_SERVICE]);
    chosen = hrDevice();
    await manager.pairHeartRate();
    const hrOpts = bluetooth.requestDevice.mock.calls[1] as unknown as [RequestDeviceOptions];
    expect((hrOpts[0] as { filters: unknown }).filters).toEqual([{ services: [HR_SERVICE] }]);
  });

  it('explains when the browser has no Web Bluetooth', async () => {
    const { manager } = setup(null);
    expect(manager.supported).toBe(false);
    await expect(manager.pairTrainer()).rejects.toThrow(/Chrome o Edge/);
  });
});
