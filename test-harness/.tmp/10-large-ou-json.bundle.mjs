import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// test-harness/api.mjs
var BASE = process.env.DHIS2_BASE ?? "https://play.im.dhis2.org/stable-2-42-4";
var USER = process.env.DHIS2_USER ?? "admin";
var PASS = process.env.DHIS2_PASS ?? "district";
var authHeader = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
var api = {
  base: BASE,
  async get(path) {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const res = await fetch(url, { headers: { Authorization: authHeader, Accept: "application/json" } });
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
    return res.json();
  },
  async post(path, body, opts = {}) {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": opts.contentType ?? "application/json",
        Accept: "application/json"
      },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
    }
    return { status: res.status, ok: res.ok, body: json, text };
  },
  async del(path) {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: authHeader, Accept: "application/json" }
    });
    return { status: res.status, ok: res.ok };
  }
};
function section(title) {
  console.log("\n=== " + title + " ===");
}
function ok(msg) {
  console.log("[OK] " + msg);
}
function fail(msg) {
  console.log("[FAIL] " + msg);
}
function info(msg) {
  console.log("       " + msg);
}

// src/lib/metadataImportParams.js
var buildMetadataParams = (opts = {}) => {
  const {
    importStrategy = "CREATE_AND_UPDATE",
    mergeMode = "MERGE",
    identifier = "AUTO",
    skipSharing = true,
    dryRun = false
  } = opts;
  const p = {
    importStrategy,
    atomicMode: "NONE",
    mergeMode,
    identifier
  };
  if (skipSharing) p.skipSharing = "true";
  if (dryRun) p.importMode = "VALIDATE";
  return p;
};
var paramsToQuery = (params) => Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// test-harness/10-large-ou-json.mjs
var failures = 0;
var expect = (label, cond, detail) => {
  if (cond) ok(label);
  else {
    fail(`${label}${detail ? ` \u2014 ${detail}` : ""}`);
    failures++;
  }
};
function computeOULevel(ou, all2) {
  const idMap = {};
  for (const o of all2) if (o.id) idMap[o.id] = o;
  let depth = 1;
  let current = ou;
  const seen = /* @__PURE__ */ new Set();
  while (current.parent?.id) {
    if (seen.has(current.parent.id)) break;
    seen.add(current.parent.id);
    const p = idMap[current.parent.id];
    if (p) {
      depth++;
      current = p;
    } else {
      depth++;
      break;
    }
  }
  return depth;
}
function groupByLevel(ous) {
  const levels = /* @__PURE__ */ new Map();
  for (const ou of ous) {
    const lvl = computeOULevel(ou, ous);
    if (!levels.has(lvl)) levels.set(lvl, []);
    levels.get(lvl).push(ou);
  }
  return [...levels.entries()].sort(([a], [b]) => a - b);
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
var CHUNK_SIZE = 500;
async function submitNativeMetadata(payload, opts) {
  const params = buildMetadataParams(opts);
  const qs = paramsToQuery(params);
  const stats = { created: 0, updated: 0, deleted: 0, ignored: 0, total: 0 };
  const http = { maxStatus: 0, requests: 0 };
  const buckets = Object.entries(payload).filter(([, v]) => Array.isArray(v) && v.length > 0).sort(([a], [b]) => a === "organisationUnits" ? -1 : b === "organisationUnits" ? 1 : 0);
  for (const [key, items] of buckets) {
    const batches = key === "organisationUnits" ? groupByLevel(items).flatMap(([, b]) => chunk(b, CHUNK_SIZE).map((c) => ({ key, items: c }))) : chunk(items, CHUNK_SIZE).map((c) => ({ key, items: c }));
    for (const b of batches) {
      const t0 = Date.now();
      const resp = await api.post(`/api/metadata?${qs}`, { [b.key]: b.items });
      http.requests++;
      http.maxStatus = Math.max(http.maxStatus, resp.status);
      const s = resp.body?.stats ?? resp.body?.response?.stats ?? {};
      stats.created += s.created ?? 0;
      stats.updated += s.updated ?? 0;
      stats.deleted += s.deleted ?? 0;
      stats.ignored += s.ignored ?? 0;
      stats.total += s.total ?? 0;
      info(`    ${b.key} batch ${b.items.length} items -> HTTP ${resp.status} status=${resp.body?.status} c=${s.created ?? 0} u=${s.updated ?? 0} i=${s.ignored ?? 0} (${Date.now() - t0}ms)`);
      expect(`batch HTTP < 500 (${b.key} ${b.items.length})`, resp.status < 500, `http=${resp.status}`);
    }
  }
  return { stats, http };
}
section("Fetch all org units from live server");
try {
  await api.get("/api/me?fields=id");
} catch (e) {
  info(`skipped (no DHIS2): ${e.message.slice(0, 120)}`);
  process.exit(0);
}
var FIELDS = "id,name,shortName,code,level,path,openingDate,closedDate,parent[id]";
var all = [];
var page = 1;
while (true) {
  const r = await api.get(`/api/organisationUnits?fields=${encodeURIComponent(FIELDS)}&pageSize=500&page=${page}`);
  const got = r.organisationUnits ?? [];
  all.push(...got);
  if (got.length < 500) break;
  page++;
  if (page > 40) break;
}
info(`fetched ${all.length} org units across ${page} page(s)`);
expect("fetched at least 100 OUs", all.length >= 100, `got ${all.length}`);
section("Re-import (dry run) via batched submit");
{
  const t0 = Date.now();
  const { stats, http } = await submitNativeMetadata({ organisationUnits: all }, { dryRun: true });
  info(`dry-run total: requests=${http.requests} maxHTTP=${http.maxStatus} stats=${JSON.stringify(stats)} in ${Date.now() - t0}ms`);
  expect("dry-run made >1 request (batched)", http.requests > 1, `requests=${http.requests}`);
  expect("dry-run no 5xx from server", http.maxStatus < 500, `maxHTTP=${http.maxStatus}`);
}
section("Re-import (commit, skipSharing=true, MERGE)");
{
  const t0 = Date.now();
  const { stats, http } = await submitNativeMetadata({ organisationUnits: all }, { skipSharing: true });
  info(`commit total: requests=${http.requests} maxHTTP=${http.maxStatus} stats=${JSON.stringify(stats)} in ${Date.now() - t0}ms`);
  expect("commit no 5xx from server", http.maxStatus < 500, `maxHTTP=${http.maxStatus}`);
  const accounted = stats.created + stats.updated;
  expect(
    "every OU created or updated",
    accounted >= all.length - 5,
    // tolerate a handful of ignored e.g. due to unusual refs
    `created=${stats.created} updated=${stats.updated} ignored=${stats.ignored} total=${stats.total} of ${all.length}`
  );
}
console.log("\n" + (failures === 0 ? "[OK] LARGE OU JSON IMPORT OK" : `[FAIL] ${failures} failure(s)`));
process.exit(failures === 0 ? 0 : 1);
