/**
 * main.js — Entry point for ITR 90 vacuum gauge interface.
 *
 * The ITR 90 streams data continuously at ~50 Hz. We throttle display
 * updates to ~2 Hz and chart/recording to ~1 Hz for performance.
 */
import { ConnectionManager } from './connection.js';
import { ChartManager } from './chart-manager.js';
import { Recorder } from './recorder.js';
import { StatsTracker } from './stats.js';
import { CMD, convertPressure } from './protocol.js';
import {
  setConnectionState, setRecordingState,
  updateReadout, updateStats, updateGaugeStatus,
  appendLog, showToast,
} from './ui.js';

// ── Instances ──────────────────────────────────────────────
const conn = new ConnectionManager();
let chart;
const recorder = new Recorder();
const stats = new StatsTracker();

// ── Throttle settings ──────────────────────────────────────
let sampleIntervalMs = 1000;       // user-configurable update rate
let lastDisplayTime = 0;
let lastChartTime = 0;
let lastRecordTime = 0;
let lastReadingTime = 0;

function getSampleInterval() {
  return sampleIntervalMs;
}

// ── Demo state ─────────────────────────────────────────────
let demoInterval = null;
let demoState = null;
let demoDegas = false;
let demoUnit = 'mbar';

// ── Module loaded signal ───────────────────────────────────
window._itr90ModulesLoaded = true;

// ── DOM Ready ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  wireConnection();
  wireToolbar();

  setConnectionState(false);
  setRecordingState(false);

  const serialBtn = document.getElementById('connectSerial');
  if (!conn.hasWebSerial && serialBtn) {
    serialBtn.style.display = 'none';
  }

  try {
    chart = new ChartManager(document.getElementById('chartCanvas'));
    wireChart();
  } catch (err) {
    appendLog('Chart init failed: ' + err.message);
  }
});

// ── Connection Events ──────────────────────────────────────
function wireConnection() {
  conn.addEventListener('connected', () => {
    setConnectionState(true);
    appendLog('Connected');
    showToast('Connected to gauge', 'success');
  });

  conn.addEventListener('disconnected', () => {
    setConnectionState(false);
    appendLog('Disconnected');
    showToast('Disconnected', 'info');
  });

  conn.addEventListener('reading', (e) => {
    const { value, valueMbar, unit, status, error, softwareVersion, sensorType, raw } = e.detail;
    const now = Date.now();
    lastReadingTime = now;

    // Always update gauge status (low cost)
    updateGaugeStatus(status, error, softwareVersion);

    if (value === null || value === undefined) return;

    const interval = getSampleInterval();
    const displayInterval = Math.min(interval, 500); // display at least at 2 Hz

    // Throttled display update
    if (now - lastDisplayTime >= displayInterval) {
      lastDisplayTime = now;
      updateReadout(value, unit);
    }

    // Throttled chart + stats + recording (all at sample interval)
    if (now - lastChartTime >= interval) {
      lastChartTime = now;
      lastRecordTime = now;
      // Always chart in mbar for consistent log scale
      if (chart) chart.addReading(valueMbar);
      stats.addValue(valueMbar);
      updateStats(stats.getStats());
      recorder.addReading(value, unit);
    }
  });

  conn.addEventListener('log', (e) => appendLog(e.detail.message));
  conn.addEventListener('error', (e) => {
    appendLog('ERROR: ' + e.detail.message);
    showToast(e.detail.message, 'error', 6000);
  });
}

// ── Toolbar Buttons ────────────────────────────────────────
function wireToolbar() {
  // Connect
  document.getElementById('connectSerial')?.addEventListener('click', async () => {
    try { await conn.connectSerial(); } catch (_) {}
  });

  document.getElementById('connectWs')?.addEventListener('click', async () => {
    const url = document.getElementById('wsUrl')?.value || undefined;
    try { await conn.connectWebSocket(url); } catch (_) {}
  });

  document.getElementById('disconnect')?.addEventListener('click', () => conn.disconnect());

  // Unit commands
  document.getElementById('unitMbar')?.addEventListener('click', () => {
    conn.send(CMD.SET_MBAR);
    if (demoInterval) { demoUnit = 'mbar'; updateDemoGaugeStatus(); }
    showToast('Set unit: mbar', 'info');
  });
  document.getElementById('unitTorr')?.addEventListener('click', () => {
    conn.send(CMD.SET_TORR);
    if (demoInterval) { demoUnit = 'Torr'; updateDemoGaugeStatus(); }
    showToast('Set unit: Torr', 'info');
  });
  document.getElementById('unitPa')?.addEventListener('click', () => {
    conn.send(CMD.SET_PA);
    if (demoInterval) { demoUnit = 'Pa'; updateDemoGaugeStatus(); }
    showToast('Set unit: Pa', 'info');
  });

  // Degas
  document.getElementById('degasOn')?.addEventListener('click', () => {
    conn.send(CMD.DEGAS_ON);
    if (demoInterval) {
      demoDegas = true;
      updateDemoGaugeStatus();
    }
    showToast('Degas ON', 'info');
  });
  document.getElementById('degasOff')?.addEventListener('click', () => {
    conn.send(CMD.DEGAS_OFF);
    if (demoInterval) {
      demoDegas = false;
      updateDemoGaugeStatus();
    }
    showToast('Degas OFF', 'info');
  });

  // Recording
  document.getElementById('startRecord')?.addEventListener('click', () => {
    recorder.start();
    setRecordingState(true);
    appendLog('Recording started');
    showToast('Recording started', 'info');
  });

  document.getElementById('stopRecord')?.addEventListener('click', () => {
    recorder.stop();
    setRecordingState(false);
    if (recorder.download()) {
      const msg = 'Recording saved (' + recorder.count + ' readings)';
      appendLog(msg);
      showToast(msg, 'success');
    } else {
      appendLog('No data recorded');
      showToast('No data recorded', 'error');
    }
  });

  // Sampling rate
  document.getElementById('samplingRate')?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    if (val >= 20) {
      sampleIntervalMs = val;
      appendLog(`Sample interval set to ${val} ms`);
    }
  });

  // Demo
  document.getElementById('demo')?.addEventListener('click', toggleDemo);
}

// ── Chart Controls ─────────────────────────────────────────
function wireChart() {
  document.getElementById('timeRange')?.addEventListener('change', (e) => {
    chart.setTimeWindow(parseInt(e.target.value));
  });

  document.getElementById('yMin')?.addEventListener('change', () => {
    chart.setYRange(
      document.getElementById('yMin').value,
      document.getElementById('yMax').value,
    );
  });

  document.getElementById('yMax')?.addEventListener('change', () => {
    chart.setYRange(
      document.getElementById('yMin').value,
      document.getElementById('yMax').value,
    );
  });

  document.getElementById('resetZoom')?.addEventListener('click', () => {
    chart.resetZoom();
    document.getElementById('yMin').value = '';
    document.getElementById('yMax').value = '';
  });

  document.getElementById('clearChart')?.addEventListener('click', () => {
    chart.clear();
    stats.reset();
    updateStats(stats.getStats());
  });
}

// ── Demo Mode ──────────────────────────────────────────────
function toggleDemo() {
  const btn = document.getElementById('demo');
  if (demoInterval) {
    stopDemo();
  } else {
    startDemo();
    if (btn) { btn.textContent = 'Stop Demo'; btn.classList.add('active'); }
  }
}

function updateDemoGaugeStatus() {
  const emCode = demoDegas ? 3 : 1;
  const emLabel = demoDegas ? 'degas' : '25 \u00B5A';
  const unitCode = demoUnit === 'Torr' ? 1 : demoUnit === 'Pa' ? 2 : 0;
  updateGaugeStatus(
    { emission: emLabel, emissionCode: emCode, unit: demoUnit, unitCode, toggle: false, adjust1000: false },
    { piraniAdjusted: false, baError: false, piraniError: false, hasError: false, code: 0 },
    3.2,
  );
}

function startDemo() {
  // Simulate vacuum pump-down: start at ~1 mbar, drift toward 1e-7
  demoState = { step: 0, pressure: 1 };
  demoDegas = false;
  demoUnit = 'mbar';
  setConnectionState(true);
  showToast('Demo mode \u2014 generating fake vacuum data', 'info');
  appendLog('Demo started');

  updateDemoGaugeStatus();

  demoInterval = setInterval(() => {
    demoState.step++;

    // Simulate pump-down curve with noise
    // Exponential decay toward ~1e-7, with log-scale noise
    const target = 1e-7;
    const tau = 200; // steps to decay
    demoState.pressure = target + (demoState.pressure - target) * Math.exp(-1 / tau);

    // Log-scale noise: multiply by random factor near 1
    const logNoise = Math.exp((Math.random() - 0.5) * 0.1);
    const valueMbar = demoState.pressure * logNoise;
    const displayValue = convertPressure(valueMbar, demoUnit);

    updateReadout(displayValue, demoUnit);
    if (chart) chart.addReading(valueMbar);
    stats.addValue(valueMbar);
    updateStats(stats.getStats());
    recorder.addReading(displayValue, demoUnit);
  }, getSampleInterval());
}

function stopDemo() {
  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
    demoState = null;
  }
  setConnectionState(false);
  const btn = document.getElementById('demo');
  if (btn) { btn.textContent = 'Demo'; btn.classList.remove('active'); }
  appendLog('Demo stopped');
  showToast('Demo stopped', 'info');
}
