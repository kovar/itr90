#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pyserial",
#     "websockets",
#     "influxdb-client",
# ]
# ///
"""
bridge.py — WebSocket ↔ Serial bridge for ITR 90 vacuum gauge.

Binary relay: raw bytes pass through unchanged in both directions.
The ITR 90 streams 9-byte binary frames continuously at ~50 Hz.

Usage:
    uv run bridge.py                        # auto-detect serial port
    uv run bridge.py /dev/cu.usbserial-10   # specify port
    uv run bridge.py COM3                   # Windows

The web app connects to ws://localhost:8765 (default).
"""

import asyncio
import getpass
import sys
import time

import serial
import serial.tools.list_ports
import websockets


BAUD_RATE = 9600
WS_HOST = "localhost"
WS_PORT = 8765
FRAME_LENGTH = 9

# InfluxDB state (set by setup_influxdb)
_influx = None  # dict with write_api, bucket, org, measurement, client
_last_influx_write = 0.0  # monotonic timestamp for throttling


def find_serial_port():
    """List available serial ports. If more than one, prompt the user to pick."""
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        return None
    if len(ports) == 1:
        print(f"Found serial port: {ports[0].device}  —  {ports[0].description}")
        return ports[0].device
    print("Multiple serial ports found:\n")
    for i, p in enumerate(ports, 1):
        print(f"  [{i}]  {p.device}  —  {p.description}")
    print()
    while True:
        try:
            choice = input(f"Type a number [1-{len(ports)}] and press Enter: ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(ports):
                return ports[idx].device
        except (ValueError, EOFError):
            pass
        print(f"  Please enter a number between 1 and {len(ports)}")


def open_serial(port_name):
    """Open serial port with ITR 90 settings (9600 8N1)."""
    return serial.Serial(
        port=port_name,
        baudrate=BAUD_RATE,
        bytesize=serial.EIGHTBITS,
        stopbits=serial.STOPBITS_ONE,
        parity=serial.PARITY_NONE,
        timeout=0.1,
    )


def setup_influxdb():
    """Interactively configure InfluxDB logging. Returns config dict or None."""
    global _influx
    try:
        answer = input("\nEnable InfluxDB logging? [y/N]: ").strip().lower()
    except EOFError:
        return None
    if answer != "y":
        return None

    from influxdb_client import InfluxDBClient

    print("\n── InfluxDB Setup ──────────────────────────────────")
    url = input("URL [http://localhost:8086]: ").strip() or "http://localhost:8086"
    org = input("Organization: ").strip()
    bucket = input("Bucket: ").strip()
    print("API Token")
    print("  (Find yours at: InfluxDB UI → Load Data → API Tokens)")
    token = getpass.getpass("  Token: ")
    measurement = input("Measurement name: ").strip()
    print("  Use snake_case, e.g. itr90_chamber1")

    if not all([org, bucket, token, measurement]):
        print("Missing required fields — InfluxDB logging disabled.")
        return None

    print("\nTesting connection... ", end="", flush=True)
    client = InfluxDBClient(url=url, token=token, org=org)
    try:
        health = client.health()
        if health.status != "pass":
            print(f"✗ ({health.message})")
            client.close()
            return None
    except Exception as e:
        print(f"✗ ({e})")
        client.close()
        return None
    print("✓")

    write_api = client.write_api()
    _influx = {
        "client": client,
        "write_api": write_api,
        "bucket": bucket,
        "org": org,
        "measurement": measurement,
    }
    print(f"InfluxDB logging enabled → {org}/{bucket}/{measurement}\n")
    return _influx


def close_influxdb():
    """Flush pending writes and close the InfluxDB client."""
    global _influx
    if _influx:
        print("Flushing InfluxDB...", end=" ", flush=True)
        try:
            _influx["write_api"].close()
            _influx["client"].close()
        except Exception:
            pass
        print("done.")
        _influx = None


def parse_itr90_frames(buf):
    """Parse ITR 90 binary frames from buffer.

    Scans for frame marker (byte 0 = 7, byte 1 = 5), validates checksum,
    calculates pressure in mbar.

    Returns (readings, remaining_buffer) where readings is a list of
    pressure_mbar floats.
    """
    readings = []
    while True:
        # Find frame marker: length=7, page=5
        idx = -1
        for i in range(len(buf) - 1):
            if buf[i] == 7 and buf[i + 1] == 5:
                idx = i
                break
        if idx < 0:
            if len(buf) > 1:
                buf = buf[-1:]
            break

        buf = buf[idx:]

        if len(buf) < FRAME_LENGTH:
            break

        frame = buf[:FRAME_LENGTH]
        buf = buf[FRAME_LENGTH:]

        # Validate checksum: low byte of sum(bytes 1-7) must equal byte 8
        checksum = sum(frame[1:8]) & 0xFF
        if checksum != frame[8]:
            continue

        # Pressure calculation: p_mbar = 10^((high*256 + low)/4000 - 12.5)
        high = frame[4]
        low = frame[5]
        raw = high * 256 + low
        pressure_mbar = 10 ** (raw / 4000 - 12.5)
        readings.append(pressure_mbar)

    return readings, buf


def write_influx_pressure(pressure_mbar):
    """Write a pressure reading to InfluxDB, throttled to ~1/sec."""
    global _last_influx_write
    if not _influx:
        return

    now = time.monotonic()
    if now - _last_influx_write < 1.0:
        return
    _last_influx_write = now

    from influxdb_client import Point

    point = (
        Point(_influx["measurement"])
        .field("pressure_mbar", pressure_mbar)
    )
    try:
        _influx["write_api"].write(
            bucket=_influx["bucket"],
            org=_influx["org"],
            record=point,
        )
    except Exception as e:
        print(f"  InfluxDB write error: {e}")


async def serial_to_ws(ser, ws):
    """Read raw bytes from serial and send as binary WebSocket frames."""
    loop = asyncio.get_event_loop()
    parse_buf = b""
    while True:
        data = await loop.run_in_executor(None, ser.read, 256)
        if data:
            try:
                await ws.send(data)
            except websockets.ConnectionClosed:
                return
            # Parse frames for InfluxDB (only if enabled)
            if _influx:
                parse_buf += data
                readings, parse_buf = parse_itr90_frames(parse_buf)
                for pressure in readings:
                    write_influx_pressure(pressure)
        else:
            await asyncio.sleep(0.01)


async def ws_to_serial(ser, ws):
    """Read binary commands from WebSocket and write to serial."""
    try:
        async for message in ws:
            if isinstance(message, bytes) and message:
                ser.write(message)
                print(f"  → Sent to gauge: [{', '.join(str(b) for b in message)}]")
    except websockets.ConnectionClosed:
        pass


async def handler(ws, ser):
    """Handle a single WebSocket connection."""
    peer = getattr(ws, "remote_address", None)
    print(f"  Client connected: {peer}")
    try:
        await asyncio.gather(
            serial_to_ws(ser, ws),
            ws_to_serial(ser, ws),
        )
    finally:
        print(f"  Client disconnected: {peer}")


async def main():
    port_name = sys.argv[1] if len(sys.argv) > 1 else find_serial_port()
    if not port_name:
        print("No serial ports found. Connect a gauge and try again,")
        print("or specify the port: uv run bridge.py /dev/cu.usbserial-10")
        sys.exit(1)

    print(f"Opening serial port: {port_name} at {BAUD_RATE} baud")
    ser = open_serial(port_name)
    print(f"Serial port opened: {ser.name}")

    setup_influxdb()

    print(f"Starting WebSocket server on ws://{WS_HOST}:{WS_PORT}")
    print("Web app can now connect via the Bridge button.\n")

    async with websockets.serve(lambda ws: handler(ws, ser), WS_HOST, WS_PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        close_influxdb()
        print("\nBridge stopped.")
