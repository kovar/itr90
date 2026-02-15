# ITR 90 Vacuum Gauge Interface

Web application for communicating with a Pfeiffer Vacuum ITR 90 FullRange Bayard-Alpert gauge. Displays live vacuum pressure readings on a logarithmic chart, supports unit switching and degas control, and exports to CSV. The ITR 90 streams 9-byte binary frames continuously at ~50 Hz — no polling needed.

![Screenshot — dark mode demo](https://img.shields.io/badge/no_build_step-ES_modules-teal)

## Features

- **Live pressure readout** in scientific notation (5 x 10⁻¹⁰ to 1000 mbar)
- **Logarithmic chart** spanning 13 decades of pressure
- **Running statistics** — min, max, mean, count (Welford's algorithm)
- **CSV recording** — timestamped pressure export
- **Unit switching** — mbar, Torr, Pa (sent as commands to the gauge)
- **Degas control** — on/off with visual indicator
- **Gauge status display** — emission state, error flags, firmware version
- **Two connection modes** — USB (Web Serial) or WebSocket bridge
- **Dark/light theme** — auto-detects OS preference
- **Demo mode** — simulates a pump-down curve without hardware
- **Configurable sample interval** — throttle the 50 Hz stream to your needs

## Quick Start

```bash
uv run serve.py
```

This starts a local server at **http://localhost:8001** and opens your browser.

> Don't open `index.html` directly — ES modules require a web server.

### Connect to your gauge

- **Chrome/Edge:** Click **USB** to connect directly via Web Serial API
- **Firefox/Safari/remote:** Start the bridge, then click **Bridge**:
  ```bash
  uv run bridge.py                        # auto-detect serial port
  uv run bridge.py /dev/cu.usbserial-10   # specify port
  ```
- **No hardware:** Click **Demo** to simulate a vacuum pump-down

## Architecture

No build step, no npm, no bundler. Plain ES modules served over HTTP. Chart.js loaded from CDN.

```
index.html          HTML shell
css/styles.css      Styles with CSS custom properties for theming
js/
  main.js           Entry point, event wiring, throttling
  protocol.js       Binary protocol: frame sync, checksum, pressure calc, commands
  serial.js         Web Serial transport (Chromium only)
  websocket.js      WebSocket transport (connects to bridge.py)
  connection.js     ConnectionManager — uniform event interface
  chart-manager.js  Chart.js wrapper with logarithmic Y-axis
  recorder.js       CSV recording and Blob-based download
  stats.js          Welford's online statistics
  ui.js             Scientific notation formatting, gauge status, toasts
bridge.py           Binary WebSocket-to-serial relay (pyserial + websockets)
serve.py            Local dev server
```

## ITR 90 Protocol

Serial config: 9600 baud, 8N1, no handshake.

### Output frame (gauge to host): 9 bytes, continuous at ~50 Hz

| Byte | Function | Value |
|------|----------|-------|
| 0 | Length | 7 (fixed) |
| 1 | Page number | 5 (ITR 90) |
| 2 | Status | emission, unit, toggle, 1000 mbar adj |
| 3 | Error | Pirani / BA error flags |
| 4-5 | Measurement | high byte, low byte |
| 6 | Software version | version x 20 |
| 7 | Sensor type | 10 (ITR 90) |
| 8 | Checksum | low byte of sum(bytes 1-7) |

### Pressure calculation

```
p_mbar = 10^((high * 256 + low) / 4000 - 12.5)
```

### Commands (host to gauge): 5-byte binary

| Command | Bytes |
|---------|-------|
| Set mbar | `[3, 16, 62, 0, 78]` |
| Set Torr | `[3, 16, 62, 1, 79]` |
| Set Pa | `[3, 16, 62, 2, 80]` |
| Degas on | `[3, 16, 93, 148, 1]` |
| Degas off | `[3, 16, 93, 105, 214]` |

The full protocol reference is built into the app.

## Performance

The gauge streams at ~50 Hz but the UI throttles for performance:

| Function | Default rate |
|----------|-------------|
| Display update | ~2 Hz |
| Chart points | ~1 Hz |
| CSV recording | ~1 Hz |

The sample interval is configurable from the toolbar.

## Dependencies

**Browser:** None — everything loads from CDN or is vanilla JS.

**Python tools** (managed automatically by `uv` via PEP 723 inline metadata):
- `bridge.py` — `pyserial`, `websockets`
- `serve.py` — stdlib only

## Deployment

Deployed to GitHub Pages on push to `main` via `.github/workflows/static.yml`.
