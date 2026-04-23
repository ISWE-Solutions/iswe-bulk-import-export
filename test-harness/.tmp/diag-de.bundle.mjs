import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// test-harness/diag-de.mjs
import * as XLSX2 from "xlsx";

// src/lib/metadataExporter.js
import * as XLSX from "xlsx";
import { unzipSync, zipSync } from "fflate";

// src/utils/xlsxFormatting.js
import { strToU8, strFromU8 } from "fflate";
function setColumnWidths(ws2, headers, { minWidth = 10, maxWidth = 30 } = {}) {
  ws2["!cols"] = headers.map((h) => {
    const len = String(h).length;
    const wch = Math.max(minWidth, Math.min(len + 2, maxWidth));
    return { wch };
  });
}

// src/lib/metadataExporter.js
function buildMetadataWorkbook(metadataType, data) {
  const wb3 = XLSX.utils.book_new();
  const sheetColors = {};
  const TYPE_COLOR = metadataType.color ? metadataType.color.replace("#", "") : "6A1B9A";
  if (metadataType.key === "optionSets") {
    return buildOptionSetWorkbook(metadataType, data);
  }
  if (metadataType.key === "organisationUnits") {
    return buildOrgUnitWorkbook(metadataType, data);
  }
  if (metadataType.memberConfig) {
    return buildGroupWorkbook(metadataType, data);
  }
  const columns = metadataType.columns;
  const headers = columns.map((c) => c.label);
  const rows2 = (data ?? []).map((item) => columns.map((c) => getNestedValue(item, c.key)));
  const ws2 = XLSX.utils.aoa_to_sheet([headers, ...rows2]);
  setColumnWidths(ws2, headers);
  XLSX.utils.book_append_sheet(wb3, ws2, metadataType.label.slice(0, 31));
  sheetColors[1] = [{ startCol: 0, endCol: headers.length - 1, color: TYPE_COLOR }];
  const suffix = data ? "Export" : "Template";
  const filename = `${metadataType.label.replace(/\s/g, "")}_${suffix}_${today()}.xlsx`;
  return { wb: wb3, filename, sheetColors };
}
function buildOrgUnitWorkbook(metadataType, data) {
  const wb3 = XLSX.utils.book_new();
  const sheetColors = {};
  const OU_COLOR = "0277BD";
  const sorted = data ? [...data].sort((a, b) => (a.level || 999) - (b.level || 999)) : null;
  const idToOu = {};
  for (const ou of sorted || []) {
    if (ou.id) idToOu[ou.id] = ou;
  }
  const columns = metadataType.columns;
  const headers = columns.map((c) => c.label);
  const rows2 = (sorted ?? []).map((item) => {
    return columns.map((c) => {
      if (c.key === "geometry") return formatGeometry(item.geometry);
      if (c.key === "hierarchyPath") return buildHierarchyPath(item, idToOu);
      return getNestedValue(item, c.key);
    });
  });
  const ws2 = XLSX.utils.aoa_to_sheet([headers, ...rows2]);
  setColumnWidths(ws2, headers);
  XLSX.utils.book_append_sheet(wb3, ws2, "Organisation Units");
  sheetColors[1] = [{ startCol: 0, endCol: headers.length - 1, color: OU_COLOR }];
  if (sorted && sorted.length > 0) {
    const refHeaders = ["ID", "Name", "Level", "Parent ID"];
    const refRows = sorted.map((ou) => [
      ou.id ?? "",
      ou.name ?? "",
      ou.level ?? "",
      ou.parent?.id ?? ""
    ]);
    const wsRef = XLSX.utils.aoa_to_sheet([refHeaders, ...refRows]);
    setColumnWidths(wsRef, refHeaders);
    XLSX.utils.book_append_sheet(wb3, wsRef, "OrgUnit Reference");
    sheetColors[2] = [{ startCol: 0, endCol: refHeaders.length - 1, color: "546E7A" }];
  }
  const suffix = data ? "Export" : "Template";
  const filename = `OrganisationUnits_${suffix}_${today()}.xlsx`;
  return { wb: wb3, filename, sheetColors };
}
function buildHierarchyPath(ou, idToOu) {
  const parts = [];
  let current = ou;
  const seen = /* @__PURE__ */ new Set();
  while (current) {
    parts.unshift(current.name || "");
    if (!current.parent?.id || seen.has(current.parent.id)) break;
    seen.add(current.parent.id);
    const parent = idToOu[current.parent.id];
    if (!parent) {
      if (current.parent?.name) parts.unshift(current.parent.name);
      break;
    }
    current = parent;
  }
  return parts.join(" / ");
}
function buildGroupWorkbook(metadataType, data) {
  const wb3 = XLSX.utils.book_new();
  const sheetColors = {};
  const COLOR = metadataType.color ? metadataType.color.replace("#", "") : "546E7A";
  const mc = metadataType.memberConfig;
  const columns = metadataType.columns;
  const headers = columns.map((c) => c.label);
  const rows2 = (data ?? []).map((item) => columns.map((c) => getNestedValue(item, c.key)));
  const ws2 = XLSX.utils.aoa_to_sheet([headers, ...rows2]);
  setColumnWidths(ws2, headers);
  XLSX.utils.book_append_sheet(wb3, ws2, metadataType.label.slice(0, 31));
  sheetColors[1] = [{ startCol: 0, endCol: headers.length - 1, color: COLOR }];
  const memHeaders = mc.columns.map((c) => c.label);
  const memRows = [];
  for (const item of data ?? []) {
    const members = item[mc.property] ?? [];
    for (const member of members) {
      memRows.push(mc.columns.map((c) => {
        if (c.key === "group.id") return item.id ?? "";
        if (c.key === "group.name") return item.name ?? "";
        return getNestedValue(member, c.key);
      }));
    }
  }
  const wsM = XLSX.utils.aoa_to_sheet([memHeaders, ...memRows]);
  setColumnWidths(wsM, memHeaders);
  XLSX.utils.book_append_sheet(wb3, wsM, mc.sheetName.slice(0, 31));
  sheetColors[2] = [{ startCol: 0, endCol: memHeaders.length - 1, color: darkenHex(COLOR) }];
  const suffix = data ? "Export" : "Template";
  const filename = `${metadataType.label.replace(/\s/g, "")}_${suffix}_${today()}.xlsx`;
  return { wb: wb3, filename, sheetColors };
}
function darkenHex(hex) {
  const r2 = Math.max(0, parseInt(hex.slice(0, 2), 16) - 40);
  const g2 = Math.max(0, parseInt(hex.slice(2, 4), 16) - 40);
  const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - 40);
  return r2.toString(16).padStart(2, "0") + g2.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
}
function buildOptionSetWorkbook(metadataType, data) {
  const wb3 = XLSX.utils.book_new();
  const sheetColors = {};
  const OS_COLOR = "E65100";
  const osColumns = metadataType.columns;
  const osHeaders = osColumns.map((c) => c.label);
  const osRows = (data ?? []).map((item) => osColumns.map((c) => getNestedValue(item, c.key)));
  const wsOS = XLSX.utils.aoa_to_sheet([osHeaders, ...osRows]);
  setColumnWidths(wsOS, osHeaders);
  XLSX.utils.book_append_sheet(wb3, wsOS, "Option Sets");
  sheetColors[1] = [{ startCol: 0, endCol: osHeaders.length - 1, color: OS_COLOR }];
  const optColumns = metadataType.optionColumns;
  const optHeaders = optColumns.map((c) => c.label);
  const optRows = [];
  for (const os of data ?? []) {
    for (const opt of os.options ?? []) {
      optRows.push(optColumns.map((c) => {
        if (c.key === "optionSet.id") return os.id ?? "";
        if (c.key === "optionSet.name") return os.name ?? "";
        return getNestedValue(opt, c.key);
      }));
    }
  }
  const wsOpt = XLSX.utils.aoa_to_sheet([optHeaders, ...optRows]);
  setColumnWidths(wsOpt, optHeaders);
  XLSX.utils.book_append_sheet(wb3, wsOpt, "Options");
  sheetColors[2] = [{ startCol: 0, endCol: optHeaders.length - 1, color: "BF360C" }];
  const suffix = data ? "Export" : "Template";
  const filename = `OptionSets_${suffix}_${today()}.xlsx`;
  return { wb: wb3, filename, sheetColors };
}
function parseMetadataFile(input, metadataType) {
  const wb3 = input.SheetNames ? input : XLSX.read(input, { type: "array" });
  if (metadataType.key === "optionSets") {
    return parseOptionSetFile(wb3, metadataType);
  }
  if (metadataType.key === "organisationUnits") {
    return parseOrgUnitFile(wb3, metadataType);
  }
  if (metadataType.memberConfig) {
    return parseGroupFile(wb3, metadataType);
  }
  const ws2 = wb3.Sheets[wb3.SheetNames[0]];
  const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1 });
  if (rows2.length < 2) return { payload: { [metadataType.resource]: [] }, summary: { total: 0, withId: 0, new: 0 } };
  const headers = rows2[0];
  const columns = metadataType.columns.filter((c) => !c.readOnly);
  const colMap = mapHeadersToColumns(headers, columns);
  const items = [];
  for (let r2 = 1; r2 < rows2.length; r2++) {
    const row = rows2[r2];
    if (!row || row.every((c) => c === "" || c == null)) continue;
    const item = {};
    for (const [colIdx, col] of Object.entries(colMap)) {
      const val = row[colIdx];
      if (val == null || val === "") continue;
      setNestedValue(item, col.key, String(val));
    }
    items.push(item);
  }
  const withId = items.filter((i) => i.id).length;
  return {
    payload: { [metadataType.resource]: items },
    summary: { total: items.length, withId, new: items.length - withId }
  };
}
function parseOrgUnitFile(wb3, metadataType) {
  const ws2 = wb3.Sheets[wb3.SheetNames[0]];
  const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1 });
  if (rows2.length < 2) return { payload: { organisationUnits: [] }, summary: { total: 0, withId: 0, new: 0 } };
  const headers = rows2[0];
  const allColumns = metadataType.columns;
  const colMap = mapHeadersToColumns(headers, allColumns);
  const refMap = buildOrgUnitRefMap(wb3);
  const items = [];
  for (let r2 = 1; r2 < rows2.length; r2++) {
    const row = rows2[r2];
    if (!row || row.every((c) => c === "" || c == null)) continue;
    const item = { _row: r2 + 1 };
    let rawParentName = "";
    for (const [colIdx, col] of Object.entries(colMap)) {
      const val = row[colIdx];
      if (val == null || val === "") continue;
      if (col.key === "geometry") {
        item.geometry = parseGeometry(String(val));
      } else if (col.key === "level") {
        item._level = parseInt(val, 10) || 0;
      } else if (col.key === "parent.name") {
        rawParentName = String(val).trim();
      } else if (col.readOnly) {
      } else {
        setNestedValue(item, col.key, String(val));
      }
    }
    item._parentName = rawParentName;
    const parentId = item.parent?.id ?? "";
    if (parentId && /^[A-Za-z0-9]{11}$/.test(parentId)) {
    } else if (parentId) {
      const resolved = refMap[parentId.toLowerCase()];
      if (resolved) {
        setNestedValue(item, "parent.id", resolved);
      }
    }
    if (!item.parent?.id && rawParentName) {
      const resolved = refMap[rawParentName.toLowerCase()];
      if (resolved) {
        setNestedValue(item, "parent.id", resolved);
      }
    }
    items.push(item);
  }
  const nameToItem = {};
  for (const item of items) {
    if (item.name) nameToItem[item.name.toLowerCase()] = item;
  }
  for (const item of items) {
    const pid = item.parent?.id ?? "";
    if (pid && /^[A-Za-z0-9]{11}$/.test(pid)) continue;
    const candidates = [pid, item._parentName].filter(Boolean);
    let matched = false;
    for (const candidate of candidates) {
      const parentItem = nameToItem[candidate.toLowerCase()];
      if (parentItem && parentItem !== item) {
        if (!parentItem.id) {
          parentItem.id = generateUid();
        }
        setNestedValue(item, "parent.id", parentItem.id);
        matched = true;
        break;
      }
    }
  }
  const idToItem = {};
  for (const item of items) {
    if (item.id) idToItem[item.id] = item;
  }
  for (const item of items) {
    if (!item._level) {
      item._level = computeLevel(item, idToItem, refMap);
    }
  }
  items.sort((a, b) => (a._level || 999) - (b._level || 999));
  const cleanItems = items.map((item) => {
    const { _row, _level, _parentName, ...rest } = item;
    return rest;
  });
  const withId = cleanItems.filter((i) => i.id).length;
  const levelCounts = {};
  for (const item of items) {
    const l = item._level || "?";
    levelCounts[l] = (levelCounts[l] || 0) + 1;
  }
  return {
    payload: { organisationUnits: cleanItems },
    summary: { total: cleanItems.length, withId, new: cleanItems.length - withId, levelCounts }
  };
}
function parseGroupFile(wb3, metadataType) {
  const mc = metadataType.memberConfig;
  const ws2 = wb3.Sheets[wb3.SheetNames[0]];
  const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1 });
  const columns = metadataType.columns.filter((c) => !c.readOnly);
  const colMap = rows2.length > 0 ? mapHeadersToColumns(rows2[0], columns) : {};
  const items = [];
  for (let r2 = 1; r2 < rows2.length; r2++) {
    const row = rows2[r2];
    if (!row || row.every((c) => c === "" || c == null)) continue;
    const item = {};
    item[mc.property] = [];
    for (const [colIdx, col] of Object.entries(colMap)) {
      const val = row[colIdx];
      if (val == null || val === "") continue;
      setNestedValue(item, col.key, String(val));
    }
    items.push(item);
  }
  if (wb3.SheetNames.length > 1) {
    const wsM = wb3.Sheets[wb3.SheetNames[1]];
    const mRows = XLSX.utils.sheet_to_json(wsM, { header: 1 });
    const mColumns = mc.columns.filter((c) => !c.readOnly);
    const mColMap = mRows.length > 0 ? mapHeadersToColumns(mRows[0], mColumns) : {};
    const members = [];
    for (let r2 = 1; r2 < mRows.length; r2++) {
      const row = mRows[r2];
      if (!row || row.every((c) => c === "" || c == null)) continue;
      const mem = {};
      for (const [colIdx, col] of Object.entries(mColMap)) {
        const val = row[colIdx];
        if (val == null || val === "") continue;
        setNestedValue(mem, col.key, String(val));
      }
      members.push(mem);
    }
    const byGroupId = {};
    for (const m of members) {
      const gid = m.group?.id;
      if (!gid) continue;
      if (!byGroupId[gid]) byGroupId[gid] = [];
      const clean = { ...m };
      delete clean.group;
      byGroupId[gid].push(clean);
    }
    for (const item of items) {
      if (item.id && byGroupId[item.id]) {
        item[mc.property] = byGroupId[item.id];
      }
    }
  }
  const withId = items.filter((i) => i.id).length;
  return {
    payload: { [metadataType.resource]: items },
    summary: { total: items.length, withId, new: items.length - withId }
  };
}
function buildOrgUnitRefMap(wb3) {
  const map = {};
  const refSheetName = wb3.SheetNames.find((n) => n.toLowerCase().includes("reference"));
  if (!refSheetName) return map;
  const ws2 = wb3.Sheets[refSheetName];
  const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1 });
  if (rows2.length < 2) return map;
  for (let r2 = 1; r2 < rows2.length; r2++) {
    const row = rows2[r2];
    if (!row) continue;
    const id = String(row[0] ?? "").trim();
    const name = String(row[1] ?? "").trim();
    if (id && name) {
      map[name.toLowerCase()] = id;
    }
  }
  return map;
}
function computeLevel(item, idToItem, refMap) {
  let depth = 1;
  let current = item;
  const seen = /* @__PURE__ */ new Set();
  while (current.parent?.id) {
    if (seen.has(current.parent.id)) break;
    seen.add(current.parent.id);
    const parentInFile = idToItem[current.parent.id];
    if (parentInFile) {
      depth++;
      current = parentInFile;
    } else {
      depth++;
      break;
    }
  }
  return depth;
}
function generateUid() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const allChars = chars + "0123456789";
  let uid = chars[Math.floor(Math.random() * chars.length)];
  for (let i = 1; i < 11; i++) {
    uid += allChars[Math.floor(Math.random() * allChars.length)];
  }
  return uid;
}
function parseOptionSetFile(wb3, metadataType) {
  const wsOS = wb3.Sheets[wb3.SheetNames[0]];
  const osRows = XLSX.utils.sheet_to_json(wsOS, { header: 1 });
  const osHeaders = osRows[0] ?? [];
  const osColumns = metadataType.columns.filter((c) => !c.readOnly);
  const osColMap = mapHeadersToColumns(osHeaders, osColumns);
  const optionSets = [];
  for (let r2 = 1; r2 < osRows.length; r2++) {
    const row = osRows[r2];
    if (!row || row.every((c) => c === "" || c == null)) continue;
    const item = { options: [] };
    for (const [colIdx, col] of Object.entries(osColMap)) {
      const val = row[colIdx];
      if (val == null || val === "") continue;
      setNestedValue(item, col.key, String(val));
    }
    optionSets.push(item);
  }
  if (wb3.SheetNames.length > 1) {
    const wsOpt = wb3.Sheets[wb3.SheetNames[1]];
    const optRows = XLSX.utils.sheet_to_json(wsOpt, { header: 1 });
    const optHeaders = optRows[0] ?? [];
    const optColumns = metadataType.optionColumns.filter((c) => !c.readOnly);
    const optColMap = mapHeadersToColumns(optHeaders, optColumns);
    const options = [];
    for (let r2 = 1; r2 < optRows.length; r2++) {
      const row = optRows[r2];
      if (!row || row.every((c) => c === "" || c == null)) continue;
      const opt = {};
      for (const [colIdx, col] of Object.entries(optColMap)) {
        const val = row[colIdx];
        if (val == null || val === "") continue;
        setNestedValue(opt, col.key, String(val));
      }
      options.push(opt);
    }
    const byOsId = {};
    for (const opt of options) {
      const osId = opt.optionSet?.id;
      if (!osId) continue;
      if (!byOsId[osId]) byOsId[osId] = [];
      const cleanOpt = { ...opt };
      delete cleanOpt.optionSet;
      byOsId[osId].push(cleanOpt);
    }
    for (const os of optionSets) {
      if (os.id && byOsId[os.id]) {
        os.options = byOsId[os.id];
      }
    }
  }
  const withId = optionSets.filter((i) => i.id).length;
  return {
    payload: { optionSets },
    summary: { total: optionSets.length, withId, new: optionSets.length - withId }
  };
}
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
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function getNestedValue(obj, path) {
  const parts = path.split(".");
  let val = obj;
  for (const p of parts) {
    if (val == null) return "";
    val = val[p];
  }
  return val ?? "";
}
function setNestedValue(obj, path, value) {
  const parts = path.split(".");
  let target = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
}
function mapHeadersToColumns(headers, columns) {
  const colMap = {};
  const norm = (s) => String(s ?? "").trim().replace(/\s*\*\s*$/, "").toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (!h) continue;
    const col = columns.find((c) => norm(c.label) === h);
    if (col) colMap[i] = col;
  }
  return colMap;
}
function formatGeometry(geom) {
  if (!geom) return "";
  if (geom.type === "Point" && geom.coordinates) {
    return `${geom.coordinates[0]},${geom.coordinates[1]}`;
  }
  return JSON.stringify(geom);
}
function parseGeometry(val) {
  if (!val) return void 0;
  const parts = val.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { type: "Point", coordinates: parts };
  }
  try {
    return JSON.parse(val);
  } catch {
    return void 0;
  }
}

// test-harness/diag-de.mjs
var AUTH = "Basic " + Buffer.from("admin:district").toString("base64");
var BASE = "https://play.im.dhis2.org/stable-2-42-4";
var g = async (p) => (await fetch(BASE + p, { headers: { Authorization: AUTH, Accept: "application/json" } })).json();
var type = {
  key: "dataElements",
  label: "Data Elements",
  resource: "dataElements",
  fields: "id,name,shortName,code,description,valueType,domainType,aggregationType,categoryCombo[id,name],zeroIsSignificant",
  columns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name *", required: true },
    { key: "shortName", label: "Short Name *", required: true },
    { key: "code", label: "Code" },
    { key: "description", label: "Description" },
    { key: "valueType", label: "Value Type *", required: true },
    { key: "domainType", label: "Domain Type *", required: true },
    { key: "aggregationType", label: "Aggregation Type *", required: true },
    { key: "categoryCombo.id", label: "Category Combo ID" },
    { key: "categoryCombo.name", label: "Category Combo Name", readOnly: true },
    { key: "zeroIsSignificant", label: "Zero Is Significant" }
  ]
};
var r = await g(`/api/dataElements?fields=${encodeURIComponent(type.fields)}&pageSize=2`);
console.log("=== API response item 0 ===");
console.log(JSON.stringify(r.dataElements[0], null, 2));
var { wb } = buildMetadataWorkbook(type, r.dataElements);
var ws = wb.Sheets["Data Elements"];
var rows = XLSX2.utils.sheet_to_json(ws, { header: 1 });
console.log("=== Workbook rows ===");
console.log("HEADERS:", JSON.stringify(rows[0]));
console.log("ROW 1:", JSON.stringify(rows[1]));
var buf = XLSX2.write(wb, { type: "buffer", bookType: "xlsx" });
var wb2 = XLSX2.read(buf, { type: "buffer" });
var { payload } = parseMetadataFile(wb2, type);
console.log("=== First parsed item ===");
console.log(JSON.stringify(payload.dataElements[0], null, 2));
