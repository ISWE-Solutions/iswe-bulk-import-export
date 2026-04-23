import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// test-harness/02-event.mjs
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

// src/lib/templateGenerator.js
import * as XLSX from "xlsx";
import { unzipSync, zipSync, strToU8 as strToU82, strFromU8 as strFromU82 } from "fflate";

// src/utils/xlsxFormatting.js
import { strToU8, strFromU8 } from "fflate";
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
function generateEventTemplate(program, metadata) {
  const wb = XLSX.utils.book_new();
  const { wsValidation, valInfo } = buildValidationSheet(metadata);
  const { deOs } = buildOptionSetIndex(metadata);
  const instructions = [
    ["Event Bulk Import Template"],
    [`Program: ${program.displayName}`],
    [`Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`],
    [],
    ["How to fill in this template:"],
    ["1. Each program stage has its own sheet for event data."],
    ["2. ORG_UNIT_ID identifies the organisation unit for the event."],
    ["3. EVENT_DATE is the date the event occurred (YYYY-MM-DD)."],
    ["4. Columns with an asterisk (*) are mandatory."],
    ["5. For option-set fields, select from the dropdown or use the CODE from the Validation sheet."],
    [],
    ["Column Types & Validation:"],
    ["  TEXT \u2014 free text"],
    ["  NUMBER \u2014 any numeric value (decimal allowed)"],
    ["  INTEGER \u2014 whole number only"],
    ["  DATE \u2014 YYYY-MM-DD format"],
    ["  BOOLEAN \u2014 true or false"],
    ["  TRUE_ONLY \u2014 true or leave blank"],
    ["  OPTION_SET \u2014 use code from Validation sheet (dropdown provided)"]
  ];
  const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
  XLSX.utils.book_append_sheet(wb, wsInstructions, "Instructions");
  const validationRules = {};
  const typeValidationRules = {};
  const stages = [...metadata.programStages ?? []].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  let sheetIdx = 2;
  for (const stage of stages) {
    const headers = ["ORG_UNIT_ID", "EVENT_DATE *"];
    const dataElements = stage.programStageDataElements?.map((psde) => ({
      id: psde.dataElement?.id ?? psde.id,
      name: psde.dataElement?.displayName ?? psde.displayName,
      compulsory: psde.compulsory,
      valueType: psde.dataElement?.valueType ?? psde.valueType
    })) ?? [];
    for (const de of dataElements) {
      const required = de.compulsory ? " *" : "";
      headers.push(`${de.name}${required} [${de.id}]`);
    }
    const wsStage = XLSX.utils.aoa_to_sheet([headers]);
    setColumnWidths(wsStage, headers);
    let sheetName = stage.displayName.slice(0, 31);
    if (wb.SheetNames.includes(sheetName)) {
      sheetName = `${stage.displayName}`.slice(0, 28) + "...";
    }
    XLSX.utils.book_append_sheet(wb, wsStage, sheetName);
    const stageDvRules = [];
    if (valInfo.orgUnitRef) {
      stageDvRules.push({ col: 0, ref: valInfo.orgUnitRef, startRow: 2, maxRow: 1e3 });
    }
    for (let i = 0; i < dataElements.length; i++) {
      const osId = deOs[dataElements[i].id];
      if (osId && valInfo.optionRefs[osId]) {
        stageDvRules.push({ col: 2 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: 1e3 });
      }
    }
    const stageTypeRules = [];
    stageTypeRules.push({ col: 1, startRow: 2, maxRow: 1e3, ...valueTypeToValidation("DATE") });
    for (let i = 0; i < dataElements.length; i++) {
      const osId = deOs[dataElements[i].id];
      if (osId && valInfo.optionRefs[osId]) continue;
      const vt = valueTypeToValidation(dataElements[i].valueType);
      if (vt) stageTypeRules.push({ col: 2 + i, startRow: 2, maxRow: 1e3, ...vt });
    }
    if (stageDvRules.length > 0) validationRules[sheetIdx] = stageDvRules;
    if (stageTypeRules.length > 0) typeValidationRules[sheetIdx] = stageTypeRules;
    sheetIdx++;
  }
  if (wsValidation) {
    XLSX.utils.book_append_sheet(wb, wsValidation, "Validation");
  }
  if (Object.keys(validationRules).length > 0) {
    wb._validationRules = validationRules;
  }
  if (Object.keys(typeValidationRules).length > 0) {
    wb._typeValidationRules = typeValidationRules;
  }
  return wb;
}
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
function valueTypeToValidation(valueType) {
  switch (valueType) {
    case "INTEGER":
      return {
        type: "whole",
        operator: "between",
        formula1: "-2147483648",
        formula2: "2147483647",
        errorTitle: "Invalid integer",
        error: "Please enter a whole number.",
        promptTitle: "Integer",
        prompt: "Enter a whole number."
      };
    case "POSITIVE_INTEGER":
      return {
        type: "whole",
        operator: "greaterThan",
        formula1: "0",
        errorTitle: "Invalid value",
        error: "Please enter a positive whole number (> 0).",
        promptTitle: "Positive integer",
        prompt: "Enter a whole number greater than 0."
      };
    case "NEGATIVE_INTEGER":
      return {
        type: "whole",
        operator: "lessThan",
        formula1: "0",
        errorTitle: "Invalid value",
        error: "Please enter a negative whole number (< 0).",
        promptTitle: "Negative integer",
        prompt: "Enter a whole number less than 0."
      };
    case "ZERO_OR_POSITIVE_INTEGER":
      return {
        type: "whole",
        operator: "greaterThanOrEqual",
        formula1: "0",
        errorTitle: "Invalid value",
        error: "Please enter zero or a positive whole number.",
        promptTitle: "Integer >= 0",
        prompt: "Enter 0 or a positive whole number."
      };
    case "NUMBER":
      return {
        type: "decimal",
        operator: "between",
        formula1: "-999999999999",
        formula2: "999999999999",
        errorTitle: "Invalid number",
        error: "Please enter a numeric value.",
        promptTitle: "Number",
        prompt: "Enter a numeric value."
      };
    case "PERCENTAGE":
      return {
        type: "decimal",
        operator: "between",
        formula1: "0",
        formula2: "100",
        errorTitle: "Invalid percentage",
        error: "Please enter a value between 0 and 100.",
        promptTitle: "Percentage",
        prompt: "Enter a value between 0 and 100."
      };
    case "UNIT_INTERVAL":
      return {
        type: "decimal",
        operator: "between",
        formula1: "0",
        formula2: "1",
        errorTitle: "Invalid value",
        error: "Please enter a value between 0 and 1.",
        promptTitle: "Unit interval",
        prompt: "Enter a decimal between 0 and 1."
      };
    case "DATE":
    case "AGE":
      return {
        type: "date",
        operator: "between",
        formula1: "1",
        formula2: "73415",
        errorTitle: "Invalid date",
        error: "Please enter a valid date (YYYY-MM-DD).",
        promptTitle: "Date",
        prompt: "Enter a date in YYYY-MM-DD format."
      };
    case "PHONE_NUMBER":
      return {
        type: "textLength",
        operator: "between",
        formula1: "7",
        formula2: "20",
        errorTitle: "Invalid phone number",
        error: "Phone number must be 7-20 characters.",
        promptTitle: "Phone number",
        prompt: "Enter a phone number (7-20 digits)."
      };
    case "EMAIL":
      return {
        type: "custom",
        customFormula: (cellRef) => `AND(LEN(${cellRef})>5,ISERROR(FIND(" ",${cellRef})),NOT(ISERROR(FIND("@",${cellRef}))),NOT(ISERROR(FIND(".",${cellRef},FIND("@",${cellRef})))))`,
        errorTitle: "Invalid email",
        error: "Please enter a valid email address.",
        promptTitle: "Email",
        prompt: "Enter a valid email address."
      };
    case "BOOLEAN":
      return {
        type: "list",
        listValues: '"true,false"',
        errorTitle: "Invalid value",
        error: "Please select true or false.",
        promptTitle: "Boolean",
        prompt: "Select true or false."
      };
    case "TRUE_ONLY":
      return {
        type: "list",
        listValues: '"true"',
        errorTitle: "Invalid value",
        error: 'Only "true" is allowed, or leave blank.',
        promptTitle: "True only",
        prompt: 'Enter "true" or leave blank.'
      };
    default:
      return null;
  }
}

// src/lib/fileParser.js
import * as XLSX2 from "xlsx";

// src/lib/dataCleaner.js
var MONTH_NAMES = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};
function parseDate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? "" : val.toISOString().split("T")[0];
  }
  if (typeof val === "number" && val > 3e4 && val < 8e4) {
    const date = new Date((val - 25569) * 86400 * 1e3);
    return date.toISOString().split("T")[0];
  }
  const s = String(val).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ymdSlash = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (ymdSlash) {
    return `${ymdSlash[1]}-${ymdSlash[2].padStart(2, "0")}-${ymdSlash[3].padStart(2, "0")}`;
  }
  const dmy = s.match(/^(\d{1,2})[-/\s]([A-Za-z]+)[-/\s](\d{4})$/);
  if (dmy) {
    const monthNum = MONTH_NAMES[dmy[2].toLowerCase()];
    if (monthNum) {
      return `${dmy[3]}-${monthNum}-${dmy[1].padStart(2, "0")}`;
    }
  }
  const mdy = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy) {
    const monthNum = MONTH_NAMES[mdy[1].toLowerCase()];
    if (monthNum) {
      return `${mdy[3]}-${monthNum}-${mdy[2].padStart(2, "0")}`;
    }
  }
  const numeric = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (numeric) {
    const [, a, b, year] = numeric;
    const ai = parseInt(a, 10);
    const bi = parseInt(b, 10);
    if (ai > 12 && bi <= 12) {
      return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
    }
    if (bi > 12 && ai <= 12) {
      return `${year}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
    }
    if (ai <= 12 && bi <= 12) {
      return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
    }
  }
  return s;
}
function normalizeBoolean(val, valueType) {
  if (!val) return val;
  const s = String(val).trim().toLowerCase();
  const trueValues = /* @__PURE__ */ new Set(["true", "yes", "y", "1", "oui", "si", "ja"]);
  const falseValues = /* @__PURE__ */ new Set(["false", "no", "n", "0", "non", "nein"]);
  if (valueType === "TRUE_ONLY") {
    return trueValues.has(s) ? "true" : "";
  }
  if (valueType === "BOOLEAN") {
    if (trueValues.has(s)) return "true";
    if (falseValues.has(s)) return "false";
  }
  return val;
}
function cleanInvisibleChars(val) {
  if (typeof val !== "string") return val;
  return val.replace(/\u200B|\u200C|\u200D|\uFEFF/g, "").replace(/\u00A0/g, " ").trim();
}

// src/lib/fileParser.js
function getSheetHeaders(workbook, sheetName, headerRow = 1) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const aoa = XLSX2.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false, range: headerRow - 1 });
  const first = aoa[0];
  if (!Array.isArray(first)) return [];
  return first.map((h) => h == null ? "" : String(h));
}
async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX2.read(buffer, { type: "array", cellDates: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const headers = getSheetHeaders(wb, name, 1);
    const ref = wb.Sheets[name]["!ref"];
    const range = ref ? XLSX2.utils.decode_range(ref) : null;
    const rowCount = range ? range.e.r - range.s.r : 0;
    sheets[name] = { headers, rowCount };
  }
  return { workbook: wb, sheets, sheetNames: wb.SheetNames };
}
function collectMetadataUids(metadata) {
  const known = /* @__PURE__ */ new Set();
  const displayByUid = {};
  const record = (id, name) => {
    if (!id) return;
    known.add(id);
    if (name && !displayByUid[id]) displayByUid[id] = name;
  };
  const attrWrappers = getTrackerAttributes(metadata);
  for (const wrap of attrWrappers) {
    const tea = wrap.trackedEntityAttribute ?? wrap;
    record(tea.id, tea.displayName);
  }
  for (const stage of metadata.programStages ?? []) {
    record(stage.id, stage.displayName);
    for (const psde of stage.programStageDataElements ?? []) {
      const de = psde.dataElement ?? psde;
      record(de.id, de.displayName);
    }
  }
  for (const dse of metadata.dataSetElements ?? []) {
    const de = dse.dataElement;
    record(de?.id, de?.displayName);
  }
  for (const coc of metadata.categoryCombo?.categoryOptionCombos ?? []) {
    record(coc.id, coc.displayName);
  }
  return { known, displayByUid };
}
function detectColumnDrift(workbook, metadata) {
  if (!workbook?.SheetNames?.length || !metadata) {
    return { unknownColumns: [], missingFields: [] };
  }
  const uidPattern = /\[([A-Za-z0-9]{11})(?:\.[A-Za-z0-9]{11})?\]/;
  const { known, displayByUid } = collectMetadataUids(metadata);
  const seenUids = /* @__PURE__ */ new Set();
  const unknownColumns = [];
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === "Validation" || sheetName === "Instructions") continue;
    const headers = getSheetHeaders(workbook, sheetName, 1);
    for (const header of headers) {
      const m = String(header).match(uidPattern);
      if (!m) continue;
      const uid = m[1];
      seenUids.add(uid);
      if (!known.has(uid)) {
        unknownColumns.push({ sheet: sheetName, header, uid });
      }
    }
  }
  const fieldUidSet = /* @__PURE__ */ new Set();
  const attrWrappers = getTrackerAttributes(metadata);
  for (const wrap of attrWrappers) {
    const tea = wrap.trackedEntityAttribute ?? wrap;
    if (tea.id) fieldUidSet.add(tea.id);
  }
  for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
      const de = psde.dataElement ?? psde;
      if (de.id) fieldUidSet.add(de.id);
    }
  }
  for (const dse of metadata.dataSetElements ?? []) {
    if (dse.dataElement?.id) fieldUidSet.add(dse.dataElement.id);
  }
  const missingFields = [];
  for (const uid of fieldUidSet) {
    if (!seenUids.has(uid)) {
      missingFields.push({ uid, displayName: displayByUid[uid] || uid });
    }
  }
  return { unknownColumns, missingFields };
}
function isAppTemplate(sheetsInfo) {
  const teiSheet = sheetsInfo["TEI + Enrollment"];
  if (!teiSheet) return false;
  const uidPattern = /\[([A-Za-z0-9]{11})\]\s*$/;
  const hasUidCols = teiSheet.headers.some((h) => uidPattern.test(h));
  const hasSystemCols = teiSheet.headers.some(
    (h) => ["TEI_ID", "ORG_UNIT_ID", "ENROLLMENT_DATE"].includes(h)
  );
  return hasUidCols && hasSystemCols;
}
function isEventTemplate(sheetsInfo, metadata) {
  const stages = metadata.programStages ?? [];
  const uidPattern = /\[([A-Za-z0-9]{11})\]\s*$/;
  for (const stage of stages) {
    const sheet = findSheetByStage(Object.keys(sheetsInfo), stage.displayName);
    if (!sheet) continue;
    const info2 = sheetsInfo[sheet];
    if (!info2) continue;
    const hasUidCols = info2.headers.some((h) => uidPattern.test(h));
    const hasSystemCols = info2.headers.some(
      (h) => ["ORG_UNIT_ID", "EVENT_DATE", "EVENT_DATE *"].includes(h)
    );
    if (hasUidCols && hasSystemCols) return true;
  }
  return false;
}
function detectHeaderRow(workbook, sheetName, metadata) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return 1;
  const range = sheet["!ref"] ? XLSX2.utils.decode_range(sheet["!ref"]) : null;
  if (!range) return 1;
  const knownTerms = /* @__PURE__ */ new Set();
  const systemCols = [
    "tei_id",
    "org_unit_id",
    "enrollment_date",
    "incident_date",
    "event_date",
    "s/n",
    "id",
    "orgunit",
    "organisation unit",
    "org unit",
    "date"
  ];
  for (const t of systemCols) knownTerms.add(t);
  const attrs = getAttributes(metadata);
  for (const a of attrs) {
    knownTerms.add(a.displayName.toLowerCase());
    knownTerms.add(a.id.toLowerCase());
    const stripped = stripPipePrefix(a.displayName.toLowerCase());
    if (stripped !== a.displayName.toLowerCase()) knownTerms.add(stripped);
  }
  for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
      const de = psde.dataElement ?? psde;
      knownTerms.add(de.displayName.toLowerCase());
      knownTerms.add(de.id.toLowerCase());
      const stripped = stripPipePrefix(de.displayName.toLowerCase());
      if (stripped !== de.displayName.toLowerCase()) knownTerms.add(stripped);
    }
  }
  const maxRow = Math.min(range.e.r, 9);
  let bestRow = 0;
  let bestScore = 0;
  for (let r = range.s.r; r <= maxRow; r++) {
    let score = 0;
    let cellCount = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX2.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || cell.v == null) continue;
      cellCount++;
      const val = String(cell.v).toLowerCase().trim();
      if (!val) continue;
      if (knownTerms.has(val)) {
        score += 2;
        continue;
      }
      const stripped = stripPipePrefix(normalize(val));
      if (knownTerms.has(stripped)) {
        score += 2;
        continue;
      }
      if (/\[[A-Za-z0-9]{11}\]/.test(val)) {
        score += 2;
        continue;
      }
      for (const term of knownTerms) {
        if (term.length >= 3 && (val.includes(term) || term.includes(val))) {
          score += 1;
          break;
        }
      }
    }
    if (cellCount < 3) score = Math.max(0, score - 2);
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow + 1;
}
function buildAutoMapping(sheetsInfo, metadata, workbook) {
  const mapping = {
    teiSheet: "",
    headerRow: 1,
    teiIdColumn: "",
    orgUnitColumn: "",
    enrollmentDateColumn: "",
    incidentDateColumn: "",
    attributeMapping: {},
    stages: {}
  };
  const allSheetNames = Object.keys(sheetsInfo).filter((n) => n !== "Validation");
  const teiSheetName = findBestSheet(allSheetNames, [
    "TEI + Enrollment",
    "TEI",
    "Enrollment",
    "Registration",
    "Beneficiar",
    "Data Entry"
  ]) || (allSheetNames.length > 0 ? allSheetNames[0] : null);
  if (!teiSheetName) return mapping;
  mapping.teiSheet = teiSheetName;
  let detectedHeaderRow = 1;
  if (workbook) {
    detectedHeaderRow = detectHeaderRow(workbook, teiSheetName, metadata);
  }
  mapping.headerRow = detectedHeaderRow;
  const teiHeaders = workbook ? getSheetHeaders(workbook, teiSheetName, detectedHeaderRow) : sheetsInfo[teiSheetName].headers;
  mapping.teiIdColumn = findBestColumn(teiHeaders, [
    "TEI_ID",
    "tei_id",
    "S/N",
    "ID",
    "Row",
    "No",
    "#"
  ]) || "";
  mapping.orgUnitColumn = findBestColumn(teiHeaders, [
    "ORG_UNIT_ID",
    "org_unit",
    "Organisation Unit",
    "Org Unit",
    "OrgUnit",
    "orgUnit",
    "District",
    "Facility",
    "Club Name"
  ]) || "";
  mapping.enrollmentDateColumn = findBestColumn(teiHeaders, [
    "ENROLLMENT_DATE",
    "Enrollment Date",
    "enrollment_date",
    "Registration Date",
    "Date of Registration",
    "Date Enrolled"
  ]) || "";
  mapping.incidentDateColumn = findBestColumn(teiHeaders, [
    "INCIDENT_DATE",
    "Incident Date",
    "incident_date",
    "Date of Incident",
    "Occurrence Date"
  ]) || "";
  const attrs = getAttributes(metadata);
  for (const attr of attrs) {
    const col = matchColumn(teiHeaders, attr.id, attr.displayName);
    if (col) {
      mapping.attributeMapping[attr.id] = col;
    }
  }
  const stages = metadata.programStages ?? [];
  for (const stage of stages) {
    let sheetName = findBestSheet(allSheetNames, [
      stage.displayName,
      stage.displayName.slice(0, 25),
      stage.id
    ]);
    if (!sheetName) sheetName = teiSheetName;
    const stageHeaderRow = sheetName === teiSheetName ? detectedHeaderRow : workbook ? detectHeaderRow(workbook, sheetName, metadata) : 1;
    const stageMapping = {
      sheet: sheetName,
      headerRow: stageHeaderRow,
      teiIdColumn: "",
      eventGroups: []
    };
    const stageHeaders = workbook ? getSheetHeaders(workbook, sheetName, stageHeaderRow) : sheetsInfo[sheetName]?.headers ?? [];
    if (sheetName !== teiSheetName) {
      stageMapping.teiIdColumn = findBestColumn(stageHeaders, [
        "TEI_ID",
        "tei_id",
        "S/N",
        "ID",
        "Row",
        "No"
      ]) || "";
    }
    const des = stage.programStageDataElements ?? [];
    const repeatedGroups = stage.repeatable && workbook ? detectRepeatedColumnGroups(workbook, sheetName, stageHeaderRow, des, stage.displayName) : null;
    if (repeatedGroups && repeatedGroups.length > 1) {
      for (const rg of repeatedGroups) {
        stageMapping.eventGroups.push(rg);
      }
    } else {
      const stageDateCandidates = [
        `${stage.displayName}-Date`,
        `${stage.displayName} Date`,
        ...stripPrefix(stage.displayName).flatMap((n) => [`${n}-Date`, `${n} Date`]),
        "EVENT_DATE",
        "Event Date",
        "event_date",
        "Date",
        "Training Date",
        "Session Date",
        "Date of Event"
      ];
      const eventGroup = {
        eventDateColumn: findBestColumn(stageHeaders, stageDateCandidates) || "",
        orgUnitColumn: findBestColumn(stageHeaders, [
          "ORG_UNIT_ID",
          "org_unit",
          "Organisation Unit",
          "Org Unit",
          "District",
          "Facility"
        ]) || "",
        dataElementMapping: {}
      };
      for (const psde of des) {
        const de = psde.dataElement ?? psde;
        const col = matchColumn(stageHeaders, de.id, de.displayName);
        if (col) {
          eventGroup.dataElementMapping[de.id] = col;
        }
      }
      stageMapping.eventGroups.push(eventGroup);
    }
    mapping.stages[stage.id] = stageMapping;
    const totalGroups = stageMapping.eventGroups.length;
    const mappedDEs = stageMapping.eventGroups.reduce((n, g) => n + Object.values(g.dataElementMapping ?? {}).filter(Boolean).length, 0);
    const hasDate = stageMapping.eventGroups.some((g) => g.eventDateColumn);
    console.log(
      `[AutoMap] ${stage.displayName} (${stage.id}): sheet="${sheetName}" row=${stageHeaderRow} groups=${totalGroups} DEs=${mappedDEs}/${des.length} date=${hasDate}`
    );
  }
  if (mapping.orgUnitColumn) {
    for (const stageMap of Object.values(mapping.stages)) {
      for (const group of stageMap.eventGroups ?? []) {
        if (!group.orgUnitColumn) {
          group.orgUnitColumn = mapping.orgUnitColumn;
        }
      }
    }
  }
  return mapping;
}
function applyMapping(workbook, mapping, metadata) {
  const orgUnitMap = buildOrgUnitMap(metadata.organisationUnits ?? []);
  const optMaps = buildOptionMaps(metadata);
  const vtIndex = buildValueTypeIndex(metadata);
  const result2 = { trackedEntities: [], stageData: {} };
  const teiSheet = workbook.Sheets[mapping.teiSheet];
  if (!teiSheet) {
    throw new Error(`Sheet "${mapping.teiSheet}" not found in workbook.`);
  }
  const teiHeaderRow = mapping.headerRow || 1;
  const teiRows = XLSX2.utils.sheet_to_json(teiSheet, { defval: "", range: teiHeaderRow - 1 });
  const seenTeiIds = /* @__PURE__ */ new Set();
  for (let i = 0; i < teiRows.length; i++) {
    const row = teiRows[i];
    const teiId = mapping.teiIdColumn ? String(row[mapping.teiIdColumn] ?? "").trim() : String(i + 1);
    if (!teiId || seenTeiIds.has(teiId)) continue;
    seenTeiIds.add(teiId);
    const attributes = {};
    for (const [attrId, col] of Object.entries(mapping.attributeMapping)) {
      const val = row[col];
      if (val !== "" && val != null) {
        const formatted = formatValue(val);
        attributes[attrId] = normalizeByType(resolveOption(formatted, optMaps.attrs[attrId]), vtIndex.attrs[attrId]);
      }
    }
    const rawOrgUnit = mapping.orgUnitColumn ? String(row[mapping.orgUnitColumn] ?? "").trim() : "";
    const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap);
    result2.trackedEntities.push({
      teiId,
      orgUnit,
      enrollmentDate: mapping.enrollmentDateColumn ? formatDate(row[mapping.enrollmentDateColumn]) : "",
      incidentDate: mapping.incidentDateColumn ? formatDate(row[mapping.incidentDateColumn]) : "",
      attributes
    });
  }
  for (const [stageId, stageMap] of Object.entries(mapping.stages)) {
    if (!stageMap.sheet) continue;
    const stageSheet = workbook.Sheets[stageMap.sheet];
    if (!stageSheet) continue;
    const eventGroups = stageMap.eventGroups ?? [];
    if (eventGroups.length === 0) continue;
    const sameSheet = stageMap.sheet === mapping.teiSheet;
    const stageHeaderRow = stageMap.headerRow || 1;
    const stageRows = sameSheet ? teiRows : XLSX2.utils.sheet_to_json(stageSheet, { defval: "", range: stageHeaderRow - 1 });
    const events = [];
    for (let i = 0; i < stageRows.length; i++) {
      const row = stageRows[i];
      let teiId;
      if (sameSheet) {
        teiId = mapping.teiIdColumn ? String(row[mapping.teiIdColumn] ?? "").trim() : String(i + 1);
      } else {
        teiId = stageMap.teiIdColumn ? String(row[stageMap.teiIdColumn] ?? "").trim() : String(i + 1);
      }
      if (!teiId) continue;
      for (const group of eventGroups) {
        const dataValues = {};
        for (const [deId, col] of Object.entries(group.dataElementMapping ?? {})) {
          if (!col) continue;
          const val = row[col];
          if (val !== "" && val != null) {
            const formatted = formatValue(val);
            dataValues[deId] = normalizeByType(resolveOption(formatted, optMaps.des[deId]), vtIndex.des[deId]);
          }
        }
        if (Object.keys(dataValues).length === 0) continue;
        const rawOrgUnit = group.orgUnitColumn ? String(row[group.orgUnitColumn] ?? "").trim() : "";
        const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap);
        events.push({
          teiId,
          eventDate: group.eventDateColumn ? formatDate(row[group.eventDateColumn]) : "",
          orgUnit,
          dataValues
        });
      }
    }
    result2.stageData[stageId] = events;
  }
  return result2;
}
async function parseUploadedFile(file, metadata) {
  const { workbook, sheets } = await readWorkbook(file);
  const isEvent = metadata.programType === "WITHOUT_REGISTRATION";
  const drift = detectColumnDrift(workbook, metadata);
  const attachDrift = (result2) => {
    if (result2 && (drift.unknownColumns.length || drift.missingFields.length)) {
      result2.__drift = drift;
    }
    return result2;
  };
  if (isEvent && isEventTemplate(sheets, metadata)) {
    return attachDrift(parseEventTemplateWorkbook(workbook, metadata));
  }
  if (!isEvent && isAppTemplate(sheets)) {
    return attachDrift(parseTemplateWorkbook(workbook, metadata));
  }
  if (isEvent) {
    const mapping2 = buildEventAutoMapping(sheets, metadata, workbook);
    return attachDrift(applyEventMapping(workbook, mapping2, metadata));
  }
  const mapping = buildAutoMapping(sheets, metadata, workbook);
  return attachDrift(applyMapping(workbook, mapping, metadata));
}
function parseTemplateWorkbook(wb, metadata) {
  const result2 = { trackedEntities: [], stageData: {} };
  const orgUnitMap = buildOrgUnitMap(metadata.organisationUnits ?? []);
  const optMaps = buildOptionMaps(metadata);
  const vtIndex = buildValueTypeIndex(metadata);
  const attrLookup = buildAttributeLookup(metadata);
  const teiSheet = wb.Sheets["TEI + Enrollment"];
  if (!teiSheet) {
    throw new Error('Missing "TEI + Enrollment" sheet in the uploaded file.');
  }
  const teiRows = XLSX2.utils.sheet_to_json(teiSheet, { defval: "" });
  if (teiRows.length === 0) {
    throw new Error('"TEI + Enrollment" sheet has no data rows.');
  }
  const teiHeaders = Object.keys(teiRows[0]);
  const attrColumns = resolveColumns(teiHeaders, attrLookup);
  for (const row of teiRows) {
    const teiId = String(row["TEI_ID"] ?? "").trim();
    if (!teiId) continue;
    const attributes = {};
    for (const [col, attrId] of Object.entries(attrColumns)) {
      const val = row[col];
      if (val !== "" && val != null) {
        const formatted = formatValue(val);
        attributes[attrId] = normalizeByType(resolveOption(formatted, optMaps.attrs[attrId]), vtIndex.attrs[attrId]);
      }
    }
    const rawOrgUnit = String(row["ORG_UNIT_ID"] ?? "").trim();
    const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap);
    result2.trackedEntities.push({
      teiId,
      orgUnit,
      enrollmentDate: formatDate(row["ENROLLMENT_DATE"]),
      incidentDate: formatDate(row["INCIDENT_DATE"]),
      attributes
    });
  }
  const stages = metadata.programStages ?? [];
  for (const stage of stages) {
    const sheetName = findStageSheet(wb.SheetNames, stage.displayName);
    if (!sheetName) continue;
    const stageSheet = wb.Sheets[sheetName];
    const stageRows = XLSX2.utils.sheet_to_json(stageSheet, { defval: "" });
    if (stageRows.length === 0) continue;
    const stageHeaders = Object.keys(stageRows[0]);
    const stageDeLookup = buildStageDeLookup(stage);
    const deColumns = resolveColumns(stageHeaders, stageDeLookup);
    const events = [];
    for (const row of stageRows) {
      const teiId = String(row["TEI_ID"] ?? "").trim();
      if (!teiId) continue;
      const dataValues = {};
      for (const [col, deId] of Object.entries(deColumns)) {
        const val = row[col];
        if (val !== "" && val != null) {
          const formatted = formatValue(val);
          dataValues[deId] = normalizeByType(resolveOption(formatted, optMaps.des[deId]), vtIndex.des[deId]);
        }
      }
      const rawOrgUnit = String(row["ORG_UNIT_ID"] ?? "").trim();
      const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap);
      events.push({
        teiId,
        eventDate: formatDate(row["EVENT_DATE"]),
        orgUnit,
        dataValues
      });
    }
    result2.stageData[stage.id] = events;
  }
  return result2;
}
function parseEventTemplateWorkbook(wb, metadata) {
  const result2 = { events: {} };
  const orgUnitMap = buildOrgUnitMap(metadata.organisationUnits ?? []);
  const optMaps = buildOptionMaps(metadata);
  const vtIndex = buildValueTypeIndex(metadata);
  const stages = metadata.programStages ?? [];
  for (const stage of stages) {
    const sheetName = findSheetByStage(wb.SheetNames, stage.displayName);
    if (!sheetName) continue;
    const stageSheet = wb.Sheets[sheetName];
    const stageRows = XLSX2.utils.sheet_to_json(stageSheet, { defval: "" });
    if (stageRows.length === 0) continue;
    const stageHeaders = Object.keys(stageRows[0]);
    const stageDeLookup = buildStageDeLookup(stage);
    const deColumns = resolveColumns(stageHeaders, stageDeLookup);
    const events = [];
    for (const row of stageRows) {
      const rawOrgUnit = String(row["ORG_UNIT_ID"] ?? "").trim();
      if (!rawOrgUnit) continue;
      const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap);
      const eventDate = formatDate(row["EVENT_DATE *"] ?? row["EVENT_DATE"]);
      const dataValues = {};
      for (const [col, deId] of Object.entries(deColumns)) {
        const val = row[col];
        if (val !== "" && val != null) {
          const formatted = formatValue(val);
          dataValues[deId] = normalizeByType(resolveOption(formatted, optMaps.des[deId]), vtIndex.des[deId]);
        }
      }
      events.push({ orgUnit, eventDate, dataValues });
    }
    result2.events[stage.id] = events;
  }
  return result2;
}
function buildEventAutoMapping(sheetsInfo, metadata, workbook) {
  const mapping = { stages: {} };
  const allSheetNames = Object.keys(sheetsInfo).filter((n) => n !== "Validation" && n !== "Instructions");
  const stages = metadata.programStages ?? [];
  for (const stage of stages) {
    let sheetName = findBestSheet(allSheetNames, [
      stage.displayName,
      stage.displayName.slice(0, 25),
      stage.id
    ]);
    if (!sheetName && allSheetNames.length > 0) {
      sheetName = allSheetNames[0];
    }
    if (!sheetName) continue;
    const stageHeaderRow = workbook ? detectHeaderRow(workbook, sheetName, metadata) : 1;
    const stageHeaders = workbook ? getSheetHeaders(workbook, sheetName, stageHeaderRow) : sheetsInfo[sheetName]?.headers ?? [];
    const des = stage.programStageDataElements ?? [];
    const eventGroup = {
      eventDateColumn: findBestColumn(stageHeaders, [
        "EVENT_DATE",
        "EVENT_DATE *",
        "Event Date",
        "Date",
        "event_date",
        `${stage.displayName}-Date`,
        `${stage.displayName} Date`
      ]) || "",
      orgUnitColumn: findBestColumn(stageHeaders, [
        "ORG_UNIT_ID",
        "org_unit",
        "Organisation Unit",
        "Org Unit",
        "District",
        "Facility"
      ]) || "",
      dataElementMapping: {}
    };
    for (const psde of des) {
      const de = psde.dataElement ?? psde;
      const col = matchColumn(stageHeaders, de.id, de.displayName);
      if (col) {
        eventGroup.dataElementMapping[de.id] = col;
      }
    }
    mapping.stages[stage.id] = {
      sheet: sheetName,
      headerRow: stageHeaderRow,
      eventGroups: [eventGroup]
    };
  }
  if (mapping.orgUnitColumn) {
    for (const stageMap of Object.values(mapping.stages)) {
      for (const group of stageMap.eventGroups ?? []) {
        if (!group.orgUnitColumn) {
          group.orgUnitColumn = mapping.orgUnitColumn;
        }
      }
    }
  }
  return mapping;
}
function applyEventMapping(workbook, mapping, metadata) {
  const orgUnitMap = buildOrgUnitMap(metadata.organisationUnits ?? []);
  const optMaps = buildOptionMaps(metadata);
  const vtIndex = buildValueTypeIndex(metadata);
  const result2 = { events: {} };
  for (const [stageId, stageMap] of Object.entries(mapping.stages)) {
    if (!stageMap.sheet) continue;
    const stageSheet = workbook.Sheets[stageMap.sheet];
    if (!stageSheet) continue;
    const eventGroups = stageMap.eventGroups ?? [];
    if (eventGroups.length === 0) continue;
    const stageHeaderRow = stageMap.headerRow || 1;
    const stageRows = XLSX2.utils.sheet_to_json(stageSheet, { defval: "", range: stageHeaderRow - 1 });
    const events = [];
    for (let i = 0; i < stageRows.length; i++) {
      const row = stageRows[i];
      for (const group of eventGroups) {
        const dataValues = {};
        for (const [deId, col] of Object.entries(group.dataElementMapping ?? {})) {
          if (!col) continue;
          const val = row[col];
          if (val !== "" && val != null) {
            const formatted = formatValue(val);
            dataValues[deId] = normalizeByType(resolveOption(formatted, optMaps.des[deId]), vtIndex.des[deId]);
          }
        }
        if (Object.keys(dataValues).length === 0) continue;
        const rawOrgUnit = group.orgUnitColumn ? String(row[group.orgUnitColumn] ?? "").trim() : "";
        const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap);
        events.push({
          orgUnit,
          eventDate: group.eventDateColumn ? formatDate(row[group.eventDateColumn]) : "",
          dataValues
        });
      }
    }
    result2.events[stageId] = events;
  }
  return result2;
}
function findSheetByStage(sheetNames, stageName) {
  const lower = stageName.toLowerCase();
  return sheetNames.find((n) => n.toLowerCase() === lower) || sheetNames.find((n) => n.toLowerCase().startsWith(lower.slice(0, 25))) || null;
}
function getAttributes(metadata) {
  return getTrackerAttributes(metadata).map((a) => {
    const tea = a.trackedEntityAttribute ?? a;
    return { id: tea.id, displayName: tea.displayName };
  });
}
function readRawRow(sheet, rowIdx) {
  const range = sheet["!ref"] ? XLSX2.utils.decode_range(sheet["!ref"]) : null;
  if (!range) return [];
  const cells = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX2.utils.encode_cell({ r: rowIdx, c });
    const cell = sheet[addr];
    cells.push({ col: c, value: cell ? String(cell.v ?? "").trim() : "" });
  }
  return cells;
}
function detectRepeatedColumnGroups(workbook, sheetName, headerRow, des, stageName) {
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet || des.length === 0) return null;
  const headers = getSheetHeaders(workbook, sheetName, headerRow);
  if (headers.length === 0) return null;
  if (headerRow > 1) {
    const groups2 = detectFromCategoryRow(sheet, headerRow, headers, des, stageName);
    if (groups2 && groups2.length > 1) return groups2;
  }
  const groups = detectFromSuffixPatterns(headers, des, stageName);
  if (groups && groups.length > 1) return groups;
  return null;
}
function detectFromCategoryRow(sheet, headerRow, headers, des, stageName) {
  const catRowIdx = headerRow - 2;
  const catCells = readRawRow(sheet, catRowIdx);
  if (catCells.length === 0) return null;
  const stageNameLower = stageName.toLowerCase();
  const stageStripped = stripPipePrefix(stageNameLower);
  const filledCat = [];
  let lastVal = "";
  for (const cell of catCells) {
    if (cell.value) lastVal = cell.value;
    filledCat.push({ col: cell.col, value: lastVal });
  }
  const merges = sheet["!merges"] ?? [];
  for (const merge of merges) {
    if (merge.s.r !== catRowIdx) continue;
    const addr = XLSX2.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
    const cell = sheet[addr];
    const val = cell ? String(cell.v ?? "").trim() : "";
    for (let c = merge.s.c; c <= merge.e.c; c++) {
      const idx = filledCat.findIndex((f) => f.col === c);
      if (idx >= 0) filledCat[idx].value = val;
    }
  }
  const stageGroups = [];
  let currentGroup = null;
  let prevCatValue = null;
  for (const cell of filledCat) {
    const cellLower = cell.value.toLowerCase();
    const matches = cellLower === stageNameLower || cellLower === stageStripped || stripPipePrefix(cellLower) === stageStripped || cellLower.includes(stageStripped) || stageStripped.includes(cellLower);
    if (matches) {
      if (prevCatValue === null || cellLower !== prevCatValue) {
        currentGroup = [];
        stageGroups.push(currentGroup);
      }
      currentGroup.push(cell.col);
      prevCatValue = cellLower;
    } else {
      prevCatValue = null;
    }
  }
  if (stageGroups.length < 2) return null;
  const headerRowIdx = headerRow - 1;
  const headerCells = readRawRow(sheet, headerRowIdx);
  const colToHeader = {};
  for (let i = 0; i < headers.length; i++) {
    if (i < headerCells.length) {
      colToHeader[headerCells[i].col] = headers[i];
    }
  }
  const groups = [];
  for (const colGroup of stageGroups) {
    const groupHeaders = colGroup.map((c) => colToHeader[c]).filter(Boolean);
    if (groupHeaders.length === 0) continue;
    const baseHeaders = groupHeaders.map((h) => h.replace(/_\d+$/, ""));
    const baseToActual = Object.fromEntries(
      groupHeaders.map((h, i) => [baseHeaders[i], h])
    );
    const deMapping = {};
    let mappedCount = 0;
    for (const psde of des) {
      const de = psde.dataElement ?? psde;
      const baseMatch = matchColumn(baseHeaders, de.id, de.displayName);
      if (baseMatch) {
        deMapping[de.id] = baseToActual[baseMatch] || baseMatch;
        mappedCount++;
      }
    }
    if (mappedCount === 0) continue;
    const dateCandidates = [
      "Date",
      "Event Date",
      `${stageName} Date`,
      `${stageName}-Date`,
      "Training Date",
      "Session Date"
    ];
    const baseDateMatch = findBestColumn(baseHeaders, dateCandidates);
    groups.push({
      eventDateColumn: baseDateMatch ? baseToActual[baseDateMatch] || baseDateMatch : "",
      orgUnitColumn: findBestColumn(groupHeaders, ["Org Unit", "Organisation Unit", "District", "Facility"]) || "",
      dataElementMapping: deMapping
    });
  }
  return groups.length > 1 ? groups : null;
}
function detectFromSuffixPatterns(headers, des, stageName) {
  function parseHeader(header) {
    const h = header.trim();
    const sheetjsDedup = h.match(/^(.+?)_(\d+)$/);
    if (sheetjsDedup) return { base: sheetjsDedup[1].trim(), index: parseInt(sheetjsDedup[2], 10) };
    const trailingNum = h.match(/^(.+?)\s+(\d+)\s*$/);
    if (trailingNum) return { base: trailingNum[1].trim(), index: parseInt(trailingNum[2], 10) };
    const parenNum = h.match(/^(.+?)\s*\((\d+)\)\s*$/);
    if (parenNum) return { base: parenNum[1].trim(), index: parseInt(parenNum[2], 10) };
    const midParen = h.match(/^(.+?)\s*\((\d+)\)\s*[-–]\s*(.+)$/);
    if (midParen) return { base: `${midParen[1].trim()}-${midParen[3].trim()}`, index: parseInt(midParen[2], 10) };
    const leadingDot = h.match(/^(\d+)\.\s*(.+)$/);
    if (leadingDot) return { base: leadingDot[2].trim(), index: parseInt(leadingDot[1], 10) };
    const prefixDash = h.match(/^(?:\w+\s+)?(\d+)\s*[-–]\s*(.+)$/);
    if (prefixDash) return { base: prefixDash[2].trim(), index: parseInt(prefixDash[1], 10) };
    return null;
  }
  const baseGroups = {};
  const unsuffixed = [];
  for (const h of headers) {
    const parsed = parseHeader(h);
    if (parsed) {
      const key = parsed.base.toLowerCase();
      if (!baseGroups[key]) baseGroups[key] = [];
      baseGroups[key].push({ header: h, index: parsed.index });
    } else {
      unsuffixed.push(h);
    }
  }
  for (const h of unsuffixed) {
    const key = h.toLowerCase();
    if (baseGroups[key]) {
      baseGroups[key].push({ header: h, index: 0 });
    }
  }
  const allIndices = /* @__PURE__ */ new Set();
  for (const [, entries] of Object.entries(baseGroups)) {
    if (entries.length < 2) continue;
    for (const e of entries) allIndices.add(e.index);
  }
  if (allIndices.size < 2) return null;
  const sortedIndices = [...allIndices].sort((a, b) => a - b);
  const groups = [];
  for (const idx of sortedIndices) {
    const indexEntries = [];
    for (const [baseName, entries] of Object.entries(baseGroups)) {
      const entry = entries.find((e) => e.index === idx);
      if (entry) indexEntries.push({ header: entry.header, base: entry.header.replace(/_\d+$/, "") });
    }
    if (indexEntries.length === 0) continue;
    const baseHeaders = indexEntries.map((e) => e.base);
    const baseToActual = Object.fromEntries(indexEntries.map((e) => [e.base, e.header]));
    const deMapping = {};
    let mappedCount = 0;
    for (const psde of des) {
      const de = psde.dataElement ?? psde;
      const baseMatch = matchColumn(baseHeaders, de.id, de.displayName);
      if (baseMatch) {
        deMapping[de.id] = baseToActual[baseMatch] || baseMatch;
        mappedCount++;
      }
    }
    const minMatches = Math.ceil(des.length * 0.4);
    if (mappedCount < minMatches) continue;
    const dateCandidates = [
      `${stageName}-Date`,
      `${stageName} Date`,
      "Date",
      "Event Date",
      "Training Date",
      "Session Date"
    ];
    const baseDateMatch = findBestColumn(baseHeaders, dateCandidates);
    const eventDateColumn = baseDateMatch ? baseToActual[baseDateMatch] || baseDateMatch : "";
    groups.push({
      eventDateColumn,
      orgUnitColumn: "",
      dataElementMapping: deMapping
    });
  }
  return groups.length > 1 ? groups : null;
}
function findBestSheet(sheetNames, candidates) {
  for (const c of candidates) {
    const lower = c.toLowerCase();
    const match = sheetNames.find((s) => s.toLowerCase() === lower);
    if (match) return match;
  }
  for (const c of candidates) {
    const lower = c.toLowerCase();
    const match = sheetNames.find((s) => s.toLowerCase().startsWith(lower));
    if (match) return match;
  }
  for (const c of candidates) {
    if (c.length < 3) continue;
    const lower = c.toLowerCase();
    const match = sheetNames.find((s) => s.toLowerCase().includes(lower));
    if (match) return match;
  }
  return null;
}
function findBestColumn(headers, candidates) {
  for (const c of candidates) {
    const lower = c.toLowerCase();
    const match = headers.find((h) => h.toLowerCase() === lower);
    if (match) return match;
  }
  for (const c of candidates) {
    const lower = c.toLowerCase();
    if (lower.length < 3) continue;
    const match = headers.find((h) => h.toLowerCase().includes(lower));
    if (match) return match;
  }
  for (const c of candidates) {
    const lower = stripPipePrefix(c.toLowerCase());
    if (lower.length < 3) continue;
    const match = headers.find((h) => stripPipePrefix(h.toLowerCase()) === lower);
    if (match) return match;
  }
  return null;
}
function matchColumn(headers, uid, displayName) {
  const uidMatch = headers.find((h) => h.includes(`[${uid}]`));
  if (uidMatch) return uidMatch;
  const uidExact = headers.find((h) => h === uid);
  if (uidExact) return uidExact;
  const lower = displayName.toLowerCase();
  const nameExact = headers.find((h) => h.toLowerCase() === lower);
  if (nameExact) return nameExact;
  const cleanLower = normalize(lower);
  const nameClean = headers.find((h) => normalize(h.toLowerCase()) === cleanLower);
  if (nameClean) return nameClean;
  const strippedField = stripPipePrefix(cleanLower);
  for (const h of headers) {
    const strippedHeader = stripPipePrefix(normalize(h.toLowerCase()));
    if (strippedField === strippedHeader) return h;
  }
  if (displayName.length >= 3) {
    const best = fuzzyBestMatch(headers, displayName);
    if (best) return best;
  }
  return null;
}
function stripPipePrefix(s) {
  const pipeIdx = s.lastIndexOf("|");
  return pipeIdx >= 0 ? s.slice(pipeIdx + 1).trim() : s;
}
function stripPrefix(displayName) {
  const stripped = stripPipePrefix(displayName.toLowerCase());
  return stripped !== displayName.toLowerCase() ? [stripped] : [];
}
function normalize(s) {
  return s.replace(/\s*\*\s*/g, "").replace(/\(yyyy-mm-dd\)/gi, "").replace(/\s*-date\s*$/i, "").replace(/^imp_/i, "").replace(/\s+/g, " ").trim();
}
function tokenize(s) {
  const cleaned = normalize(s.toLowerCase());
  const core = stripPipePrefix(cleaned);
  return core.split(/[\s\-_/,()]+/).filter((t) => t.length >= 2);
}
function fuzzyScore(fieldName, headerName) {
  const fieldTokens = tokenize(fieldName);
  const headerTokens = tokenize(headerName);
  if (fieldTokens.length === 0 || headerTokens.length === 0) return 0;
  let matches = 0;
  const usedHeader = /* @__PURE__ */ new Set();
  for (const ft of fieldTokens) {
    for (let hi = 0; hi < headerTokens.length; hi++) {
      if (usedHeader.has(hi)) continue;
      const ht = headerTokens[hi];
      if (ft === ht || ft.includes(ht) || ht.includes(ft)) {
        matches++;
        usedHeader.add(hi);
        break;
      }
    }
  }
  const score = matches / Math.max(fieldTokens.length, headerTokens.length);
  return score;
}
function fuzzyBestMatch(headers, displayName) {
  let bestHeader = null;
  let bestScore = 0.35;
  for (const h of headers) {
    const score = fuzzyScore(displayName, h);
    if (score > bestScore) {
      bestScore = score;
      bestHeader = h;
    }
  }
  return bestHeader;
}
function resolveColumns(headers, lookup) {
  const map = {};
  const uidPattern = /\[([A-Za-z0-9]{11})\]\s*$/;
  for (const h of headers) {
    const match = h.match(uidPattern);
    if (match) {
      map[h] = match[1];
      continue;
    }
    const cleanName = h.replace(/\s*\*\s*$/, "").trim();
    const resolvedId = lookup[h] || lookup[cleanName];
    if (resolvedId) {
      map[h] = resolvedId;
    }
  }
  return map;
}
function buildAttributeLookup(metadata) {
  const lookup = {};
  const attrs = getTrackerAttributes(metadata);
  for (const a of attrs) {
    const tea = a.trackedEntityAttribute ?? a;
    if (tea.displayName && tea.id) {
      lookup[tea.displayName] = tea.id;
    }
  }
  return lookup;
}
function buildStageDeLookup(stage) {
  const lookup = {};
  for (const psde of stage.programStageDataElements ?? []) {
    const de = psde.dataElement ?? psde;
    if (de.displayName && de.id) {
      lookup[de.displayName] = de.id;
    }
  }
  return lookup;
}
function buildOrgUnitMap(orgUnits) {
  const map = {};
  for (const ou of orgUnits) {
    map[ou.displayName.toLowerCase()] = ou.id;
  }
  return map;
}
function resolveOrgUnit(value, orgUnitMap) {
  if (!value) return "";
  if (/^[A-Za-z0-9]{11}$/.test(value)) return value;
  return orgUnitMap[value.toLowerCase()] ?? value;
}
function findStageSheet(sheetNames, stageName) {
  const exact = sheetNames.find((s) => s.startsWith(stageName));
  if (exact) return exact;
  const truncated = stageName.slice(0, 25);
  return sheetNames.find((s) => s.startsWith(truncated));
}
function formatDate(val) {
  return parseDate(val);
}
function formatValue(val) {
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? "" : val.toISOString().split("T")[0];
  }
  return cleanInvisibleChars(String(val).trim());
}
function buildValueTypeIndex(metadata) {
  const attrs = {};
  const des = {};
  const allAttrs = getTrackerAttributes(metadata);
  for (const a of allAttrs) {
    const tea = a.trackedEntityAttribute ?? a;
    if (tea.valueType) attrs[tea.id] = tea.valueType;
  }
  for (const dse of metadata.dataSetElements ?? []) {
    const de = dse.dataElement;
    if (de?.valueType) des[de.id] = de.valueType;
  }
  for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
      const de = psde.dataElement ?? psde;
      if (de.valueType) des[de.id] = de.valueType;
    }
  }
  return { attrs, des };
}
function normalizeByType(value, valueType) {
  if (!value || !valueType) return value;
  if (valueType === "BOOLEAN" || valueType === "TRUE_ONLY") {
    return normalizeBoolean(value, valueType);
  }
  if (valueType === "DATE" || valueType === "AGE") {
    return parseDate(value);
  }
  return value;
}
function buildOptionMaps(metadata) {
  const attrs = {};
  const des = {};
  for (const a of getTrackerAttributes(metadata)) {
    const tea = a.trackedEntityAttribute ?? a;
    const os = tea.optionSet;
    if (os?.options?.length) {
      const m = {};
      for (const opt of os.options) {
        const code = (opt.code ?? "").trim();
        if (opt.displayName) m[opt.displayName.trim().toLowerCase()] = code;
        if (code) m[code.toLowerCase()] = code;
      }
      attrs[tea.id] = m;
    }
  }
  for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
      const de = psde.dataElement ?? psde;
      const os = de.optionSet;
      if (os?.options?.length) {
        const m = {};
        for (const opt of os.options) {
          const code = (opt.code ?? "").trim();
          if (opt.displayName) m[opt.displayName.trim().toLowerCase()] = code;
          if (code) m[code.toLowerCase()] = code;
        }
        des[de.id] = m;
      }
    }
  }
  return { attrs, des };
}
function resolveOption(value, optMap) {
  if (!value || !optMap) return value;
  const lower = value.toLowerCase();
  return optMap[lower] ?? value;
}

// src/lib/validator.js
function isFutureDate(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const today = /* @__PURE__ */ new Date();
  today.setHours(23, 59, 59, 999);
  return d > today;
}
function isInvalidDateValue(val) {
  if (!val) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const d = new Date(val);
    return isNaN(d.getTime());
  }
  return true;
}
function buildValueTypeIndex2(metadata) {
  const attrs = {};
  const des = {};
  const allAttrs = getTrackerAttributes(metadata);
  for (const a of allAttrs) {
    const tea = a.trackedEntityAttribute ?? a;
    if (tea.valueType) attrs[tea.id] = tea.valueType;
  }
  for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
      const de = psde.dataElement ?? psde;
      if (de.valueType) des[de.id] = de.valueType;
    }
  }
  return { attrs, des };
}
function validateEventData(parsedData, metadata) {
  const errors = [];
  const warnings = [];
  const stages = metadata.programStages ?? [];
  const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]));
  const orgUnitIds = new Set((metadata.organisationUnits ?? []).map((ou) => ou.id));
  const eventsMap = parsedData.events ?? {};
  let totalEvents = 0;
  for (const arr of Object.values(eventsMap)) totalEvents += arr?.length ?? 0;
  if (totalEvents === 0) {
    errors.push({ source: "File", row: null, field: null, message: "No events found in the uploaded file." });
    return { errors, warnings };
  }
  const evtVtIndex = buildValueTypeIndex2(metadata);
  const optionSetIndex = buildOptionSetIndex2(metadata);
  for (const [stageId, events] of Object.entries(eventsMap)) {
    if (!events || events.length === 0) continue;
    const stage = stageMap[stageId];
    if (!stage) {
      warnings.push({ source: stageId, row: null, field: null, stageId, message: `Data found for unknown stage ID "${stageId}". It will be ignored.` });
      continue;
    }
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const row = i + 2;
      if (!event.orgUnit) {
        errors.push({ source: stage.displayName, row, field: "ORG_UNIT_ID", stageId, message: "ORG_UNIT_ID is missing." });
      } else if (orgUnitIds.size > 0 && !orgUnitIds.has(event.orgUnit)) {
        errors.push({
          source: stage.displayName,
          row,
          field: "ORG_UNIT_ID",
          stageId,
          message: `Org unit "${event.orgUnit}" is not valid for this program.`
        });
      }
      if (!event.eventDate) {
        errors.push({ source: stage.displayName, row, field: "EVENT_DATE", stageId, message: "EVENT_DATE is missing." });
      } else if (isFutureDate(event.eventDate)) {
        errors.push({ source: stage.displayName, row, field: "EVENT_DATE", stageId, message: "EVENT_DATE cannot be a future date (DHIS2 will reject with E1020)." });
      } else if (isInvalidDateValue(event.eventDate)) {
        errors.push({ source: stage.displayName, row, field: "EVENT_DATE", stageId, message: `Event date "${event.eventDate}" is not a valid date (expected YYYY-MM-DD). DHIS2 will reject this (E1007).` });
      }
      const requiredDes = stage.programStageDataElements?.filter((psde) => psde.compulsory)?.map((psde) => ({
        id: psde.dataElement?.id ?? psde.id,
        name: psde.dataElement?.displayName ?? psde.displayName
      })) ?? [];
      for (const de of requiredDes) {
        if (!event.dataValues[de.id]) {
          errors.push({
            source: stage.displayName,
            row,
            field: de.name,
            stageId,
            message: `Mandatory data element "${de.name}" is missing.`
          });
        }
      }
      for (const [deId, val] of Object.entries(event.dataValues ?? {})) {
        if (optionSetIndex.des[deId]) continue;
        const vt = evtVtIndex.des[deId];
        if (vt && val) {
          const vtError = checkValueType(val, vt);
          if (vtError) {
            errors.push({
              source: stage.displayName,
              row,
              field: deId,
              stageId,
              message: `${vtError} (expected ${vt}). DHIS2 will reject this.`
            });
          }
        }
      }
    }
  }
  for (const [stageId, events] of Object.entries(eventsMap)) {
    const stage = stageMap[stageId];
    if (!stage) continue;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const row = i + 2;
      for (const [deId, val] of Object.entries(event.dataValues ?? {})) {
        const valid = optionSetIndex.des[deId];
        if (valid && !valid.has(val)) {
          errors.push({
            source: stage.displayName,
            row,
            field: deId,
            stageId,
            message: diagnoseOptionError(val, deId, valid, optionSetIndex)
          });
        }
      }
    }
  }
  for (const stage of stages) {
    if (!eventsMap[stage.id] || eventsMap[stage.id].length === 0) {
      warnings.push({ source: stage.displayName, row: null, field: null, stageId: stage.id, message: "No data provided \u2014 stage will be skipped." });
    }
  }
  return { errors, warnings };
}
function buildOptionSetIndex2(metadata) {
  const attrs = {};
  const des = {};
  const codeToFields = {};
  const fieldNames = {};
  const headerNames = /* @__PURE__ */ new Set();
  const fieldOptions = {};
  function indexOptions(fieldId, fieldName, options, target) {
    target[fieldId] = new Set(options.map((o) => (o.code ?? "").trim()));
    fieldOptions[fieldId] = options.map((o) => ({
      code: (o.code ?? "").trim(),
      displayName: (o.displayName ?? "").trim()
    })).filter((o) => o.code || o.displayName);
    for (const opt of options) {
      const code = (opt.code ?? "").trim();
      const lower = code.toLowerCase();
      if (lower) {
        (codeToFields[lower] ??= []).push({ fieldId, fieldName });
      }
      if (opt.displayName) {
        const dn = opt.displayName.trim().toLowerCase();
        if (dn !== lower) {
          (codeToFields[dn] ??= []).push({ fieldId, fieldName });
        }
      }
    }
  }
  const allAttrs = getTrackerAttributes(metadata);
  for (const a of allAttrs) {
    const tea = a.trackedEntityAttribute ?? a;
    fieldNames[tea.id] = tea.displayName;
    headerNames.add(tea.displayName);
    const os = tea.optionSet;
    if (os?.options?.length) indexOptions(tea.id, tea.displayName, os.options, attrs);
  }
  for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
      const de = psde.dataElement ?? psde;
      fieldNames[de.id] = de.displayName;
      headerNames.add(de.displayName);
      const os = de.optionSet;
      if (os?.options?.length) indexOptions(de.id, de.displayName, os.options, des);
    }
  }
  for (const dse of metadata.dataSetElements ?? []) {
    const de = dse.dataElement;
    if (!de) continue;
    fieldNames[de.id] = de.displayName;
    headerNames.add(de.displayName);
    const os = de.optionSet;
    if (os?.options?.length) indexOptions(de.id, de.displayName, os.options, des);
  }
  return { attrs, des, codeToFields, fieldNames, headerNames, fieldOptions };
}
function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}
function suggestClosestOption(val, options, max = 2) {
  if (!options?.length) return [];
  const input = String(val).trim();
  if (!input) return [];
  const cap = Math.max(2, Math.floor(input.length / 3));
  const scored = [];
  for (const opt of options) {
    const dCode = opt.code ? levenshtein(input, opt.code) : Infinity;
    const dName = opt.displayName ? levenshtein(input, opt.displayName) : Infinity;
    const d = Math.min(dCode, dName);
    if (d <= cap) scored.push({ opt, d });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, max).map((s) => s.opt);
}
function diagnoseOptionError(val, fieldId, validSet, optIndex) {
  const fieldName = optIndex.fieldNames[fieldId] || fieldId;
  const lower = String(val).trim().toLowerCase();
  const matchingFields = (optIndex.codeToFields[lower] || []).filter((f) => f.fieldId !== fieldId);
  if (matchingFields.length > 0) {
    const otherNames = [...new Set(matchingFields.map((f) => f.fieldName))].slice(0, 3);
    return `Value "${val}" is not a valid option for "${fieldName}", but IS valid for ${otherNames.map((n) => `"${n}"`).join(", ")} \u2014 possible column misalignment in your spreadsheet.`;
  }
  if (optIndex.headerNames.has(val) || optIndex.headerNames.has(val.replace(/\s*\*$/, ""))) {
    return `Value "${val}" in "${fieldName}" looks like a column header pasted as data \u2014 check for shifted rows.`;
  }
  const suggestions = suggestClosestOption(val, optIndex.fieldOptions?.[fieldId]);
  if (suggestions.length > 0) {
    const hint = suggestions.map((s) => s.displayName && s.displayName !== s.code ? `"${s.code}" (${s.displayName})` : `"${s.code || s.displayName}"`).join(" or ");
    const sample2 = [...validSet].slice(0, 5).join(", ");
    return `Value "${val}" is not a valid option for "${fieldName}". Did you mean ${hint}? Valid options: ${sample2}${validSet.size > 5 ? ", ..." : ""}. (E1125)`;
  }
  const sample = [...validSet].slice(0, 5).join(", ");
  return `Value "${val}" is not a valid option for "${fieldName}". Valid options: ${sample}${validSet.size > 5 ? ", ..." : ""}. (E1125)`;
}
function checkValueType(value, valueType) {
  if (!value || !valueType) return null;
  const v = String(value).trim();
  if (!v) return null;
  switch (valueType) {
    case "NUMBER":
    case "UNIT_INTERVAL":
      if (isNaN(Number(v))) return `"${v}" is not a valid number`;
      if (valueType === "UNIT_INTERVAL" && (Number(v) < 0 || Number(v) > 1))
        return `"${v}" must be between 0 and 1`;
      break;
    case "INTEGER":
      if (!/^-?\d+$/.test(v)) return `"${v}" is not a valid integer`;
      break;
    case "INTEGER_POSITIVE":
      if (!/^\d+$/.test(v) || Number(v) <= 0) return `"${v}" must be a positive integer`;
      break;
    case "INTEGER_NEGATIVE":
      if (!/^-\d+$/.test(v) || Number(v) >= 0) return `"${v}" must be a negative integer`;
      break;
    case "INTEGER_ZERO_OR_POSITIVE":
      if (!/^\d+$/.test(v)) return `"${v}" must be zero or a positive integer`;
      break;
    case "PERCENTAGE":
      if (isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100)
        return `"${v}" must be a number between 0 and 100`;
      break;
    case "BOOLEAN":
      if (!["true", "false", "1", "0"].includes(v.toLowerCase()))
        return `"${v}" must be true/false`;
      break;
    case "TRUE_ONLY":
      if (!["true", "1"].includes(v.toLowerCase()))
        return `"${v}" must be true (or empty)`;
      break;
    case "DATE":
    case "AGE":
      if (isInvalidDateValue(v)) return `"${v}" is not a valid date (expected YYYY-MM-DD)`;
      break;
    case "PHONE_NUMBER":
      if (!/^\+?[\d\s()-]{6,20}$/.test(v)) return `"${v}" is not a valid phone number`;
      break;
    case "EMAIL":
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return `"${v}" is not a valid email`;
      break;
    default:
      break;
  }
  return null;
}

// src/lib/payloadBuilder.js
var UID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var UID_ALL = UID_CHARS + "0123456789";
function generateUid() {
  let uid = UID_CHARS.charAt(Math.floor(Math.random() * UID_CHARS.length));
  for (let i = 1; i < 11; i++) {
    uid += UID_ALL.charAt(Math.floor(Math.random() * UID_ALL.length));
  }
  return uid;
}
function buildEventPayload(parsedData, metadata) {
  const programId = metadata.id;
  const skipDEs = new Set(metadata.assignedDataElements ?? []);
  const payload = { events: [] };
  const rowMap = {};
  for (const stage of metadata.programStages ?? []) {
    const stageEvents = parsedData.events?.[stage.id];
    if (!stageEvents || stageEvents.length === 0) continue;
    for (let i = 0; i < stageEvents.length; i++) {
      const event = stageEvents[i];
      if (!event.eventDate) continue;
      const evtUid = generateUid();
      const excelRow = i + 2;
      const dataValues = Object.entries(event.dataValues).filter(([dataElement]) => !skipDEs.has(dataElement)).map(([dataElement, value]) => ({ dataElement, value }));
      if (dataValues.length === 0) continue;
      payload.events.push({
        event: evtUid,
        program: programId,
        programStage: stage.id,
        orgUnit: event.orgUnit,
        occurredAt: event.eventDate,
        status: "COMPLETED",
        dataValues
      });
      rowMap[evtUid] = {
        excelRow,
        type: "EVENT",
        stageId: stage.id,
        stageName: stage.displayName
      };
    }
  }
  return { payload, rowMap };
}

// test-harness/02-event.mjs
var PROGRAM_ID = "eBAyeGv0exc";
var PROGRAM_FIELDS = "id,displayName,programType,programStages[id,displayName,repeatable,sortOrder,programStageDataElements[id,compulsory,dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],organisationUnits[id,displayName,path]";
var result = { flow: "event-import", program: PROGRAM_ID, steps: [] };
var steps = result.steps;
function step(name, status, detail) {
  steps.push({ name, status, detail });
  ({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ": " + detail : ""}`);
}
try {
  section("Event import \u2014 Inpatient morbidity");
  const program = await api.get(`/api/programs/${PROGRAM_ID}?fields=${encodeURIComponent(PROGRAM_FIELDS)}`);
  step(
    "fetch metadata",
    "OK",
    `${program.displayName}, ${program.programStages.length} stage(s), ${program.organisationUnits.length} org units`
  );
  const metadata = { ...program, assignedAttributes: [], assignedDataElements: [] };
  const wb = generateEventTemplate(program, metadata);
  step("generateEventTemplate", "OK", `sheets: ${wb.SheetNames.join(" | ")}`);
  const orgUnit = program.organisationUnits[0].id;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const N = 5;
  for (const stage of program.programStages) {
    const stageSheetName = wb.SheetNames.find(
      (s) => s !== "Instructions" && s !== "Validation" && (s === stage.displayName.slice(0, 31) || s.toLowerCase().includes(stage.displayName.toLowerCase().slice(0, 15)))
    );
    if (!stageSheetName) {
      warn("no sheet for stage " + stage.displayName);
      continue;
    }
    const stageSheet = wb.Sheets[stageSheetName];
    const stageHeaders = XLSX3.utils.sheet_to_json(stageSheet, { header: 1 })[0];
    const rows = [];
    for (let i = 0; i < N; i++) {
      const row = {};
      for (const h of stageHeaders) row[h] = "";
      row["ORG_UNIT_ID"] = orgUnit;
      const dateCol = stageHeaders.find((h) => h.startsWith("EVENT_DATE"));
      if (dateCol) row[dateCol] = today;
      for (const psde of stage.programStageDataElements) {
        const de = psde.dataElement;
        const col = stageHeaders.find((h) => h.includes(`[${de.id}]`));
        if (!col) continue;
        row[col] = synthValue(de, i);
      }
      rows.push(row);
    }
    wb.Sheets[stageSheetName] = XLSX3.utils.json_to_sheet(rows, { header: stageHeaders });
  }
  const outDir = path.resolve("test-harness/.tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const buf = XLSX3.write(wb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(path.join(outDir, "event-filled.xlsx"), buf);
  const file = new File([buf], "event-filled.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const parsed = await parseUploadedFile(file, metadata);
  const counts = Object.fromEntries(Object.entries(parsed.events).map(([k, v]) => [k, v.length]));
  step("parse events", "OK", JSON.stringify(counts));
  const { errors, warnings } = validateEventData(parsed, metadata);
  step(
    "validate",
    errors.length ? "FAIL" : "OK",
    `errors=${errors.length} warnings=${warnings.length}${errors.length ? " " + JSON.stringify(errors.slice(0, 3)) : ""}`
  );
  const { payload } = buildEventPayload(parsed, metadata);
  step("buildEventPayload", "OK", `events=${payload.events.length}`);
  fs.writeFileSync(path.join(outDir, "event-payload.json"), JSON.stringify(payload, null, 2));
  const submission = await api.post(
    "/api/tracker?async=false&importStrategy=CREATE_AND_UPDATE&atomicMode=OBJECT",
    payload
  );
  const report = submission.body;
  const status = report?.status;
  const stats = report?.stats ?? {};
  const errs = collectErrors(report);
  const ignored = stats.ignored ?? 0;
  step(
    "POST /api/tracker (events)",
    errs.length === 0 && ignored === 0 ? "OK" : "FAIL",
    `http=${submission.status} status=${status} stats=${JSON.stringify(stats)} errors=${errs.length}`
  );
  if (errs.length) for (const e of errs.slice(0, 5)) info(`    ${e.errorCode}:${(e.message ?? "").slice(0, 160)}`);
  const createdEvents = payload.events.map((e) => e.event);
  if (createdEvents.length > 0) {
    const got = await api.get(`/api/tracker/events/${createdEvents[0]}?fields=event,programStage,occurredAt,orgUnit`);
    step("verify event", got.event === createdEvents[0] ? "OK" : "FAIL", JSON.stringify(got));
  }
  const del = await api.post(
    "/api/tracker?async=false&importStrategy=DELETE",
    { events: createdEvents.map((event) => ({ event })) }
  );
  step("cleanup DELETE", del.ok ? "OK" : "WARN", `http=${del.status} status=${del.body?.status}`);
} catch (e) {
  fail("HARNESS CRASH: " + (e.stack ?? e.message));
  process.exitCode = 1;
}
section("Summary");
var okCount = steps.filter((s) => s.status === "OK").length;
var failCount = steps.filter((s) => s.status === "FAIL").length;
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2));
fs.writeFileSync(path.resolve("test-harness/.tmp", "result-event-import.json"), JSON.stringify(result, null, 2));
function synthValue(de, idx = 0) {
  const vt = de.valueType;
  const os = de.optionSet;
  if (vt === "FILE_RESOURCE" || vt === "IMAGE" || vt === "COORDINATE" || vt === "ORGANISATION_UNIT" || vt === "REFERENCE" || vt === "USERNAME" || vt === "URL") return "";
  if (os?.options?.length) return os.options[0].displayName;
  switch (vt) {
    case "TEXT":
    case "LONG_TEXT":
      return `Text${idx}`;
    case "NUMBER":
    case "INTEGER":
    case "INTEGER_POSITIVE":
    case "INTEGER_ZERO_OR_POSITIVE":
      return 1 + idx;
    case "INTEGER_NEGATIVE":
      return -1 - idx;
    case "PERCENTAGE":
      return 50;
    case "DATE":
      return "2026-01-15";
    case "DATETIME":
      return "2026-01-15T10:00:00.000";
    case "TRUE_ONLY":
    case "BOOLEAN":
      return "true";
    case "PHONE_NUMBER":
      return "+23276000000";
    case "EMAIL":
      return "test@example.com";
    default:
      return "X";
  }
}
function collectErrors(report) {
  if (!report) return [];
  const errs = [];
  if (report.validationReport?.errorReports) errs.push(...report.validationReport.errorReports);
  if (report.bundleReport?.typeReportMap) {
    for (const tr of Object.values(report.bundleReport.typeReportMap)) {
      for (const obj of tr.objectReports ?? []) errs.push(...obj.errorReports ?? []);
    }
  }
  return errs;
}
