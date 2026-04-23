import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/lib/fileParser.js
import * as XLSX from "xlsx";
function parseNativeJsonPayload(text, importType) {
  let parsed;
  try {
    parsed = JSON.parse(text);
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
    let total = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.length > 0) {
        summary[k] = v.length;
        total += v.length;
      }
    }
    if (total === 0) {
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

// test-harness/07-json-io.mjs
var failures = 0;
var expect = (label, cond, detail = "") => {
  if (cond) {
    ok(label);
  } else {
    fail(label + (detail ? ` -- ${detail}` : ""));
    failures++;
  }
};
var expectThrow = (label, fn, msgPart) => {
  try {
    fn();
    fail(label + " -- expected throw");
    failures++;
  } catch (e) {
    const msg = String(e.message || "");
    if (!msgPart || msg.toLowerCase().includes(msgPart.toLowerCase())) ok(label);
    else {
      fail(label + ` -- wrong message: ${msg}`);
      failures++;
    }
  }
};
section("parseNativeJsonPayload \u2014 tracker");
{
  const payload = {
    trackedEntities: [{
      trackedEntityType: "nEenWmSyUEp",
      orgUnit: "DiszpKrYNg8",
      attributes: [{ attribute: "w75KJ2mc4zz", value: "Jane" }],
      enrollments: [{
        program: "IpHINAT79UW",
        orgUnit: "DiszpKrYNg8",
        enrolledAt: "2026-01-01",
        occurredAt: "2026-01-01",
        events: [
          { programStage: "A03MvHHogjR", orgUnit: "DiszpKrYNg8", occurredAt: "2026-01-05", status: "COMPLETED", dataValues: [] },
          { programStage: "A03MvHHogjR", orgUnit: "DiszpKrYNg8", occurredAt: "2026-02-05", status: "COMPLETED", dataValues: [] }
        ]
      }]
    }]
  };
  const r = parseNativeJsonPayload(JSON.stringify(payload), "tracker");
  expect("returns payload object", !!r.payload && Array.isArray(r.payload.trackedEntities));
  expect("summary has TEI count = 1", r.summary && String(r.summary["Tracked entities"]) === "1");
  expect("summary has Enrollments = 1", r.summary && String(r.summary["Enrollments"]) === "1");
  expect("summary has Events = 2", r.summary && String(r.summary["Events"]) === "2");
  expectThrow("rejects invalid JSON", () => parseNativeJsonPayload("{not json", "tracker"), "json");
  expectThrow("rejects empty trackedEntities", () => parseNativeJsonPayload(JSON.stringify({ trackedEntities: [] }), "tracker"), "trackedEntities");
  expectThrow("rejects missing key", () => parseNativeJsonPayload(JSON.stringify({}), "tracker"), "trackedEntities");
}
section("parseNativeJsonPayload \u2014 event (program without registration)");
{
  const payload = {
    events: [
      { program: "lxAQ7Zs9VYR", programStage: "Zj7UnCAulEk", orgUnit: "DiszpKrYNg8", occurredAt: "2026-03-01", status: "COMPLETED", dataValues: [] },
      { program: "lxAQ7Zs9VYR", programStage: "Zj7UnCAulEk", orgUnit: "DiszpKrYNg8", occurredAt: "2026-03-02", status: "COMPLETED", dataValues: [] }
    ]
  };
  const r = parseNativeJsonPayload(JSON.stringify(payload), "event");
  expect("returns 2 events", r.payload?.events?.length === 2);
  expect("summary Events = 2", String(r.summary?.Events) === "2");
  expectThrow("rejects empty events", () => parseNativeJsonPayload(JSON.stringify({ events: [] }), "event"), "event");
}
section("parseNativeJsonPayload \u2014 dataEntry (aggregate)");
{
  const payload = {
    dataSet: "BfMAe6Itzgt",
    dataValues: [
      { dataElement: "fbfJHSPpUQD", period: "202601", orgUnit: "DiszpKrYNg8", value: "10" },
      { dataElement: "fbfJHSPpUQD", period: "202602", orgUnit: "DiszpKrYNg8", value: "12" },
      { dataElement: "cYeuwXTCPkU", period: "202601", orgUnit: "DiszpKrYNg8", value: "5" }
    ]
  };
  const r = parseNativeJsonPayload(JSON.stringify(payload), "dataEntry");
  expect("returns 3 dataValues", r.payload?.dataValues?.length === 3);
  expect("summary has Data values = 3", String(r.summary?.["Data values"]) === "3");
  expect("summary unique orgUnits = 1", String(r.summary?.["Org units"]) === "1");
  expect("summary unique periods = 2", String(r.summary?.["Periods"]) === "2");
  const r2 = parseNativeJsonPayload(JSON.stringify({ dataValues: payload.dataValues }), "dataEntry");
  expect("accepts bare {dataValues}", r2.payload?.dataValues?.length === 3);
  expectThrow("rejects empty dataValues", () => parseNativeJsonPayload(JSON.stringify({ dataValues: [] }), "dataEntry"), "dataValues");
}
section("parseNativeJsonPayload \u2014 metadata");
{
  const payload = {
    options: [{ name: "Opt-A", code: "A" }, { name: "Opt-B", code: "B" }],
    optionSets: [{ name: "Gender", valueType: "TEXT" }]
  };
  const r = parseNativeJsonPayload(JSON.stringify(payload), "metadata");
  expect("returns metadata payload", !!r.payload?.optionSets && !!r.payload?.options);
  expect("summary options = 2", String(r.summary?.options) === "2");
  expect("summary optionSets = 1", String(r.summary?.optionSets) === "1");
  expectThrow("rejects payload with no array fields", () => parseNativeJsonPayload(JSON.stringify({ foo: "bar" }), "metadata"), "metadata");
}
section("Export round-trip shapes");
{
  const trackerFetched = [
    {
      trackedEntityType: "nEenWmSyUEp",
      orgUnit: "DiszpKrYNg8",
      attributes: [],
      enrollments: [{ program: "IpHINAT79UW", orgUnit: "DiszpKrYNg8", enrolledAt: "2026-01-01", occurredAt: "2026-01-01", events: [] }]
    }
  ];
  const trackerJson = JSON.stringify({ trackedEntities: trackerFetched }, null, 2);
  const rt = parseNativeJsonPayload(trackerJson, "tracker");
  expect("tracker export re-imports", rt.payload.trackedEntities.length === 1);
  const eventFetched = { Zj7UnCAulEk: [{ program: "lx", programStage: "Zj7UnCAulEk", orgUnit: "o", occurredAt: "2026-03-01", dataValues: [] }] };
  const eventJson = JSON.stringify({ events: Object.values(eventFetched).flat() }, null, 2);
  const re = parseNativeJsonPayload(eventJson, "event");
  expect("event export re-imports", re.payload.events.length === 1);
  const dvJson = JSON.stringify({ dataSet: "BfMAe6Itzgt", dataValues: [{ dataElement: "x", period: "202601", orgUnit: "o", value: "1" }] }, null, 2);
  const rd = parseNativeJsonPayload(dvJson, "dataEntry");
  expect("dataEntry export re-imports", rd.payload.dataValues.length === 1);
}
section("Live DHIS2 \u2014 metadata dry-run (importMode=VALIDATE)");
try {
  await api.get("/api/me?fields=id");
  const probe = {
    options: [
      { code: "ISWE_JSON_TEST_A", name: "ISWE JSON Test A" },
      { code: "ISWE_JSON_TEST_B", name: "ISWE JSON Test B" }
    ]
  };
  const r = await api.post(
    "/api/metadata?importStrategy=CREATE_AND_UPDATE&atomicMode=NONE&importMode=VALIDATE",
    probe
  );
  info(`HTTP ${r.status}`);
  if (r.ok && r.body?.status) {
    expect(`server status = ${r.body.status}`, ["OK", "WARNING"].includes(r.body.status));
    info(`stats: ${JSON.stringify(r.body.stats || {})}`);
  } else {
    fail("metadata validate request failed");
    info((r.text || "").slice(0, 300));
    failures++;
  }
} catch (e) {
  info(`skipped (no live DHIS2): ${e.message.slice(0, 120)}`);
}
console.log("\n" + (failures === 0 ? "[OK] ALL JSON IO TESTS PASSED" : `[FAIL] ${failures} failure(s)`));
process.exit(failures === 0 ? 0 : 1);
