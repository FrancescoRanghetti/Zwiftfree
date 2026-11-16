import { FrameRateMonitor } from './performance';

/** Supplies complete one-second windows without relying on wall-clock timers. */
function frames(
  monitor: FrameRateMonitor,
  startMs: number,
  fps: number,
  seconds: number,
): boolean[] {
  const results: boolean[] = [];
  for (let second = 0; second < seconds; second++) {
    for (let frame = 1; frame <= fps; frame++) {
      results.push(monitor.frame(startMs + second * 1000 + (frame * 1000) / fps));
    }
  }
  return results;
}

describe('3D frame-rate fallback', () => {
  it('falls back only after ten consecutive seconds below 25 fps', () => {
    const monitor = new FrameRateMonitor();
    expect(monitor.frame(0)).toBe(false);
    const slow = frames(monitor, 0, 20, 10);
    expect(slow.slice(0, -1).every((fallback) => !fallback)).toBe(true);
    expect(slow.at(-1)).toBe(true);
  });

  it('accepts 25 fps and faster for long rides', () => {
    for (const fps of [25, 30, 60]) {
      const monitor = new FrameRateMonitor();
      monitor.frame(0);
      expect(frames(monitor, 0, fps, 30).every((fallback) => !fallback)).toBe(true);
    }
  });

  it('restarts the ten-second interval after recovery instead of accumulating slow periods', () => {
    const monitor = new FrameRateMonitor();
    monitor.frame(0);
    expect(frames(monitor, 0, 20, 9).every((fallback) => !fallback)).toBe(true);
    expect(frames(monitor, 9000, 30, 1).every((fallback) => !fallback)).toBe(true);
    expect(frames(monitor, 10_000, 20, 9).every((fallback) => !fallback)).toBe(true);
    expect(frames(monitor, 19_000, 20, 1).at(-1)).toBe(true);
  });

  it('discards hidden-tab time and requires ten new visible seconds', () => {
    const monitor = new FrameRateMonitor();
    monitor.frame(0);
    frames(monitor, 0, 20, 9);
    expect(monitor.frame(9000, false)).toBe(false);
    expect(monitor.frame(60_000, false)).toBe(false);
    expect(monitor.frame(90_000)).toBe(false);
    expect(frames(monitor, 90_000, 20, 9).every((fallback) => !fallback)).toBe(true);
    expect(frames(monitor, 99_000, 20, 1).at(-1)).toBe(true);
  });

  it('can reset its history explicitly', () => {
    const monitor = new FrameRateMonitor();
    monitor.frame(0);
    frames(monitor, 0, 20, 9);
    monitor.reset();
    expect(monitor.frame(9000)).toBe(false);
    expect(frames(monitor, 9000, 20, 9).every((fallback) => !fallback)).toBe(true);
  });
});
