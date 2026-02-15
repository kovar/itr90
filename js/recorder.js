/**
 * Recorder — records timestamped vacuum pressure readings and exports as CSV.
 */
export class Recorder {
  #data = [];
  #recording = false;

  get isRecording() {
    return this.#recording;
  }

  get count() {
    return this.#data.length;
  }

  start() {
    this.#data = [];
    this.#recording = true;
  }

  stop() {
    this.#recording = false;
  }

  addReading(value, unit) {
    if (!this.#recording) return;
    this.#data.push({
      timestamp: new Date().toISOString(),
      value,
      unit,
    });
  }

  download() {
    if (this.#data.length === 0) return false;
    const header = 'Timestamp,Pressure,Unit\n';
    const rows = this.#data.map(r => `${r.timestamp},${r.value},${r.unit}`).join('\n');
    const csv = header + rows + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:\-]/g, '').replace(/\..+/, '');
    a.download = `vacuum_reading_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }
}
