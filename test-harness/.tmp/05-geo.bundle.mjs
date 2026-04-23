import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// test-harness/05-geo.mjs
import fs from "node:fs";
import path from "node:path";

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
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
    }
    return { status: res.status, ok: res.ok, body: json, text };
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
function warn(msg) {
  console.log("[WARN] " + msg);
}
function info(msg) {
  console.log("       " + msg);
}

// src/lib/metadataExporter.js
import * as XLSX2 from "xlsx";
import { unzipSync as unzipSync2, zipSync as zipSync2 } from "fflate";

// src/utils/xlsxFormatting.js
import { strToU8, strFromU8 } from "fflate";

// src/lib/templateGenerator.js
import * as XLSX from "xlsx";
import { unzipSync, zipSync, strToU8 as strToU82, strFromU8 as strFromU82 } from "fflate";

// src/lib/metadataExporter.js
var GEO_STRIP_SUFFIXES = new RegExp(
  "(" + [
    // English
    "district",
    "province",
    "county",
    "region",
    "sub-?county",
    "municipality",
    "city",
    "town",
    "ward",
    "zone",
    "chiefdom",
    "division",
    "sub-?district",
    "sector",
    "cell",
    "village",
    "commune",
    "dept\\.?",
    "department",
    "parish",
    "borough",
    "township",
    "territory",
    "state",
    "prefecture",
    "canton",
    // French
    "d[e\xE9]partement",
    "r[e\xE9]gion",
    "arrondissement",
    "communaut[e\xE9]",
    "quartier",
    "sous-pr[e\xE9]fecture",
    "pr[e\xE9]fecture",
    "cercle",
    // Spanish / Portuguese
    "provincia",
    "municipio",
    "departamento",
    "estado",
    "distrito",
    "parroquia",
    "cant[o\xF3]n",
    "regi[o\xF3]n",
    "comarca",
    "concelho",
    "munic[i\xED]pio",
    "bairro",
    // Arabic (transliterated)
    "muhafazah",
    "wilayah",
    "mintaqah",
    "mudiriyyah",
    "qada",
    "nahiyah",
    "markaz",
    "liwa",
    "imarah",
    "baladiyyah",
    // Russian (transliterated)
    "oblast",
    "krai",
    "kray",
    "raion",
    "rayon",
    "okrug",
    "gorod",
    // Ethiopian
    "woreda",
    "kebele",
    "kifle\\s*ketema",
    // East African
    "wilaya",
    "kata",
    "tarafa",
    "mkoa",
    // South Asian
    "tehsil",
    "taluk",
    "mandal",
    "panchayat",
    "thana",
    "upazila",
    // East/Southeast Asian (transliterated)
    "shi",
    "xian",
    "qu",
    "xiang",
    "zhen",
    "cun",
    "amphoe",
    "tambon",
    "changwat",
    // Indonesian / Malay
    "kabupaten",
    "kecamatan",
    "kelurahan",
    "desa",
    "kotamadya",
    "provinsi"
  ].join("|") + ")",
  "gi"
);
function geoNormalize(str) {
  if (!str) return "";
  return String(str).toLowerCase().replace(GEO_STRIP_SUFFIXES, "").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}
function validateCoords(coords) {
  if (!Array.isArray(coords)) return false;
  if (typeof coords[0] === "number") {
    const [lng, lat] = coords;
    return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
  }
  return coords.every((c) => validateCoords(c));
}
function countCoordPoints(coords) {
  if (!Array.isArray(coords)) return 0;
  if (typeof coords[0] === "number") return 1;
  let n = 0;
  for (const c of coords) n += countCoordPoints(c);
  return n;
}
function parseGeoJsonFile(input) {
  const text = typeof input === "string" ? input : new TextDecoder().decode(new Uint8Array(input));
  let geojson;
  try {
    geojson = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON \u2014 file is not valid GeoJSON");
  }
  let features = [];
  if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
    features = geojson.features;
  } else if (geojson.type === "Feature") {
    features = [geojson];
  } else if (["Point", "MultiPoint", "Polygon", "MultiPolygon", "LineString", "MultiLineString"].includes(geojson.type)) {
    features = [{ type: "Feature", properties: {}, geometry: geojson }];
  } else {
    throw new Error(`Unsupported GeoJSON type: "${geojson.type}". Expected FeatureCollection, Feature, or a geometry type.`);
  }
  const warnings = [];
  const valid = [];
  let invalidGeomCount = 0;
  let outOfBoundsCount = 0;
  let totalPoints = 0;
  const complexFeatures = [];
  for (const f of features) {
    if (!f.geometry || !f.geometry.type || !f.geometry.coordinates) {
      invalidGeomCount++;
      continue;
    }
    if (!validateCoords(f.geometry.coordinates)) {
      outOfBoundsCount++;
      continue;
    }
    const pts = countCoordPoints(f.geometry.coordinates);
    totalPoints += pts;
    if (pts > 5e3) {
      complexFeatures.push({ name: f.properties?.name || "(unnamed)", points: pts });
    }
    valid.push(f);
  }
  if (valid.length === 0) {
    throw new Error("No features with valid geometry found in the file");
  }
  if (invalidGeomCount > 0) warnings.push(`${invalidGeomCount} feature(s) skipped \u2014 missing or invalid geometry`);
  if (outOfBoundsCount > 0) warnings.push(`${outOfBoundsCount} feature(s) skipped \u2014 coordinates outside valid WGS84 bounds (-180/180 lng, -90/90 lat)`);
  if (complexFeatures.length > 0) {
    const top3 = complexFeatures.slice(0, 3).map((f) => `${f.name} (${f.points.toLocaleString()} pts)`);
    warnings.push(`${complexFeatures.length} feature(s) have very complex geometry (>5,000 points): ${top3.join(", ")}${complexFeatures.length > 3 ? "..." : ""}. Consider simplifying for better DHIS2 performance.`);
  }
  if (geojson.crs && geojson.crs.properties?.name) {
    const crsName = geojson.crs.properties.name.toLowerCase();
    const isWGS84 = /wgs\s*84|epsg.*4326|crs84|crs:84/.test(crsName);
    if (!isWGS84) {
      warnings.push(`CRS detected: "${geojson.crs.properties.name}". DHIS2 expects WGS84 (EPSG:4326). Coordinates may be incorrect if CRS differs.`);
    }
  }
  const keySet = /* @__PURE__ */ new Set();
  for (const f of valid) {
    for (const k of Object.keys(f.properties || {})) keySet.add(k);
  }
  return {
    features: valid,
    propertyKeys: [...keySet],
    warnings,
    stats: { totalFeatures: features.length, validFeatures: valid.length, totalPoints, invalidGeomCount, outOfBoundsCount, complexCount: complexFeatures.length }
  };
}
function matchGeoJsonToOrgUnits(features, matchProperty, orgUnits, matchField) {
  const exactLookup = {};
  const normalLookup = {};
  const allOUs = [];
  for (const ou of orgUnits) {
    const val = ou[matchField];
    if (!val) continue;
    const exact = String(val).toLowerCase().trim();
    const norm = geoNormalize(val);
    exactLookup[exact] = ou;
    if (norm && norm !== exact) normalLookup[norm] = ou;
    allOUs.push({ ou, exact, norm });
  }
  const matched = [];
  const unmatched = [];
  const duplicates = [];
  const warnings = [];
  const seenOrgUnits = {};
  for (const feature of features) {
    const propVal = feature.properties?.[matchProperty];
    if (!propVal) {
      unmatched.push({ feature, reason: `Missing property "${matchProperty}"` });
      continue;
    }
    const rawVal = String(propVal).trim();
    const exactKey = rawVal.toLowerCase();
    const normKey = geoNormalize(rawVal);
    let ou = null;
    let matchLevel = "";
    if (exactLookup[exactKey]) {
      ou = exactLookup[exactKey];
      matchLevel = "exact";
    }
    if (!ou && normKey) {
      if (normalLookup[normKey]) {
        ou = normalLookup[normKey];
        matchLevel = "normalized";
      } else {
        const found = allOUs.find((o) => o.norm === normKey);
        if (found) {
          ou = found.ou;
          matchLevel = "normalized";
        }
      }
    }
    if (!ou && exactKey.length >= 2) {
      const candidates = allOUs.filter(
        (o) => o.exact.includes(exactKey) || exactKey.includes(o.exact)
      );
      if (candidates.length === 1) {
        ou = candidates[0].ou;
        matchLevel = "fuzzy";
      } else if (candidates.length > 1) {
        candidates.sort((a, b) => a.exact.length - b.exact.length);
        ou = candidates[0].ou;
        matchLevel = "fuzzy-ambiguous";
      }
    }
    if (!ou) {
      unmatched.push({ feature, reason: `No org unit with ${matchField} matching "${rawVal}"` });
      continue;
    }
    if (seenOrgUnits[ou.id]) {
      duplicates.push({
        orgUnit: ou,
        feature,
        previousFeature: seenOrgUnits[ou.id].feature,
        geometry: feature.geometry
      });
      continue;
    }
    const entry = { orgUnit: ou, feature, geometry: feature.geometry, matchLevel };
    matched.push(entry);
    seenOrgUnits[ou.id] = entry;
  }
  const levels = { exact: 0, normalized: 0, fuzzy: 0, "fuzzy-ambiguous": 0 };
  for (const m of matched) levels[m.matchLevel] = (levels[m.matchLevel] || 0) + 1;
  if (levels.normalized > 0) warnings.push(`${levels.normalized} match(es) required name normalization (suffix stripping)`);
  if (levels.fuzzy > 0) warnings.push(`${levels.fuzzy} match(es) used fuzzy/contains logic \u2014 verify these are correct`);
  if (levels["fuzzy-ambiguous"] > 0) warnings.push(`${levels["fuzzy-ambiguous"]} match(es) were ambiguous (multiple candidates) \u2014 picked best guess`);
  if (duplicates.length > 0) warnings.push(`${duplicates.length} feature(s) skipped \u2014 duplicate match to same org unit`);
  const payload = {
    organisationUnits: matched.map((m) => ({
      id: m.orgUnit.id,
      name: m.orgUnit.name,
      shortName: m.orgUnit.shortName || m.orgUnit.name,
      openingDate: m.orgUnit.openingDate || "1970-01-01",
      geometry: m.geometry
    }))
  };
  return { matched, unmatched, duplicates, warnings, payload };
}

// test-harness/05-geo.mjs
var result = { flow: "geo-import", steps: [] };
var steps = result.steps;
function step(name, status, detail) {
  steps.push({ name, status, detail });
  ({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ": " + detail : ""}`);
}
try {
  section("Geo import \u2014 Sierra Leone districts");
  const geojsonPath = path.resolve("test-sierra-leone-districts.geojson");
  const raw = fs.readFileSync(geojsonPath);
  const parsed = parseGeoJsonFile(raw.toString("utf8"));
  step(
    "parseGeoJsonFile",
    "OK",
    `features=${parsed.features.length} propertyKeys=${parsed.propertyKeys?.join(", ")}`
  );
  const ous = await api.get("/api/organisationUnits?filter=level:eq:2&fields=id,name,level&paging=false");
  const orgUnits = ous.organisationUnits ?? [];
  step("fetch org units (level 2)", "OK", `count=${orgUnits.length}`);
  const matchProp = parsed.propertyKeys?.find((k) => /name/i.test(k)) ?? parsed.propertyKeys?.[0] ?? "name";
  const matchResult = matchGeoJsonToOrgUnits(parsed.features, matchProp, orgUnits, "name");
  const matched = matchResult.matched ?? [];
  const unmatched = matchResult.unmatched ?? [];
  step(
    "matchGeoJsonToOrgUnits",
    matched.length > 0 ? "OK" : "FAIL",
    `matched=${matched.length} unmatched=${unmatched.length} duplicates=${matchResult.duplicates?.length ?? 0} property="${matchProp}"`
  );
  if (matched.length > 0) {
    const byLevel = {};
    for (const m of matched) byLevel[m.matchLevel] = (byLevel[m.matchLevel] ?? 0) + 1;
    info(`    match levels: ${JSON.stringify(byLevel)}`);
  }
  const payload = matchResult.payload ?? {
    organisationUnits: matched.filter((m) => m.feature?.geometry).map((m) => ({
      id: m.orgUnit.id,
      geometry: m.feature.geometry
    }))
  };
  step("build geo payload", "OK", `orgUnits with geometry=${payload.organisationUnits.length}`);
  if (payload.organisationUnits.length > 0) {
    const dry = await api.post(
      "/api/metadata?importMode=VALIDATE&importStrategy=UPDATE",
      payload
    );
    const r = dry.body;
    step(
      "POST /api/metadata geometry (VALIDATE)",
      dry.ok ? r?.status === "OK" ? "OK" : "WARN" : "FAIL",
      `http=${dry.status} status=${r?.status} stats=${JSON.stringify(r?.stats ?? {})}`
    );
    const errs = (r?.typeReports ?? []).flatMap((tr) => (tr.objectReports ?? []).flatMap((o) => o.errorReports ?? []));
    if (errs.length) {
      for (const e of errs.slice(0, 3)) info(`    ${e.errorCode}: ${(e.message ?? "").slice(0, 160)}`);
    }
  } else {
    step("POST /api/metadata", "WARN", "no matched org units with geometry \u2014 skipping");
  }
} catch (e) {
  fail("HARNESS CRASH: " + (e.stack ?? e.message));
  process.exitCode = 1;
}
section("Summary");
var okCount = steps.filter((s) => s.status === "OK").length;
var failCount = steps.filter((s) => s.status === "FAIL").length;
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2));
fs.writeFileSync(path.resolve("test-harness/.tmp", "result-geo-import.json"), JSON.stringify(result, null, 2));
