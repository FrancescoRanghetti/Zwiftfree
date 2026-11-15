/** Bluetooth Heart Rate Service. */
export const HR_SERVICE = 0x180d;
export const HR_MEASUREMENT = 0x2a37;

/** Heart Rate Measurement (0x2A37): flag bit 0 selects uint8 or uint16 for the value. */
export function parseHeartRate(view: DataView): number {
  const flags = view.getUint8(0);
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
}
