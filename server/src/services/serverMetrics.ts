/**
 * In-memory Prometheus metrics collector for Express server.
 * Tracks HTTP requests, latencies, status codes, and server errors.
 */

export interface MetricSample {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

const counters: Map<string, number> = new Map();
const gauges: Map<string, number> = new Map();
const samples: MetricSample[] = [];
const MAX_SAMPLES = 4000;

function encodeValue(value: string | number): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labelsString(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([k, v]) => `${k}="${encodeValue(v)}"`).join(",")}}`;
}

function seriesKey(name: string, labels: Record<string, string>): string {
  const encoded = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${name}{${encoded}}`;
}

export const serverMetrics = {
  emit(name: string, value: number = 1, labels: Record<string, string> = {}) {
    const key = seriesKey(name, labels);
    if (name.endsWith("_total") || name.endsWith("_health")) {
      counters.set(key, (counters.get(key) ?? 0) + value);
    } else {
      gauges.set(key, value);
    }

    samples.push({ name, value, labels, timestamp: Date.now() });
    if (samples.length > MAX_SAMPLES) {
      samples.splice(0, samples.length - MAX_SAMPLES);
    }
  },

  snapshot(): MetricSample[] {
    return samples.slice();
  },

  toPrometheus(): string {
    const lines: string[] = ["# PromptMint server metrics"];
    for (const [key, value] of counters) {
      const name = key.slice(0, key.indexOf("{"));
      const encoded = key.slice(key.indexOf("{") + 1, -1);
      const labels: Record<string, string> = {};
      if (encoded) {
        for (const part of encoded.split(",")) {
          const eq = part.indexOf("=");
          if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1);
        }
      }
      lines.push(`${name}${labelsString(labels)} ${value}`);
    }
    for (const [key, value] of gauges) {
      const name = key.slice(0, key.indexOf("{"));
      const encoded = key.slice(key.indexOf("{") + 1, -1);
      const labels: Record<string, string> = {};
      if (encoded) {
        for (const part of encoded.split(",")) {
          const eq = part.indexOf("=");
          if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1);
        }
      }
      lines.push(`${name}${labelsString(labels)} ${value}`);
    }
    return `${lines.join("\n")}\n`;
  },

  _resetForTests() {
    counters.clear();
    gauges.clear();
    samples.length = 0;
  },
};
