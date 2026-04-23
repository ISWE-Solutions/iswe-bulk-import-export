import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// test-harness/06-data-export.mjs
import * as XLSX3 from "xlsx";
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

// src/lib/dataExporter.js
import * as XLSX2 from "xlsx";
import { unzipSync as unzipSync2, zipSync as zipSync2 } from "fflate";

// src/lib/templateGenerator.js
import * as XLSX from "xlsx";
import { unzipSync, zipSync, strToU8 as strToU82, strFromU8 as strFromU82 } from "fflate";

// src/utils/xlsxFormatting.js
import { strToU8, strFromU8 } from "fflate";
var ENROLLMENT_COLOR = "4472C4";
var STAGE_COLORS = ["548235", "BF8F00", "C55A11", "7030A0", "2E75B6"];
function colLetter(idx) {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + n % 26) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
function setColumnWidths(ws, headers, { minWidth = 10, maxWidth = 30 } = {}) {
  ws["!cols"] = headers.map((h) => {
    const len = String(h).length;
    const wch = Math.max(minWidth, Math.min(len + 2, maxWidth));
    return { wch };
  });
}

// src/lib/trackerAttributes.js
function getTrackerAttributes(metadata) {
  if (!metadata) return [];
  const programAttrs = metadata.programTrackedEntityAttributes;
  if (Array.isArray(programAttrs) && programAttrs.length > 0) {
    return programAttrs;
  }
  return metadata.trackedEntityType?.trackedEntityTypeAttributes ?? [];
}

// src/lib/templateGenerator.js
function collectOptionSets(metadata) {
  const seen = /* @__PURE__ */ new Set();
  const result2 = [];
  const check = (optionSet) => {
    if (optionSet && !seen.has(optionSet.id)) {
      seen.add(optionSet.id);
      result2.push({
        id: optionSet.id,
        name: optionSet.displayName ?? optionSet.id,
        options: optionSet.options ?? []
      });
    }
  };
  for (const a of getTrackerAttributes(metadata)) {
    check(a.trackedEntityAttribute?.optionSet);
  }
  for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
      check(psde.dataElement?.optionSet);
    }
  }
  return result2;
}
function buildValidationSheet(metadata) {
  const optionSets = collectOptionSets(metadata);
  const orgUnits = metadata.organisationUnits ?? [];
  const valInfo = { orgUnitRef: null, optionRefs: {} };
  if (optionSets.length === 0 && orgUnits.length === 0) {
    return { wsValidation: null, valInfo };
  }
  const valHeaders = [];
  let colIdx = 0;
  if (orgUnits.length > 0) {
    valHeaders.push("Org Unit [name]", "Org Unit [UID]");
    const cl = colLetter(colIdx);
    valInfo.orgUnitRef = `Validation!$${cl}$2:$${cl}$${orgUnits.length + 1}`;
    colIdx += 2;
  }
  for (const os of optionSets) {
    valHeaders.push(`${os.name} [code]`, `${os.name} [display]`);
    const codeCl = colLetter(colIdx);
    valInfo.optionRefs[os.id] = `Validation!$${codeCl}$2:$${codeCl}$${os.options.length + 1}`;
    colIdx += 2;
  }
  const maxOptRows = optionSets.length > 0 ? Math.max(...optionSets.map((os) => os.options.length)) : 0;
  const maxRows = Math.max(maxOptRows, orgUnits.length);
  const valData = [];
  for (let i = 0; i < maxRows; i++) {
    const row = [];
    if (orgUnits.length > 0) {
      row.push(i < orgUnits.length ? orgUnits[i].displayName : "");
      row.push(i < orgUnits.length ? orgUnits[i].id : "");
    }
    for (const os of optionSets) {
      row.push(i < os.options.length ? os.options[i].code : "");
      row.push(i < os.options.length ? os.options[i].displayName : "");
    }
    valData.push(row);
  }
  const wsValidation = XLSX.utils.aoa_to_sheet([valHeaders, ...valData]);
  return { wsValidation, valInfo };
}
function buildOptionSetIndex(metadata) {
  const attrOs = {};
  for (const a of getTrackerAttributes(metadata)) {
    const tea = a.trackedEntityAttribute ?? a;
    if (tea.optionSet?.id) attrOs[tea.id] = tea.optionSet.id;
  }
  const deOs = {};
  for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
      const de = psde.dataElement ?? psde;
      if (de.optionSet?.id) deOs[de.id] = de.optionSet.id;
    }
  }
  return { attrOs, deOs };
}

// src/lib/ouHierarchy.js
function buildOUHeaders({ includeUids = false, includeHierarchy = true } = {}, maxLevel = 0) {
  const cols = ["ORG_UNIT_ID"];
  if (includeUids) cols.push("ORG_UNIT_UID");
  if (includeHierarchy && maxLevel > 0) {
    for (let l = 1; l <= maxLevel; l++) cols.push(`OU_L${l}`);
  }
  return cols;
}
function ouColCount(opts = {}, maxLevel = 0) {
  return buildOUHeaders(opts, maxLevel).length;
}
function buildOURowCells(ouId, { includeUids = false, includeHierarchy = true } = {}, hierarchyMap = {}, maxLevel = 0) {
  const info2 = hierarchyMap[ouId];
  const cells = [info2?.name ?? ouId ?? ""];
  if (includeUids) cells.push(ouId ?? "");
  if (includeHierarchy && maxLevel > 0) {
    for (let l = 1; l <= maxLevel; l++) {
      cells.push(info2?.levelNames?.[l - 1] ?? "");
    }
  }
  return cells;
}

// src/lib/dataExporter.js
var DEFAULT_OU_OPTS = { includeUids: false, includeHierarchy: true };
function buildReverseLookups(metadata) {
  const ouMap = {};
  for (const ou of metadata.organisationUnits ?? []) {
    ouMap[ou.id] = ou.displayName;
  }
  const optDisplayMaps = {};
  for (const os of collectOptionSets(metadata)) {
    const m = {};
    for (const opt of os.options) {
      if (opt.code != null) m[opt.code] = opt.displayName ?? opt.code;
    }
    optDisplayMaps[os.id] = m;
  }
  return { ouMap, optDisplayMaps };
}
function resolveOptionDisplay(value, osId, optDisplayMaps) {
  if (!value || !osId || !optDisplayMaps[osId]) return value;
  return optDisplayMaps[osId][value] ?? value;
}
function buildTrackerExportWorkbook(trackedEntities, metadata, options = {}) {
  const ouOpts = { ...DEFAULT_OU_OPTS, ...options };
  const ouMap2 = options.ouHierarchy?.map ?? {};
  const maxLevel = options.ouHierarchy?.maxLevel ?? 0;
  const ouCols = ouColCount(ouOpts, maxLevel);
  const wb = XLSX2.utils.book_new();
  const { wsValidation, valInfo } = buildValidationSheet(metadata);
  const { attrOs, deOs } = buildOptionSetIndex(metadata);
  const { optDisplayMaps } = buildReverseLookups(metadata);
  const teiAttributes = extractTeiAttributes(metadata);
  const stages = [...metadata.programStages ?? []].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  const teiHeaders = ["TEI_ID", ...buildOUHeaders(ouOpts, maxLevel), "ENROLLMENT_DATE", "INCIDENT_DATE"];
  for (const attr of teiAttributes) {
    teiHeaders.push(`${attr.name} [${attr.id}]`);
  }
  const sheetColors = {};
  const validationRules = {};
  const teiDvRules = [];
  if (valInfo.orgUnitRef) {
    teiDvRules.push({ col: 1, ref: valInfo.orgUnitRef, startRow: 2, maxRow: Math.max(1e3, trackedEntities.length + 10) });
  }
  const attrStart = 1 + ouCols + 2;
  for (let i = 0; i < teiAttributes.length; i++) {
    const osId = attrOs[teiAttributes[i].id];
    if (osId && valInfo.optionRefs[osId]) {
      teiDvRules.push({ col: attrStart + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: Math.max(1e3, trackedEntities.length + 10) });
    }
  }
  if (teiDvRules.length > 0) validationRules[1] = teiDvRules;
  const teiRows = [];
  for (const tei of trackedEntities) {
    const enrollment = tei.enrollments?.[0];
    const attrMap = Object.fromEntries([
      ...(tei.attributes ?? []).map((a) => [a.attribute, a.value]),
      ...(enrollment?.attributes ?? []).map((a) => [a.attribute, a.value])
    ]);
    const row = [
      tei.trackedEntity ?? "",
      ...buildOURowCells(tei.orgUnit, ouOpts, ouMap2, maxLevel),
      enrollment?.enrolledAt?.slice(0, 10) ?? "",
      enrollment?.occurredAt?.slice(0, 10) ?? ""
    ];
    for (const attr of teiAttributes) {
      const raw = attrMap[attr.id] ?? "";
      row.push(resolveOptionDisplay(raw, attrOs[attr.id], optDisplayMaps));
    }
    teiRows.push(row);
  }
  const wsTei = XLSX2.utils.aoa_to_sheet([teiHeaders, ...teiRows]);
  setColumnWidths(wsTei, teiHeaders);
  XLSX2.utils.book_append_sheet(wb, wsTei, "TEI + Enrollment");
  sheetColors[1] = [{ startCol: 0, endCol: teiHeaders.length - 1, color: ENROLLMENT_COLOR }];
  for (let si = 0; si < stages.length; si++) {
    const stage = stages[si];
    const dataElements = extractStageDataElements(stage);
    const label = stage.repeatable ? "(repeatable)" : "(single)";
    const headers = ["TEI_ID", "EVENT_DATE", ...buildOUHeaders(ouOpts, maxLevel)];
    for (const de of dataElements) {
      headers.push(`${de.name} [${de.id}]`);
    }
    const stageRows = [];
    for (const tei of trackedEntities) {
      const enrollment = tei.enrollments?.[0];
      const events = (enrollment?.events ?? []).filter(
        (e) => e.programStage === stage.id
      );
      for (const evt of events) {
        const dvMap = Object.fromEntries(
          (evt.dataValues ?? []).map((dv) => [dv.dataElement, dv.value])
        );
        const row = [
          tei.trackedEntity ?? "",
          evt.occurredAt?.slice(0, 10) ?? "",
          ...buildOURowCells(evt.orgUnit, ouOpts, ouMap2, maxLevel)
        ];
        for (const de of dataElements) {
          const raw = dvMap[de.id] ?? "";
          row.push(resolveOptionDisplay(raw, deOs[de.id], optDisplayMaps));
        }
        stageRows.push(row);
      }
    }
    const ws = XLSX2.utils.aoa_to_sheet([headers, ...stageRows]);
    setColumnWidths(ws, headers);
    let sheetName = `${stage.displayName} ${label}`.slice(0, 31);
    if (wb.SheetNames.includes(sheetName)) {
      sheetName = `${stage.displayName}`.slice(0, 28) + "...";
    }
    XLSX2.utils.book_append_sheet(wb, ws, sheetName);
    const sheetIdx = wb.SheetNames.length;
    sheetColors[sheetIdx] = [{ startCol: 0, endCol: headers.length - 1, color: STAGE_COLORS[si % STAGE_COLORS.length] }];
    const stageDvRules = [];
    if (valInfo.orgUnitRef) {
      stageDvRules.push({ col: 2, ref: valInfo.orgUnitRef, startRow: 2, maxRow: Math.max(1e3, stageRows.length + 10) });
    }
    const deStart = 2 + ouCols;
    for (let i = 0; i < dataElements.length; i++) {
      const osId = deOs[dataElements[i].id];
      if (osId && valInfo.optionRefs[osId]) {
        stageDvRules.push({ col: deStart + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: Math.max(1e3, stageRows.length + 10) });
      }
    }
    if (stageDvRules.length > 0) validationRules[sheetIdx] = stageDvRules;
  }
  if (wsValidation) {
    XLSX2.utils.book_append_sheet(wb, wsValidation, "Validation");
  }
  if (Object.keys(validationRules).length > 0) {
    wb._validationRules = validationRules;
  }
  const filename = `${metadata.displayName ?? "Tracker"}_Export_${today()}.xlsx`;
  return { wb, filename, sheetColors };
}
function buildEventExportWorkbook(eventsMap, metadata, options = {}) {
  const ouOpts = { ...DEFAULT_OU_OPTS, ...options };
  const ouMap2 = options.ouHierarchy?.map ?? {};
  const maxLevel = options.ouHierarchy?.maxLevel ?? 0;
  const ouCols = ouColCount(ouOpts, maxLevel);
  const wb = XLSX2.utils.book_new();
  const { wsValidation, valInfo } = buildValidationSheet(metadata);
  const { deOs } = buildOptionSetIndex(metadata);
  const { optDisplayMaps } = buildReverseLookups(metadata);
  const sheetColors = {};
  const validationRules = {};
  const stages = [...metadata.programStages ?? []].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  for (let si = 0; si < stages.length; si++) {
    const stage = stages[si];
    const dataElements = extractStageDataElements(stage);
    const headers = ["EVENT_DATE", ...buildOUHeaders(ouOpts, maxLevel)];
    for (const de of dataElements) {
      headers.push(`${de.name} [${de.id}]`);
    }
    const events = eventsMap[stage.id] ?? [];
    const rows = events.map((evt) => {
      const dvMap = Object.fromEntries(
        (evt.dataValues ?? []).map((dv) => [dv.dataElement, dv.value])
      );
      const row = [
        evt.occurredAt?.slice(0, 10) ?? "",
        ...buildOURowCells(evt.orgUnit, ouOpts, ouMap2, maxLevel)
      ];
      for (const de of dataElements) {
        const raw = dvMap[de.id] ?? "";
        row.push(resolveOptionDisplay(raw, deOs[de.id], optDisplayMaps));
      }
      return row;
    });
    const ws = XLSX2.utils.aoa_to_sheet([headers, ...rows]);
    setColumnWidths(ws, headers);
    let sheetName = stage.displayName.slice(0, 31);
    if (wb.SheetNames.includes(sheetName)) {
      sheetName = stage.displayName.slice(0, 28) + "...";
    }
    XLSX2.utils.book_append_sheet(wb, ws, sheetName);
    const sheetIdx = wb.SheetNames.length;
    sheetColors[sheetIdx] = [{ startCol: 0, endCol: headers.length - 1, color: STAGE_COLORS[si % STAGE_COLORS.length] }];
    const stageDvRules = [];
    if (valInfo.orgUnitRef) {
      stageDvRules.push({ col: 1, ref: valInfo.orgUnitRef, startRow: 2, maxRow: Math.max(1e3, rows.length + 10) });
    }
    const deStart = 1 + ouCols;
    for (let i = 0; i < dataElements.length; i++) {
      const osId = deOs[dataElements[i].id];
      if (osId && valInfo.optionRefs[osId]) {
        stageDvRules.push({ col: deStart + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: Math.max(1e3, rows.length + 10) });
      }
    }
    if (stageDvRules.length > 0) validationRules[sheetIdx] = stageDvRules;
  }
  if (wsValidation) {
    XLSX2.utils.book_append_sheet(wb, wsValidation, "Validation");
  }
  if (Object.keys(validationRules).length > 0) {
    wb._validationRules = validationRules;
  }
  const filename = `${metadata.displayName ?? "Events"}_Export_${today()}.xlsx`;
  return { wb, filename, sheetColors };
}
function buildDataEntryExportWorkbook(dataValues, metadata, options = {}) {
  const ouOpts = { ...DEFAULT_OU_OPTS, ...options };
  const ouMap2 = options.ouHierarchy?.map ?? {};
  const maxLevel = options.ouHierarchy?.maxLevel ?? 0;
  const wb = XLSX2.utils.book_new();
  const columns = buildDataEntryColumns(metadata);
  const headers = [...buildOUHeaders(ouOpts, maxLevel), "PERIOD", ...columns.map((c) => c.header)];
  const colIdx = {};
  columns.forEach((c, i) => {
    const key = c.cocId ? `${c.deId}.${c.cocId}` : c.deId;
    colIdx[key] = i;
  });
  const rowKey = (dv) => `${dv.orgUnit}||${dv.period}`;
  const grouped = {};
  for (const dv of dataValues) {
    const k = rowKey(dv);
    if (!grouped[k]) grouped[k] = { orgUnit: dv.orgUnit, period: dv.period, values: {} };
    const cKey = dv.categoryOptionCombo ? `${dv.dataElement}.${dv.categoryOptionCombo}` : dv.dataElement;
    grouped[k].values[cKey] = dv.value;
  }
  const rows = Object.values(grouped).map((g) => {
    const row = [
      ...buildOURowCells(g.orgUnit, ouOpts, ouMap2, maxLevel),
      g.period
    ];
    for (const col of columns) {
      const key = col.cocId ? `${col.deId}.${col.cocId}` : col.deId;
      row.push(g.values[key] ?? "");
    }
    return row;
  });
  const ws = XLSX2.utils.aoa_to_sheet([headers, ...rows]);
  setColumnWidths(ws, headers);
  XLSX2.utils.book_append_sheet(wb, ws, "Data Entry");
  const sheetColors = { 1: [{ startCol: 0, endCol: headers.length - 1, color: "4472C4" }] };
  const filename = `${metadata.displayName ?? "DataSet"}_Export_${today()}.xlsx`;
  return { wb, filename, sheetColors };
}
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function extractTeiAttributes(metadata) {
  return getTrackerAttributes(metadata).map((tea) => ({
    id: tea.trackedEntityAttribute?.id ?? tea.id,
    name: tea.trackedEntityAttribute?.displayName ?? tea.displayName,
    valueType: tea.trackedEntityAttribute?.valueType ?? tea.valueType
  }));
}
function extractStageDataElements(stage) {
  return stage.programStageDataElements?.map((psde) => ({
    id: psde.dataElement?.id ?? psde.id,
    name: psde.dataElement?.displayName ?? psde.displayName,
    valueType: psde.dataElement?.valueType ?? psde.valueType
  })) ?? [];
}
function buildDataEntryColumns(dataSet) {
  const columns = [];
  const dataElements = (dataSet.dataSetElements ?? []).map((dse) => dse.dataElement);
  const sections = [...dataSet.sections ?? []].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  let orderedDes;
  if (sections.length > 0) {
    const sectionDeIds = sections.flatMap((s) => (s.dataElements ?? []).map((de) => de.id));
    const deMap = Object.fromEntries(dataElements.map((de) => [de.id, de]));
    orderedDes = sectionDeIds.map((id) => deMap[id]).filter(Boolean);
    const grouped = new Set(sectionDeIds);
    for (const de of dataElements) {
      if (!grouped.has(de.id)) orderedDes.push(de);
    }
  } else {
    orderedDes = [...dataElements].sort(
      (a, b) => (a.displayName || "").localeCompare(b.displayName || "")
    );
  }
  for (const de of orderedDes) {
    const cc = de.categoryCombo;
    const cocs = cc?.categoryOptionCombos ?? [];
    if (cocs.length <= 1) {
      columns.push({ header: `${de.displayName} [${de.id}]`, deId: de.id, cocId: cocs[0]?.id ?? null });
    } else {
      for (const coc of cocs) {
        columns.push({ header: `${de.displayName} - ${coc.displayName} [${de.id}.${coc.id}]`, deId: de.id, cocId: coc.id });
      }
    }
  }
  return columns;
}

// test-harness/06-data-export.mjs
var result = { flow: "data-export", steps: [] };
var steps = result.steps;
function step(name, status, detail) {
  steps.push({ name, status, detail });
  ({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ": " + detail : ""}`);
}
var outDir = path.resolve("test-harness/.tmp");
fs.mkdirSync(outDir, { recursive: true });
try {
  section("Data export \u2014 Tracker");
  const PROGRAM_ID = "IpHINAT79UW";
  const trackerMeta = await api.get(`/api/programs/${PROGRAM_ID}?fields=id,displayName,programType,trackedEntityType[id,displayName,trackedEntityTypeAttributes[trackedEntityAttribute[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],programStages[id,displayName,repeatable,programStageDataElements[dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],organisationUnits[id,displayName]`);
  const tes = await api.get(`/api/tracker/trackedEntities?program=${PROGRAM_ID}&fields=trackedEntity,orgUnit,attributes,enrollments[program,orgUnit,enrolledAt,occurredAt,events[event,programStage,orgUnit,occurredAt,dataValues]]&pageSize=10&ouMode=ACCESSIBLE`);
  step("fetch TEs", "OK", `count=${tes.instances?.length ?? tes.trackedEntities?.length ?? 0}`);
  const teList = tes.instances ?? tes.trackedEntities ?? [];
  const { wb: wbTE } = buildTrackerExportWorkbook(teList, trackerMeta);
  const wbTracker = wbTE ?? buildTrackerExportWorkbook(teList, trackerMeta);
  const trackerBuf = XLSX3.write(wbTracker, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(path.join(outDir, "export-tracker.xlsx"), trackerBuf);
  const re1 = XLSX3.read(trackerBuf, { type: "buffer" });
  step("buildTrackerExportWorkbook", "OK", `sheets: ${re1.SheetNames.join(" | ")} bytes=${trackerBuf.length}`);
  section("Data export \u2014 Events");
  const EVENT_PROG = "eBAyeGv0exc";
  const eventMeta = await api.get(`/api/programs/${EVENT_PROG}?fields=id,displayName,programType,programStages[id,displayName,programStageDataElements[dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],organisationUnits[id,displayName]`);
  const events = await api.get(`/api/tracker/events?program=${EVENT_PROG}&pageSize=10&ouMode=ACCESSIBLE&fields=event,programStage,orgUnit,occurredAt,dataValues`);
  const eventList = events.instances ?? events.events ?? [];
  step("fetch events", "OK", `count=${eventList.length}`);
  const eventsByStage = {};
  for (const e of eventList) {
    (eventsByStage[e.programStage] ??= []).push(e);
  }
  const wbEvents = buildEventExportWorkbook(eventsByStage, eventMeta);
  const evBuf = XLSX3.write(wbEvents.wb ?? wbEvents, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(path.join(outDir, "export-events.xlsx"), evBuf);
  const re2 = XLSX3.read(evBuf, { type: "buffer" });
  step("buildEventExportWorkbook", "OK", `sheets: ${re2.SheetNames.join(" | ")} bytes=${evBuf.length}`);
  section("Data export \u2014 Aggregate");
  const DS = "lyLU2wR22tC";
  const dsMeta = await api.get(`/api/dataSets/${DS}?fields=id,displayName,periodType,dataSetElements[dataElement[id,displayName,valueType,categoryCombo[categoryOptionCombos[id,displayName]]]],organisationUnits[id,displayName]`);
  const orgUnit = dsMeta.organisationUnits[0].id;
  const dv = await api.get(`/api/dataValueSets?dataSet=${DS}&period=202401&orgUnit=${orgUnit}`);
  const dataValues = dv.dataValues ?? [];
  step("fetch dataValues", "OK", `count=${dataValues.length}`);
  const wbDE = buildDataEntryExportWorkbook(dataValues, dsMeta);
  const deBuf = XLSX3.write(wbDE.wb ?? wbDE, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(path.join(outDir, "export-dataentry.xlsx"), deBuf);
  const re3 = XLSX3.read(deBuf, { type: "buffer" });
  step("buildDataEntryExportWorkbook", "OK", `sheets: ${re3.SheetNames.join(" | ")} bytes=${deBuf.length}`);
} catch (e) {
  fail("HARNESS CRASH: " + (e.stack ?? e.message));
  process.exitCode = 1;
}
section("Summary");
var okCount = steps.filter((s) => s.status === "OK").length;
var failCount = steps.filter((s) => s.status === "FAIL").length;
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2));
fs.writeFileSync(path.resolve("test-harness/.tmp", "result-data-export.json"), JSON.stringify(result, null, 2));
