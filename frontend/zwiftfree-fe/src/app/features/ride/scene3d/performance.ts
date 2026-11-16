/** One-second frame windows; only consecutive slow windows trigger a fallback. */
export class FrameRateMonitor {
  private start: number | null = null;
  private frames = 0;
  private slowSince: number | null = null;

  reset(): void {
    this.start = null;
    this.frames = 0;
    this.slowSince = null;
  }

  frame(nowMs: number, visible = true): boolean {
    if (!visible) {
      this.reset();
      return false;
    }
    if (this.start === null) {
      this.start = nowMs;
      return false;
    }
    this.frames++;
    const elapsed = nowMs - this.start;
    if (elapsed < 1000) return false;
    const fps = (1000 * this.frames) / elapsed;
    if (fps < 25) this.slowSince ??= this.start;
    else this.slowSince = null;
    this.start = nowMs;
    this.frames = 0;
    return this.slowSince !== null && nowMs - this.slowSince >= 10_000;
  }
}
