# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Web application for communicating with a Pfeiffer Vacuum ITR 90 FullRange Bayard-Alpert gauge. Reads vacuum pressure over serial (or WebSocket bridge), displays live readings with logarithmic chart, and exports to CSV. The ITR 90 uses a binary RS232C protocol and streams data continuously at ~50 Hz.

## Architecture

```
index.html              → HTML shell (links CSS + JS modules, CDN scripts)
css/styles.css          → All styles, CSS custom properties for dark/light theming
js/
  main.js               → Entry point: imports modules, wires DOM events
  protocol.js           → ITR 90 binary protocol: frame sync, parse, pressure calc, commands
  serial.js             → WebSerialTransport (Web Serial API, Chromium only)
  websocket.js          → WebSocketTransport (connects to bridge.py)
  connection.js         → ConnectionManager: picks transport, uniform event interface
  chart-manager.js      → ChartManager wrapping Chart.js with logarithmic Y-axis
  recorder.js           → Recorder with Blob-based CSV export
  stats.js              → StatsTracker (Welford's algorithm for live statistics)
  ui.js                 → Theme toggle, connection badge, button states, pressure formatting

bridge.py               → WebSocket ↔ serial bridge (pyserial + websockets, binary relay)
serve.py                → Local dev server

.github/workflows/static.yml → GitHub Pages deployment (deploys on push to main)
```

No build step. No npm. ES modules loaded via `<script type="module">`. Chart.js + date adapter loaded from CDN with pinned versions.

## ITR 90 Protocol

**Key difference from text-based protocols:** The ITR 90 streams 9-byte binary frames continuously every ~20ms. No polling needed.

**Serial config:** 9600 baud, 8N1, no handshake.

**Output frame (gauge → host):** 9 bytes
- Byte 0: Length (always 7)
- Byte 1: Page number (always 5 for ITR 90)
- Byte 2: Status (emission bits, unit bits, toggle bit, 1000mbar adj)
- Byte 3: Error (Pirani/BA error flags)
- Byte 4-5: Measurement (high, low)
- Byte 6: Software version (value * 20)
- Byte 7: Sensor type (10 = ITR 90)
- Byte 8: Checksum (low byte of sum bytes 1-7)

**Pressure calculation:** `p_mbar = 10^((high*256 + low)/4000 - 12.5)`

**Commands (host → gauge):** 5-byte binary arrays (unit selection, degas on/off).

## Transport Layer

Two transport backends implement the same EventTarget interface:
- **Web Serial** (`serial.js`) — direct USB access in Chromium browsers
- **WebSocket** (`websocket.js`) — connects to `bridge.py` for Firefox/Safari

Both use `protocol.js` for frame parsing. `ConnectionManager` auto-detects capabilities.

## Running

**Web UI:**
```bash
uv run serve.py     # starts http://localhost:8001 and opens browser
```

**WebSocket Bridge (for non-Chromium browsers):**
```bash
uv run bridge.py                        # auto-detect serial port
uv run bridge.py /dev/cu.usbserial-10   # specify port
```
Dependencies (`pyserial`, `websockets`, `influxdb-client`) are declared inline via PEP 723 — `uv` installs them automatically.

**Optional InfluxDB logging:**
The bridge can optionally log pressure readings to InfluxDB 2.x. At startup it prompts `Enable InfluxDB logging? [y/N]` — answering N (or pressing Enter) skips it entirely. If enabled, it parses ITR 90 binary frames in a side buffer and writes points with `fields={pressure_mbar: float}` using the batching `WriteApi`. Writes are throttled to ~1/sec (the gauge streams at 50 Hz). Raw bytes are still relayed unchanged to the WebSocket.

## Performance

The gauge streams at ~50 Hz but the UI throttles:
- Display update: ~2 Hz (500ms)
- Chart points: ~1 Hz (1000ms)
- CSV recording: ~1 Hz (1000ms)
