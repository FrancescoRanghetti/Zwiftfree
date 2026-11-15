/**
 * Bluetooth Fitness Machine Service (FTMS 1.0) for indoor bikes: decoding Indoor Bike Data and encoding Control
 * Point requests. Pure functions over bytes, no Web Bluetooth here.
 */

export const FTMS_SERVICE = 0x1826;
export const INDOOR_BIKE_DATA = 0x2ad2;
export const FTMS_CONTROL_POINT = 0x2ad9;

export const enum FtmsOp {
  RequestControl = 0x00,
  Reset = 0x01,
  StartOrResume = 0x07,
  SetIndoorBikeSimulation = 0x11,
  Response = 0x80,
}

export const enum FtmsResult {
  Success = 0x01,
  NotSupported = 0x02,
  InvalidParameter = 0x03,
  OperationFailed = 0x04,
  ControlNotPermitted = 0x05,
}

export interface IndoorBikeData {
  speedKmh?: number;
  cadence?: number;
  power?: number;
  hr?: number;
}

/**
 * Indoor Bike Data (0x2AD2). Fields follow the 16-bit flags in a fixed order; note that bit 0 ("More Data") set
 * means the instantaneous speed is NOT present.
 */
export function parseIndoorBikeData(view: DataView): IndoorBikeData {
  const flags = view.getUint16(0, true);
  let o = 2;
  const out: IndoorBikeData = {};
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  if (!has(0)) {
    out.speedKmh = view.getUint16(o, true) / 100;
    o += 2;
  }
  if (has(1)) o += 2; // average speed
  if (has(2)) {
    out.cadence = view.getUint16(o, true) / 2;
    o += 2;
  }
  if (has(3)) o += 2; // average cadence
  if (has(4)) o += 3; // total distance (uint24)
  if (has(5)) o += 2; // resistance level
  if (has(6)) {
    out.power = view.getInt16(o, true);
    o += 2;
  }
  if (has(7)) o += 2; // average power
  if (has(8)) o += 5; // expended energy: total, per hour, per minute
  if (has(9)) {
    // Last field read; metabolic equivalent and times that may follow are not needed.
    const hr = view.getUint8(o);
    if (hr > 0) out.hr = hr;
  }
  return out;
}

export function requestControl(): Uint8Array {
  return Uint8Array.of(FtmsOp.RequestControl);
}

export function startOrResume(): Uint8Array {
  return Uint8Array.of(FtmsOp.StartOrResume);
}

/**
 * Set Indoor Bike Simulation Parameters (0x11): wind speed sint16 (0.001 m/s), grade sint16 (0.01 %),
 * Crr uint8 (0.0001), wind resistance coefficient Cw uint8 (0.01 kg/m).
 */
export function simulationParams(
  gradePercent: number,
  windMs = 0,
  crr = 0.004,
  cw = 0.51,
): Uint8Array {
  const buf = new DataView(new ArrayBuffer(7));
  buf.setUint8(0, FtmsOp.SetIndoorBikeSimulation);
  buf.setInt16(1, clamp(Math.round(windMs * 1000), -32768, 32767), true);
  buf.setInt16(3, clamp(Math.round(gradePercent * 100), -32768, 32767), true);
  buf.setUint8(5, clamp(Math.round(crr * 10000), 0, 255));
  buf.setUint8(6, clamp(Math.round(cw * 100), 0, 255));
  return new Uint8Array(buf.buffer);
}

export interface ControlResponse {
  request: number;
  result: number;
}

/** Control Point indication: 0x80, request op code, result code. Null for anything else. */
export function parseControlResponse(view: DataView): ControlResponse | null {
  if (view.byteLength < 3 || view.getUint8(0) !== FtmsOp.Response) return null;
  return { request: view.getUint8(1), result: view.getUint8(2) };
}

/** Cw for FTMS from the rider's CdA: ½·ρ·CdA (kg/m). */
export function windResistanceCoefficient(cda: number, rho = 1.2): number {
  return 0.5 * rho * cda;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
