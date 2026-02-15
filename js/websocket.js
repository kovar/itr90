/**
 * WebSocketTransport — connects to bridge.py for non-Chromium browsers.
 * Receives binary frames and parses them using the shared FrameParser.
 *
 * Events emitted (same interface as WebSerialTransport):
 *   'connected', 'disconnected', 'reading', 'log', 'error'
 */
import { FrameParser } from './protocol.js';

export class WebSocketTransport extends EventTarget {
  #ws = null;
  #url = '';
  #shouldReconnect = false;
  #reconnectTimer = null;
  #parser = new FrameParser();
  static DEFAULT_URL = 'ws://localhost:8765';

  async connect(url) {
    this.#url = url || WebSocketTransport.DEFAULT_URL;
    this.#shouldReconnect = true;
    this.#parser.reset();
    return this.#open();
  }

  #open() {
    return new Promise((resolve, reject) => {
      this.#emit('log', { message: 'Connecting to ' + this.#url + '...' });
      this.#ws = new WebSocket(this.#url);
      this.#ws.binaryType = 'arraybuffer';

      this.#ws.onopen = () => {
        this.#emit('connected');
        this.#emit('log', { message: 'WebSocket connected to ' + this.#url });
        resolve();
      };

      this.#ws.onerror = () => {
        const msg = 'Connection failed \u2014 run `uv run bridge.py` in a terminal first';
        this.#emit('error', { message: msg });
        this.#shouldReconnect = false;
        reject(new Error(msg));
      };

      this.#ws.onclose = () => {
        this.#emit('disconnected');
        this.#emit('log', { message: 'WebSocket closed' });
        if (this.#shouldReconnect) {
          this.#emit('log', { message: 'Reconnecting in 3s...' });
          this.#reconnectTimer = setTimeout(() => this.#open().catch(() => {}), 3000);
        }
      };

      this.#ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const data = new Uint8Array(event.data);
          const readings = this.#parser.feed(data);
          for (const reading of readings) {
            this.#emit('reading', reading);
          }
        }
      };
    });
  }

  async disconnect() {
    this.#shouldReconnect = false;
    clearTimeout(this.#reconnectTimer);
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  /**
   * Send a binary command to the gauge via WebSocket.
   * @param {Uint8Array} cmd - command bytes
   */
  async send(cmd) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      this.#emit('error', { message: 'WebSocket not connected' });
      return;
    }
    if (cmd instanceof Uint8Array) {
      this.#ws.send(cmd.buffer);
      this.#emit('log', { message: 'Sent: [' + Array.from(cmd).join(', ') + ']' });
    }
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
