// Deterministic fake Prometheus for demo screenshots. It answers the
// read-only native API paths the Dashglass proxy forwards (query_range,
// query, labels, label values, series) with smooth, seeded sine data so
// the same dashboard renders identically every run — good for docs.
//
//   node fake-prometheus.mjs [port]     (default 9091)
//
// No dependencies; Node's built-in http only.
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 9091);
const INSTANCES = ["web-1", "web-2", "web-3"];
const METRIC_NAMES = [
  "up",
  "node_load1",
  "node_load5",
  "node_load15",
  "node_cpu_seconds_total",
  "node_memory_MemAvailable_bytes",
  "node_memory_MemTotal_bytes",
  "node_filesystem_avail_bytes",
  "node_network_receive_bytes_total",
  "node_network_transmit_bytes_total",
  "cpu_used",
  "mem_used_perc",
  "disk_used_perc",
  "io_read_bytes",
  "io_write_bytes",
  "net_bits_recv",
  "net_bits_sent",
  "system_load1",
  "uptime",
  "users_logged",
  "process_total",
  "container_cpu_used",
  "container_mem_used_perc",
  "container_health_status",
  "service_status",
];

// --- deterministic pseudo-randomness (seeded by a string) -----------------
function hash(string) {
  let h = 2166136261;
  for (let i = 0; i < string.length; i += 1) {
    h ^= string.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// --- shape the response from the query text -------------------------------
function pinnedInstance(query) {
  const match = query.match(/instance\s*=~?\s*"([^"|.]+)/);
  return match ? match[1] : null;
}
function metricName(query) {
  // Skip the __name__ matcher token itself ({__name__=~"cpu_…"}), so the
  // demo series get named after the actual metric.
  const match = query.replace(/__name__/g, "").match(/[a-zA-Z_:][a-zA-Z0-9_:]*/);
  return match ? match[0] : "series";
}

// A plausible base level + amplitude + soft ceiling from the metric name,
// so bytes look like bytes, a percentage stays under 100, and a load
// average looks like a load average.
function scaleFor(metric) {
  // Percentages first: "mem_used_perc" must scale like a percentage,
  // not like the bytes its "mem" prefix suggests.
  if (/rate|cpu|util|percent|perc\b|_perc/i.test(metric))
    return { base: 42, amp: 30, cap: 100 };
  if (/bytes|mem/i.test(metric)) return { base: 4.2e9, amp: 1.1e9, cap: 8e9 };
  if (/load/i.test(metric)) return { base: 1.4, amp: 0.9, cap: 6 };
  return { base: 55, amp: 25, cap: 100 };
}

function seriesFor(query) {
  const metric = metricName(query);
  const instance = pinnedInstance(query);
  if (instance) {
    // A pinned (repeated) panel: split into a couple of modes so the chart
    // has more than one line.
    return ["user", "system"].map((mode) => ({
      metric: { __name__: metric, instance, mode },
      key: `${query}|${instance}|${mode}`,
    }));
  }
  return INSTANCES.map((inst) => ({
    metric: { __name__: metric, instance: inst },
    key: `${query}|${inst}`,
  }));
}

// A seeded, organic-looking series: mean-reverting random walk pulled toward
// a slowly drifting target (two harmonics, so it never looks like a clean
// sine), plus gaussian noise and occasional decaying spikes. Deterministic
// per series key, so the same dashboard renders identically every run.
function walk(key, metric, start, stepSecs, count) {
  const { base, amp, cap } = scaleFor(metric);
  const rand = rng(hash(key));
  const gauss = () => rand() + rand() + rand() - 1.5; // ~N(0, 0.5)
  const phase = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const ceiling = cap ?? base + amp * 2;
  let value = base + amp * 0.4 * Math.sin(phase);
  let spike = 0;
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const t = start + i * stepSecs;
    const target =
      base +
      amp * 0.45 * Math.sin(t / 2400 + phase) +
      amp * 0.18 * Math.sin(t / 780 + phase2);
    value += 0.18 * (target - value) + amp * 0.05 * gauss();
    if (rand() < 0.012) spike += amp * (0.5 + rand() * 0.6); // transient burst
    spike *= 0.72; // …that decays over the next few points
    let sample = value + spike;
    if (sample < 0) sample = Math.abs(sample) * 0.3; // reflect off zero
    if (sample > ceiling) sample = ceiling - (sample - ceiling) * 0.3;
    values.push([t, sample.toFixed(3)]);
  }
  return values;
}

function rangeMatrix(query, start, end, step) {
  const stepSecs = Math.max(step, 1);
  const count = Math.min(500, Math.floor((end - start) / stepSecs) + 1);
  return {
    resultType: "matrix",
    result: seriesFor(query).map((s) => ({
      metric: s.metric,
      values: walk(s.key, s.metric.__name__, start, stepSecs, count),
    })),
  };
}

function instantVector(query, now) {
  return {
    resultType: "vector",
    result: seriesFor(query).map((s) => {
      const values = walk(s.key, s.metric.__name__, now - 3600, 60, 61);
      return { metric: s.metric, value: [now, values[values.length - 1][1]] };
    }),
  };
}

// --- HTTP -----------------------------------------------------------------
function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "success", data }));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const now = Math.floor(Date.now() / 1000);

  const readParams = (cb) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => cb(new URLSearchParams(body)));
    } else {
      cb(url.searchParams);
    }
  };

  if (path === "/api/v1/query_range") {
    return readParams((p) => {
      const start = Math.floor(Number(p.get("start")) || now - 3600);
      const end = Math.floor(Number(p.get("end")) || now);
      const step = Math.floor(Number(p.get("step")) || 60);
      ok(res, rangeMatrix(p.get("query") ?? "", start, end, step));
    });
  }
  if (path === "/api/v1/query") {
    return readParams((p) => ok(res, instantVector(p.get("query") ?? "", now)));
  }
  if (path === "/api/v1/labels") {
    return ok(res, ["__name__", "instance", "job", "mode"]);
  }
  if (path.startsWith("/api/v1/label/") && path.endsWith("/values")) {
    const name = path.slice("/api/v1/label/".length, -"/values".length);
    if (name === "instance") return ok(res, INSTANCES);
    if (name === "job") return ok(res, ["node", "dashglass"]);
    if (name === "mode") return ok(res, ["user", "system", "idle"]);
    // A plausible metric list, so the Explore metrics browser has
    // something to show in demos and screenshots.
    if (name === "__name__") return ok(res, METRIC_NAMES);
    return ok(res, []);
  }
  if (path === "/api/v1/series") {
    return ok(
      res,
      INSTANCES.map((instance) => ({ __name__: "up", instance, job: "node" })),
    );
  }
  if (path === "/api/v1/metadata") return ok(res, {});

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "error", error: `no route ${path}` }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake-prometheus listening on http://127.0.0.1:${PORT}`);
});
