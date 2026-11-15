import { Random } from '../shared/random';

/** Spec §8. FINISHED is not an avatar state: the ride engine adds it at the end of a route. */
export type AvatarState =
  'IDLE' | 'RIDING' | 'COASTING' | 'PEE_BREAK' | 'CRASHED' | 'RECOVERING' | 'PAUSED';

export type CrashReason = 'HARD_BRAKING' | 'CORNER' | 'RANDOM';

export interface AvatarSettings {
  peeBreakEnabled: boolean;
  /** Seconds standing still (virtual speed 0) while coasting before the pee break. */
  peeBreakAfterS: number;
  crashesEnabled: boolean;
}

export interface AvatarInput {
  dt: number;
  power: number;
  cadence: number;
  /** Virtual speed from the physics, km/h. */
  speedKmh: number;
  gradePercent: number;
  /** Radius of the road's bend at the rider, metres (Infinity on a straight). */
  turnRadiusM: number;
}

export interface AvatarEvent {
  type: 'PEE_BREAK_START' | 'PEE_BREAK_END' | 'CRASH' | 'RECOVERED';
  payload?: Record<string, unknown>;
}

/** Crash conditions (spec §8), documented in DECISIONS.md. */
export const CRASH_RULES = {
  hardBraking: {
    minSpeedKmh: 35,
    fromPowerW: 150,
    /** Cadence before the drop must be above this, and below `toCadence` after it. */
    fromCadence: 40,
    toCadence: 10,
    maxGradePercent: -6,
    windowS: 1,
    probability: 0.3,
  },
  corner: { maxRadiusM: 25, minSpeedKmh: 45, probability: 0.5 },
  random: { perSecond: 1 / 2000, minSpeedKmh: 10, maxGradePercent: 1 },
  /** On the ground at least this long. */
  groundS: 3,
  /** Total time lost (ground + getting up), drawn between these bounds. */
  penaltyMinS: 5,
  penaltyMaxS: 10,
} as const;

/** Getting back on the bike after a pee break: the bike stands still meanwhile. */
export const REMOUNT_S = 1.5;

export const DEFAULT_AVATAR_SETTINGS: AvatarSettings = {
  peeBreakEnabled: true,
  peeBreakAfterS: 20,
  crashesEnabled: true,
};

/**
 * The rider's state machine:
 * IDLE →(power) RIDING ⇄ COASTING →(still for N s) PEE_BREAK →(pedal) RIDING;
 * RIDING/COASTING →(crash) CRASHED →(3 s) RECOVERING →(pedal, penalty over) RIDING; any → PAUSED → back.
 * Pure and driven by `step`, with an injectable random generator for deterministic tests.
 */
export class AvatarMachine {
  state: AvatarState = 'IDLE';
  /** Seconds spent in the current state (pee break timer, crash countdown). */
  inState = 0;
  /** Seconds left of the remount animation after a pee break. */
  remountLeft = 0;
  /** Details of the last crash. */
  lastCrash: { reason: CrashReason; speedKmh: number; gradePercent: number } | null = null;
  /** Total seconds the last crash costs (ground + recovering). */
  penaltyS = 0;

  private beforePause: AvatarState = 'IDLE';
  private stillFor = 0;
  private sinceCrash = 0;
  private now = 0;
  private recent: { t: number; power: number; cadence: number }[] = [];
  private brakingChecked = false;
  private inCorner = false;
  private riskSeconds = 0;

  constructor(
    private settings: AvatarSettings = DEFAULT_AVATAR_SETTINGS,
    private readonly random: Random = Math.random,
  ) {}

  setSettings(settings: AvatarSettings): void {
    this.settings = settings;
  }

  /** The bike must not move: behind the bush, on the ground, getting up, or getting back on. */
  get frozen(): boolean {
    return (
      this.state === 'PEE_BREAK' ||
      this.state === 'CRASHED' ||
      this.state === 'RECOVERING' ||
      this.remountLeft > 0
    );
  }

  /** Seconds before the rider may ride again after a crash (0 when pedalling will do). */
  get penaltyLeft(): number {
    return this.state === 'CRASHED' || this.state === 'RECOVERING'
      ? Math.max(0, this.penaltyS - this.sinceCrash)
      : 0;
  }

  pause(): void {
    if (this.state === 'PAUSED') return;
    this.beforePause = this.state;
    this.state = 'PAUSED';
  }

  resume(): void {
    if (this.state === 'PAUSED') this.state = this.beforePause;
  }

  step(i: AvatarInput): AvatarEvent[] {
    if (this.state === 'PAUSED') return [];
    this.now += i.dt;
    this.inState += i.dt;
    this.remountLeft = Math.max(0, this.remountLeft - i.dt);
    this.recent.push({ t: this.now, power: i.power, cadence: i.cadence });
    while (
      this.recent.length &&
      this.recent[0].t < this.now - CRASH_RULES.hardBraking.windowS - 0.05
    ) {
      this.recent.shift();
    }
    const pedalling = i.power > 0 || i.cadence > 0;
    const events: AvatarEvent[] = [];

    switch (this.state) {
      case 'IDLE':
        if (i.power > 0) this.go('RIDING');
        break;
      case 'RIDING':
      case 'COASTING': {
        const crash = this.crashCheck(i);
        if (crash) {
          events.push(this.crash(crash, i));
          break;
        }
        if (this.state === 'RIDING') {
          if (i.power <= 0 && i.cadence <= 0) this.go('COASTING');
        } else if (pedalling) {
          this.go('RIDING');
        } else if (i.speedKmh < 0.1) {
          this.stillFor += i.dt;
          if (this.settings.peeBreakEnabled && this.stillFor >= this.settings.peeBreakAfterS) {
            this.go('PEE_BREAK');
            events.push({ type: 'PEE_BREAK_START' });
          }
        } else {
          this.stillFor = 0;
        }
        break;
      }
      case 'PEE_BREAK':
        if (pedalling) {
          const durationS = Math.round(this.inState);
          this.go('RIDING');
          this.remountLeft = REMOUNT_S;
          events.push({ type: 'PEE_BREAK_END', payload: { durationS } });
        }
        break;
      case 'CRASHED':
        this.sinceCrash += i.dt;
        if (this.inState >= CRASH_RULES.groundS) this.go('RECOVERING');
        break;
      case 'RECOVERING':
        this.sinceCrash += i.dt;
        if (pedalling && this.sinceCrash >= this.penaltyS) {
          const downS = Math.round(this.sinceCrash);
          this.go('RIDING');
          events.push({ type: 'RECOVERED', payload: { downS } });
        }
        break;
    }
    return events;
  }

  private go(state: AvatarState): void {
    this.state = state;
    this.inState = 0;
    if (state !== 'COASTING') this.stillFor = 0;
  }

  private crash(reason: CrashReason, i: AvatarInput): AvatarEvent {
    this.lastCrash = {
      reason,
      speedKmh: Math.round(i.speedKmh * 10) / 10,
      gradePercent: Math.round(i.gradePercent * 10) / 10,
    };
    this.penaltyS =
      CRASH_RULES.penaltyMinS + this.random() * (CRASH_RULES.penaltyMaxS - CRASH_RULES.penaltyMinS);
    this.sinceCrash = 0;
    this.go('CRASHED');
    return {
      type: 'CRASH',
      payload: { reason, speedKmh: this.lastCrash.speedKmh, grade: this.lastCrash.gradePercent },
    };
  }

  /** Each rule is rolled once per occurrence (one braking, one bend), the random fall once per second. */
  private crashCheck(i: AvatarInput): CrashReason | null {
    const rules = CRASH_RULES;
    // Hard braking: power from > 150 W to 0 and the cadence collapsing within 1 s, fast, on a steep descent.
    const hb = rules.hardBraking;
    if (i.power > 0) this.brakingChecked = false;
    if (!this.brakingChecked && i.power <= 0 && i.cadence < hb.toCadence) {
      const before = this.recent.slice(0, -1);
      const wasPushing = before.some((r) => r.power > hb.fromPowerW && r.cadence > hb.fromCadence);
      if (wasPushing) {
        this.brakingChecked = true;
        if (
          this.settings.crashesEnabled &&
          i.speedKmh > hb.minSpeedKmh &&
          i.gradePercent < hb.maxGradePercent &&
          this.random() < hb.probability
        ) {
          return 'HARD_BRAKING';
        }
      }
    }
    // Too fast into a tight bend.
    const c = rules.corner;
    const tight = i.turnRadiusM < c.maxRadiusM;
    if (tight && !this.inCorner) {
      this.inCorner = true;
      if (
        this.settings.crashesEnabled &&
        i.speedKmh > c.minSpeedKmh &&
        this.random() < c.probability
      ) {
        return 'CORNER';
      }
    } else if (!tight) {
      this.inCorner = false;
    }
    // Rare random fall, never uphill.
    const r = rules.random;
    if (i.speedKmh > r.minSpeedKmh && i.gradePercent < r.maxGradePercent) {
      // Rounded so that ten 0.1 s steps make exactly one roll.
      this.riskSeconds = Math.round((this.riskSeconds + i.dt) * 1e6) / 1e6;
      while (this.riskSeconds >= 1) {
        this.riskSeconds -= 1;
        if (this.settings.crashesEnabled && this.random() < r.perSecond) return 'RANDOM';
      }
    }
    return null;
  }
}
