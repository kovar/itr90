/**
 * protocol.js — ITR 90 binary protocol: frame sync, parse, pressure calculation, commands.
 *
 * Output frame (gauge → host): 9 bytes, sent continuously every ~20ms
 * | Byte | Function          | Value                              |
 * |------|-------------------|------------------------------------|
 * | 0    | Length            | 7 (fixed)                          |
 * | 1    | Page number       | 5 (ITR 90)                         |
 * | 2    | Status            | emission, unit, toggle, 1000mbar   |
 * | 3    | Error             | Pirani/BA error flags               |
 * | 4    | Measurement high  | 0-255                              |
 * | 5    | Measurement low   | 0-255                              |
 * | 6    | Software version  | version * 20                       |
 * | 7    | Sensor type       | 10 (ITR 90)                        |
 * | 8    | Checksum          | low byte of sum(bytes 1-7)         |
 *
 * Pressure: p_mbar = 10^((high*256 + low)/4000 - 12.5)
 */

export const FRAME_LENGTH = 9;
export const FRAME_MARKER_LENGTH = 7;
export const FRAME_MARKER_PAGE = 5;
export const SENSOR_TYPE_ITR90 = 10;

// ── Status byte (byte 2) bit fields ────────────────────────
// Bits 0-1: emission state
const EMISSION_MASK = 0x03;
export const EMISSION = {
  0: 'off',
  1: '25 \u00B5A',   // 25 µA
  2: '5 mA',
  3: 'degas',
};

// Bits 2-3: unit
const UNIT_SHIFT = 2;
const UNIT_MASK = 0x03;
export const UNITS = {
  0: 'mbar',
  1: 'Torr',
  2: 'Pa',
};

// Bit 4: toggle bit (alternates each frame)
const TOGGLE_BIT = 4;

// Bit 5: 1000 mbar adjustment active
const ADJUST_1000_BIT = 5;

// ── Error byte (byte 3) flags ──────────────────────────────
const ERR_PIRANI_ADJ = 0x01;    // Pirani adjusted poorly
const ERR_BA_ERROR = 0x02;      // Bayard-Alpert error
const ERR_PIRANI_ERROR = 0x04;  // Pirani error

// ── Commands (host → gauge): 5-byte arrays ─────────────────
export const CMD = {
  SET_MBAR:   new Uint8Array([3, 16, 62, 0, 78]),
  SET_TORR:   new Uint8Array([3, 16, 62, 1, 79]),
  SET_PA:     new Uint8Array([3, 16, 62, 2, 80]),
  SAVE_UNIT:  new Uint8Array([3, 32, 62, 62, 156]),
  DEGAS_ON:   new Uint8Array([3, 16, 93, 148, 1]),
  DEGAS_OFF:  new Uint8Array([3, 16, 93, 105, 214]),
};

/**
 * Parse status byte into structured object.
 */
export function parseStatus(byte) {
  return {
    emission: EMISSION[byte & EMISSION_MASK] || 'unknown',
    emissionCode: byte & EMISSION_MASK,
    unit: UNITS[(byte >> UNIT_SHIFT) & UNIT_MASK] || 'mbar',
    unitCode: (byte >> UNIT_SHIFT) & UNIT_MASK,
    toggle: !!(byte & (1 << TOGGLE_BIT)),
    adjust1000: !!(byte & (1 << ADJUST_1000_BIT)),
  };
}

/**
 * Parse error byte into structured object.
 */
export function parseError(byte) {
  return {
    piraniAdjusted: !!(byte & ERR_PIRANI_ADJ),
    baError: !!(byte & ERR_BA_ERROR),
    piraniError: !!(byte & ERR_PIRANI_ERROR),
    hasError: !!(byte & (ERR_PIRANI_ADJ | ERR_BA_ERROR | ERR_PIRANI_ERROR)),
    code: byte,
  };
}

/**
 * Calculate pressure in mbar from measurement bytes.
 * p_mbar = 10^((high*256 + low)/4000 - 12.5)
 */
export function calcPressure(high, low) {
  const raw = high * 256 + low;
  return Math.pow(10, raw / 4000 - 12.5);
}

/**
 * Convert pressure from mbar to the specified unit.
 */
export function convertPressure(mbar, unit) {
  switch (unit) {
    case 'Torr': return mbar * 0.750062;
    case 'Pa':   return mbar * 100;
    default:     return mbar;
  }
}

/**
 * Validate checksum: low byte of sum(bytes 1-7) === byte 8.
 */
export function validateChecksum(frame) {
  let sum = 0;
  for (let i = 1; i <= 7; i++) sum += frame[i];
  return (sum & 0xFF) === frame[8];
}

/**
 * Parse a complete 9-byte frame into a reading object.
 * Returns null if frame is invalid.
 */
export function parseFrame(frame) {
  if (frame.length !== FRAME_LENGTH) return null;
  if (frame[0] !== FRAME_MARKER_LENGTH) return null;
  if (frame[1] !== FRAME_MARKER_PAGE) return null;
  if (!validateChecksum(frame)) return null;

  const status = parseStatus(frame[2]);
  const error = parseError(frame[3]);
  const pressureMbar = calcPressure(frame[4], frame[5]);
  const pressure = convertPressure(pressureMbar, status.unit);
  const softwareVersion = frame[6] / 20;
  const sensorType = frame[7];

  return {
    value: pressure,
    valueMbar: pressureMbar,
    unit: status.unit,
    status,
    error,
    softwareVersion,
    sensorType,
    raw: Array.from(frame),
  };
}

/**
 * FrameParser — accumulates binary data and extracts valid 9-byte frames.
 * Handles frame synchronization by scanning for the length+page marker bytes.
 */
export class FrameParser {
  #buffer = new Uint8Array(0);

  /**
   * Feed new binary data into the parser.
   * Returns an array of parsed reading objects (may be empty).
   */
  feed(data) {
    // Append new data to buffer
    const combined = new Uint8Array(this.#buffer.length + data.length);
    combined.set(this.#buffer);
    combined.set(data, this.#buffer.length);
    this.#buffer = combined;

    const readings = [];

    // Scan for frame sync: byte[i] == 7 (length) and byte[i+1] == 5 (page)
    while (this.#buffer.length >= FRAME_LENGTH) {
      // Find frame start
      let found = -1;
      for (let i = 0; i <= this.#buffer.length - FRAME_LENGTH; i++) {
        if (this.#buffer[i] === FRAME_MARKER_LENGTH && this.#buffer[i + 1] === FRAME_MARKER_PAGE) {
          found = i;
          break;
        }
      }

      if (found === -1) {
        // No valid frame start found; keep last (FRAME_LENGTH - 1) bytes
        // in case a partial frame straddles the boundary
        if (this.#buffer.length >= FRAME_LENGTH) {
          this.#buffer = this.#buffer.slice(this.#buffer.length - (FRAME_LENGTH - 1));
        }
        break;
      }

      // Discard bytes before frame start
      if (found > 0) {
        this.#buffer = this.#buffer.slice(found);
      }

      // Do we have enough bytes for a full frame?
      if (this.#buffer.length < FRAME_LENGTH) break;

      const frame = this.#buffer.slice(0, FRAME_LENGTH);
      const reading = parseFrame(frame);

      if (reading) {
        readings.push(reading);
        this.#buffer = this.#buffer.slice(FRAME_LENGTH);
      } else {
        // Bad checksum or invalid — skip this sync byte, try next
        this.#buffer = this.#buffer.slice(1);
      }
    }

    return readings;
  }

  reset() {
    this.#buffer = new Uint8Array(0);
  }
}
