/**
 * WebSerialTransport — Web Serial API transport for ITR 90 (Chromium only).
 *
 * The ITR 90 streams 9-byte binary frames continuously (~50 Hz).
 * No polling needed — we just listen and parse.
 *
 * Events emitted:
 *   'connected'    — serial port opened
 *   'disconnected' — serial port closed
 *   'reading'      — { value, valueMbar, unit, status, error, softwareVersion, sensorType, raw }
 *   'log'          — { message }
 *   'error'        — { message }
 */
import { FrameParser, CMD } from './protocol.js';

export class WebSerialTransport extends EventTarget {
  #port = null;
  #writer = null;
  #reader = null;
  #readLoopRunning = false;
  #parser = new FrameParser();

  static isSupported() {
    return 'serial' in navigator;
  }

  async connect() {
    try {
      this.#port = await navigator.serial.requestPort();
      await this.#port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
      this.#writer = this.#port.writable.getWriter();
      this.#parser.reset();
      this.#emit('connected');
      this.#emit('log', { message: 'Serial port opened (9600 8N1)' });
      this.#readLoop();
    } catch (err) {
      this.#emit('error', { message: 'Connect failed: ' + err.message });
      throw err;
    }
  }

  async disconnect() {
    this.#readLoopRunning = false;
    try {
      if (this.#reader) {
        await this.#reader.cancel();
        this.#reader.releaseLock();
        this.#reader = null;
      }
    } catch (_) {}
    try {
      if (this.#writer) {
        this.#writer.releaseLock();
        this.#writer = null;
      }
    } catch (_) {}
    try {
      if (this.#port) {
        await this.#port.close();
        this.#port = null;
      }
    } catch (err) {
      this.#emit('error', { message: 'Close error: ' + err.message });
    }
    this.#emit('disconnected');
    this.#emit('log', { message: 'Serial port closed' });
  }

  /**
   * Send a 5-byte binary command to the gauge.
   * @param {Uint8Array} cmd - command bytes from CMD constants
   */
  async send(cmd) {
    if (!this.#writer) {
      this.#emit('error', { message: 'Not connected' });
      return;
    }
    if (cmd instanceof Uint8Array) {
      await this.#writer.write(cmd);
      this.#emit('log', { message: 'Sent: [' + Array.from(cmd).join(', ') + ']' });
    }
  }

  async #readLoop() {
    const GRACE_MS = 5000;
    const RETRY_MS = 500;
    this.#readLoopRunning = true;
    let graceStart = null;

    while (this.#readLoopRunning) {
      try {
        this.#reader = this.#port.readable.getReader();
        this.#parser.reset(); // discard any stale partial frame from before the hiccup
        graceStart = null; // reader acquired — reset grace timer
        while (this.#readLoopRunning) {
          const { value, done } = await this.#reader.read();
          if (done) break;
          if (value) {
            const readings = this.#parser.feed(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
            for (const reading of readings) {
              this.#emit('reading', reading);
            }
          }
        }
      } catch (err) {
        if (!this.#readLoopRunning) break;
        const now = Date.now();
        if (graceStart === null) {
          graceStart = now;
          this.#emit('log', { message: 'Serial hiccup — retrying for up to 5 s…' });
        }
        if (now - graceStart < GRACE_MS) {
          await new Promise(r => setTimeout(r, RETRY_MS));
        } else {
          this.#emit('error', { message: 'Read error: ' + err.message });
          break;
        }
      } finally {
        try { this.#reader?.releaseLock(); } catch (_) {}
        this.#reader = null;
      }
    }
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
