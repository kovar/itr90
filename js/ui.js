/**
 * UI helpers — button states, pressure formatting, status display.
 * Theme is handled by inline script in index.html.
 */

export function setConnectionState(connected) {
  const dot = document.getElementById('statusDot');
  const connectSerialBtn = document.getElementById('connectSerial');
  const connectWsBtn = document.getElementById('connectWs');
  const disconnectBtn = document.getElementById('disconnect');
  const wsUrlInput = document.getElementById('wsUrl');

  if (dot) dot.classList.toggle('connected', connected);

  if (connectSerialBtn) connectSerialBtn.disabled = connected;
  if (connectWsBtn) connectWsBtn.disabled = connected;
  if (disconnectBtn) disconnectBtn.disabled = !connected;
  if (wsUrlInput) wsUrlInput.disabled = connected;

  const cmdBtns = document.querySelectorAll('[data-requires-connection]');
  cmdBtns.forEach(btn => btn.disabled = !connected);
}

export function setRecordingState(active) {
  const startBtn = document.getElementById('startRecord');
  const stopBtn = document.getElementById('stopRecord');
  if (startBtn) {
    startBtn.disabled = active;
    startBtn.classList.toggle('active', false);
  }
  if (stopBtn) {
    stopBtn.disabled = !active;
    stopBtn.classList.toggle('active', active);
  }
}

/**
 * Format a pressure value in scientific notation.
 * e.g. 1.23e-5 → "1.23 × 10⁻⁵"
 */
export function formatPressure(value) {
  if (value === null || value === undefined) return '---';
  if (typeof value !== 'number' || isNaN(value)) return String(value);
  if (value === 0) return '0';

  const exp = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / Math.pow(10, exp);

  if (exp >= -1 && exp <= 3) {
    // For values near 1, show plain decimal
    return value.toPrecision(3);
  }

  const supMap = { '-': '\u207B', '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3',
    '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079' };
  const sup = String(exp).split('').map(c => supMap[c] || c).join('');

  return `${mantissa.toFixed(2)} \u00D7 10${sup}`;
}

/**
 * Format pressure in compact exponential for stats display.
 */
export function formatPressureCompact(value) {
  if (value === null || value === undefined) return '---';
  if (typeof value !== 'number' || isNaN(value)) return '---';
  return value.toExponential(2);
}

export function updateReadout(value, unit) {
  const valEl = document.getElementById('readoutValue');
  const unitEl = document.getElementById('readoutUnit');
  const timeEl = document.getElementById('readoutTime');
  if (valEl) valEl.textContent = formatPressure(value);
  if (unitEl) unitEl.textContent = unit || '';
  if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
}

export function updateStats(stats) {
  const fmt = (v) => v === null ? '---' : v.toExponential(2);
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmt(v);
  };
  set('statMin', stats.min);
  set('statMax', stats.max);
  set('statMean', stats.mean);
  const countEl = document.getElementById('statCount');
  if (countEl) countEl.textContent = stats.count;
}

export function updateGaugeStatus(status, error, softwareVersion) {
  const emissionEl = document.getElementById('emissionState');
  const errorEl = document.getElementById('errorState');
  const versionEl = document.getElementById('firmwareVersion');

  if (emissionEl && status) {
    emissionEl.textContent = status.emission;
    emissionEl.className = 'status-value emission-' + status.emissionCode;
  }

  if (errorEl && error) {
    if (error.hasError) {
      const errors = [];
      if (error.piraniAdjusted) errors.push('Pirani adj.');
      if (error.baError) errors.push('BA error');
      if (error.piraniError) errors.push('Pirani error');
      errorEl.textContent = errors.join(', ');
      errorEl.classList.add('has-error');
    } else {
      errorEl.textContent = 'OK';
      errorEl.classList.remove('has-error');
    }
  }

  if (versionEl && softwareVersion !== undefined) {
    versionEl.textContent = 'v' + softwareVersion.toFixed(1);
  }

  // Highlight degas button when degas is active (emissionCode 3)
  const degasOnBtn = document.getElementById('degasOn');
  if (degasOnBtn && status) {
    degasOnBtn.classList.toggle('active', status.emissionCode === 3);
  }
}

export function appendLog(message) {
  const el = document.getElementById('logOutput');
  if (!el) return;
  const now = new Date().toLocaleTimeString();
  el.textContent += `[${now}] ${message}\n`;
  el.scrollTop = el.scrollHeight;
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  const dismiss = () => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove());
  };
  el.addEventListener('click', dismiss);
  if (duration > 0) setTimeout(dismiss, duration);
}
