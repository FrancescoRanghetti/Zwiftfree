/**
 * ANT+ FE-C over Bluetooth LE (Tacx trainers without FTMS): ANT messages carried by a Nordic-UART-like service.
 * Pure functions over bytes.
 */

export const FEC_SERVICE = '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e';
export const FEC_RX = '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e'; // trainer → app (notify)
export const FEC_TX = '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e'; // app → trainer (write)

const SYNC = 0xa4;
const MSG_BROADCAST = 0x4e;
const MSG_ACKNOWLEDGED = 0x4f;
const MSG_BURST = 0x50;
const CHANNEL = 0x05;

export const PAGE_GENERAL_FE = 0x10;
export const PAGE_TRAINER_DATA = 0x19;
export const PAGE_TRACK_RESISTANCE = 0x33;

export interface FecData {
  power?: number;
  cadence?: number;
  speedKmh?: number;
}

/** The 8-byte data page inside an ANT broadcast/acknowledged message, or null if the frame is not valid. */
export function unwrapAnt(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 13 || bytes[0] !== SYNC) return null;
  const len = bytes[1];
  if (len !== 9 || ![MSG_BROADCAST, MSG_ACKNOWLEDGED, MSG_BURST].includes(bytes[2])) return null;
  if (checksum(bytes.subarray(0, 12)) !== bytes[12]) return null;
  return bytes.slice(4, 12);
}

/** Page 25 (trainer data: power, cadence) and page 16 (general data: speed). */
export function parsePage(page: Uint8Array): FecData {
  switch (page[0]) {
    case PAGE_TRAINER_DATA: {
      const out: FecData = {};
      if (page[2] !== 0xff) out.cadence = page[2];
      const power = page[5] | ((page[6] & 0x0f) << 8);
      if (power !== 0xfff) out.power = power;
      return out;
    }
    case PAGE_GENERAL_FE: {
      const raw = page[4] | (page[5] << 8);
      return raw === 0xffff ? {} : { speedKmh: (raw / 1000) * 3.6 };
    }
    default:
      return {};
  }
}

/**
 * Page 51 (track resistance) in an acknowledged message: grade uint16 in 0.01 % with −200 % offset,
 * rolling resistance uint8 in 5·10⁻⁵ units.
 */
export function trackResistance(gradePercent: number, crr = 0.004): Uint8Array {
  const grade = clamp(Math.round((gradePercent + 200) * 100), 0, 40000);
  const crrRaw = clamp(Math.round(crr / 5e-5), 0, 254);
  const page = [PAGE_TRACK_RESISTANCE, 0xff, 0xff, 0xff, 0xff, grade & 0xff, grade >> 8, crrRaw];
  return wrapAnt(Uint8Array.from(page), MSG_ACKNOWLEDGED);
}

export function wrapAnt(page: Uint8Array, msgId = MSG_ACKNOWLEDGED): Uint8Array {
  const msg = new Uint8Array(13);
  msg.set([SYNC, 9, msgId, CHANNEL]);
  msg.set(page, 4);
  msg[12] = checksum(msg.subarray(0, 12));
  return msg;
}

function checksum(bytes: Uint8Array): number {
  let c = 0;
  for (const b of bytes) c ^= b;
  return c;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
