/**
 * ChartManager — wraps Chart.js with logarithmic Y-axis for vacuum pressure.
 * Pressure spans ~13 decades (5e-10 to 1000 mbar), so log scale is essential.
 */
export class ChartManager {
  #chart = null;
  #data = [];
  #timeWindow = 300; // seconds

  constructor(canvas) {
    const ctx = canvas.getContext('2d');
    this.#chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Pressure',
          data: this.#data,
          borderColor: getComputedStyle(document.documentElement)
            .getPropertyValue('--chart-line').trim() || '#0d9488',
          backgroundColor: getComputedStyle(document.documentElement)
            .getPropertyValue('--chart-fill').trim() || 'rgba(13,148,136,0.08)',
          borderWidth: 2,
          pointRadius: 1,
          pointHoverRadius: 5,
          tension: 0.1,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'second',
              displayFormats: { second: 'HH:mm:ss' },
            },
            title: { display: true, text: 'Time' },
          },
          y: {
            type: 'logarithmic',
            title: { display: true, text: 'Pressure (mbar)' },
            ticks: {
              callback: (value) => {
                if (value === 0) return '0';
                const exp = Math.log10(value);
                if (Number.isInteger(exp)) return '10' + superscript(exp);
                return value.toExponential(0);
              },
            },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                return `Pressure: ${v.toExponential(2)}`;
              },
            },
          },
        },
        animation: false,
      },
    });
  }

  addReading(value) {
    if (typeof value !== 'number' || isNaN(value) || value <= 0) return;
    const now = new Date();
    this.#data.push({ x: now, y: value });
    this.#prune(now);
    this.#updateColors();
    this.#chart.update('none');
  }

  clear() {
    this.#data.length = 0;
    this.#chart.update();
  }

  setTimeWindow(seconds) {
    this.#timeWindow = seconds;
    this.#prune(new Date());
    this.#chart.update();
  }

  setYRange(min, max) {
    const yScale = this.#chart.options.scales.y;
    if (min !== null && min !== undefined && min !== '') {
      yScale.min = parseFloat(min);
    } else {
      delete yScale.min;
    }
    if (max !== null && max !== undefined && max !== '') {
      yScale.max = parseFloat(max);
    } else {
      delete yScale.max;
    }
    this.#chart.update();
  }

  resetZoom() {
    delete this.#chart.options.scales.y.min;
    delete this.#chart.options.scales.y.max;
    this.#chart.update();
  }

  setYLabel(label) {
    this.#chart.options.scales.y.title.text = label;
    this.#chart.update();
  }

  destroy() {
    if (this.#chart) {
      this.#chart.destroy();
      this.#chart = null;
    }
  }

  #prune(now) {
    const cutoff = now.getTime() - this.#timeWindow * 1000;
    while (this.#data.length > 0 && this.#data[0].x.getTime() < cutoff) {
      this.#data.shift();
    }
  }

  #updateColors() {
    const style = getComputedStyle(document.documentElement);
    const ds = this.#chart.data.datasets[0];
    ds.borderColor = style.getPropertyValue('--chart-line').trim() || '#0d9488';
    ds.backgroundColor = style.getPropertyValue('--chart-fill').trim() || 'rgba(13,148,136,0.08)';
  }
}

/** Convert an integer exponent to Unicode superscript string. */
function superscript(n) {
  const map = { '-': '\u207B', '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3',
    '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079' };
  return String(n).split('').map(c => map[c] || c).join('');
}
