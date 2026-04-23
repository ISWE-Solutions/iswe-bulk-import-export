import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// test-harness/08-full-metadata-json.mjs
import fs from "node:fs";

// src/lib/fileParser.js
import * as XLSX from "xlsx";
function parseNativeJsonPayload(text2, importType) {
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch (e) {
    throw new Error(`Not valid JSON: ${e.message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON root must be an object.");
  }
  if (importType === "tracker") {
    const tes = parsed.trackedEntities;
    if (!Array.isArray(tes) || tes.length === 0) {
      throw new Error(
        'Tracker JSON must contain a non-empty "trackedEntities" array at the root. Example: { "trackedEntities": [ { "trackedEntityType": "...", "orgUnit": "...", "attributes": [...], "enrollments": [...] } ] }'
      );
    }
    let enrCount = 0;
    let eventCount = 0;
    for (const te of tes) {
      if (!te || typeof te !== "object") {
        throw new Error("Each tracked entity must be an object.");
      }
      for (const enr of te.enrollments ?? []) {
        enrCount++;
        eventCount += (enr.events ?? []).length;
      }
    }
    return {
      payload: { trackedEntities: tes },
      summary: {
        "Tracked entities": tes.length,
        Enrollments: enrCount,
        Events: eventCount
      }
    };
  }
  if (importType === "event") {
    const events = parsed.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error(
        'Event JSON must contain a non-empty "events" array at the root. Example: { "events": [ { "program": "...", "programStage": "...", "orgUnit": "...", "occurredAt": "YYYY-MM-DD", "dataValues": [...] } ] }'
      );
    }
    return {
      payload: { events },
      summary: { Events: events.length }
    };
  }
  if (importType === "dataEntry") {
    const dvs = parsed.dataValues;
    if (!Array.isArray(dvs) || dvs.length === 0) {
      throw new Error(
        'Aggregate JSON must contain a non-empty "dataValues" array. Example: { "dataSet": "UID", "dataValues": [ { "dataElement": "...", "period": "...", "orgUnit": "...", "value": "..." } ] }'
      );
    }
    const orgUnits = new Set(dvs.map((d) => d.orgUnit).filter(Boolean));
    const periods = new Set(dvs.map((d) => d.period).filter(Boolean));
    return {
      payload: parsed.dataSet ? { dataSet: parsed.dataSet, dataValues: dvs } : { dataValues: dvs },
      summary: {
        "Data values": dvs.length,
        "Org units": orgUnits.size,
        Periods: periods.size
      }
    };
  }
  if (importType === "metadata") {
    const summary = {};
    let total2 = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.length > 0) {
        summary[k] = v.length;
        total2 += v.length;
      }
    }
    if (total2 === 0) {
      throw new Error(
        'Metadata JSON must contain at least one non-empty array of metadata objects (e.g. "dataElements", "optionSets", "organisationUnits").'
      );
    }
    return { payload: parsed, summary };
  }
  throw new Error(`Unsupported import type: ${importType}`);
}

// test-harness/api.mjs
var BASE = process.env.DHIS2_BASE ?? "https://play.im.dhis2.org/stable-2-42-4";
var USER = process.env.DHIS2_USER ?? "admin";
var PASS = process.env.DHIS2_PASS ?? "district";
var authHeader = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
var api = {
  base: BASE,
  async get(path2) {
    const url = path2.startsWith("http") ? path2 : `${BASE}${path2}`;
    const res = await fetch(url, { headers: { Authorization: authHeader, Accept: "application/json" } });
    if (!res.ok) throw new Error(`GET ${path2} -> ${res.status} ${await res.text()}`);
    return res.json();
  },
  async post(path2, body, opts = {}) {
    const url = path2.startsWith("http") ? path2 : `${BASE}${path2}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": opts.contentType ?? "application/json",
        Accept: "application/json"
      },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
    const text2 = await res.text();
    let json = null;
    try {
      json = text2 ? JSON.parse(text2) : null;
    } catch {
    }
    return { status: res.status, ok: res.ok, body: json, text: text2 };
  },
  async del(path2) {
    const url = path2.startsWith("http") ? path2 : `${BASE}${path2}`;
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

// test-harness/08-full-metadata-json.mjs
var failures = 0;
var expect = (label, cond) => {
  if (cond) ok(label);
  else {
    fail(label);
    failures++;
  }
};
var path = process.env.FULL_META ?? "/tmp/full-all.json";
if (!fs.existsSync(path)) {
  info(`no file at ${path}, skipping`);
  process.exit(0);
}
section("Parse full metadata export");
var text = fs.readFileSync(path, "utf8");
var r = parseNativeJsonPayload(text, "metadata");
var buckets = Object.keys(r.summary).length;
var total = Object.values(r.summary).reduce((a, b) => a + b, 0);
info(`file size: ${(text.length / 1024 / 1024).toFixed(1)} MB`);
info(`buckets: ${buckets}`);
info(`objects: ${total}`);
expect("parsed >= 1 bucket", buckets >= 1);
expect("parsed >= 1 object", total >= 1);
info(`top 6 buckets: ${Object.entries(r.summary).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(", ")}`);
section("DHIS2 dry-run on a small subset");
try {
  await api.get("/api/me?fields=id");
  const entries = Object.entries(r.payload).filter(([, v]) => Array.isArray(v) && v.length > 0).slice(0, 2);
  const subset = {};
  for (const [k, v] of entries) subset[k] = v.slice(0, 10);
  const resp = await api.post(
    "/api/metadata?importStrategy=CREATE_AND_UPDATE&atomicMode=NONE&importMode=VALIDATE",
    subset
  );
  info(`HTTP ${resp.status} status=${resp.body?.status}`);
  expect("server accepted payload (200)", resp.status === 200);
  expect("server status = OK or WARNING", ["OK", "WARNING"].includes(resp.body?.status));
  if (resp.body?.typeReports) {
    for (const tr of resp.body.typeReports) {
      info(`  ${tr.klass}: ${JSON.stringify(tr.stats)}`);
    }
  }
} catch (e) {
  info(`skipped (no live DHIS2): ${e.message.slice(0, 120)}`);
}
console.log("\n" + (failures === 0 ? "[OK] FULL METADATA JSON IMPORT OK" : `[FAIL] ${failures} failure(s)`));
process.exit(failures === 0 ? 0 : 1);
