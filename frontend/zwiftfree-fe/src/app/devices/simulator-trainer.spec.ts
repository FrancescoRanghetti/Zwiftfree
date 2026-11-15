import { firstValueFrom } from 'rxjs';
import { seededRandom } from '../shared/random';
import { SimulatorHeartRate, SimulatorTrainer } from './simulator-trainer';

describe('SimulatorTrainer', () => {
  it('clamps power to 0–600 W and moves in 10 W steps', async () => {
    const t = new SimulatorTrainer(seededRandom(1));
    await t.connect();
    t.setPower(250);
    t.nudge(10);
    expect(t.targetPower()).toBe(260);
    t.setPower(900);
    expect(t.targetPower()).toBe(600);
    t.setPower(-5);
    expect(t.targetPower()).toBe(0);
    await t.disconnect();
    expect(t.status()).toBe('disconnected');
  });

  it('pedals at 85–95 rpm only when producing power', async () => {
    const t = new SimulatorTrainer(seededRandom(7));
    await t.connect();
    expect((await firstValueFrom(t.data$)).cadence).toBe(0);
    for (let i = 0; i < 200; i++) {
      t.setPower(200);
      const d = await firstValueFrom(t.data$);
      expect(d.power).toBe(200);
      expect(d.cadence).toBeGreaterThanOrEqual(85);
      expect(d.cadence).toBeLessThanOrEqual(95);
    }
    await t.disconnect();
  });
});

describe('SimulatorHeartRate', () => {
  it('rises towards the target with a lag and falls back at rest', () => {
    let power = 200;
    const hr = new SimulatorHeartRate(() => power, 60, 190, 200);
    const values: number[] = [];
    hr.hr$.subscribe((v) => values.push(v));
    hr.step(1);
    expect(values.at(-1)!).toBeLessThan(70);
    for (let i = 0; i < 300; i++) hr.step(1);
    expect(values.at(-1)!).toBeCloseTo(hr.target(200), 0);
    expect(hr.target(200)).toBe(177);
    power = 0;
    for (let i = 0; i < 300; i++) hr.step(1);
    expect(values.at(-1)!).toBeLessThan(65);
  });
});
