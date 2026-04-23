import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// test-harness/03-aggregate.mjs
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
var DATA_ENTRY_COLOR = "4472C4";
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
function generateDataEntryTemplate(dataSet) {
  const wb = XLSX.utils.book_new();
  const { wsValidation, valInfo } = buildDataEntryValidationSheet(dataSet);
  const deOs = buildDataEntryOptionSetIndex(dataSet);
  const instructions = [
    ["Data Entry Bulk Import Template"],
    [`Data Set: ${dataSet.displayName}`],
    [`Period Type: ${dataSet.periodType}`],
    [`Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`],
    [],
    ["How to fill in this template:"],
    ["1. Each row represents one org unit + period combination."],
    ["2. ORG_UNIT_ID identifies the organisation unit (use UID from dropdown)."],
    ["3. PERIOD is the reporting period in DHIS2 format (e.g. 202401, 2024Q1, 2024)."],
    ["4. Fill in data values for each data element column."],
    ["5. Columns ending with [deId] or [deId.cocId] indicate the DHIS2 identifiers."],
    ["6. Columns with an asterisk (*) are mandatory system columns."],
    ["7. For option-set fields, select from the dropdown or use the CODE from the Validation sheet."],
    [],
    ["Period Formats:"],
    ["  Daily: YYYYMMDD (e.g. 20240115)"],
    ["  Weekly: YYYYWn (e.g. 2024W3)"],
    ["  Monthly: YYYYMM (e.g. 202401)"],
    ["  BiMonthly: YYYYMMB (e.g. 202401B)"],
    ["  Quarterly: YYYYQn (e.g. 2024Q1)"],
    ["  SixMonthly: YYYYSn (e.g. 2024S1)"],
    ["  Yearly: YYYY (e.g. 2024)"],
    ["  Financial April: YYYYApril (e.g. 2024April)"],
    ["  Financial July: YYYYJuly (e.g. 2024July)"],
    ["  Financial October: YYYYOct (e.g. 2024Oct)"]
  ];
  const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
  XLSX.utils.book_append_sheet(wb, wsInstructions, "Instructions");
  const columns = buildDataEntryColumns(dataSet);
  const headers = ["ORG_UNIT_ID *", "PERIOD *", ...columns.map((c) => c.header)];
  const wsData = XLSX.utils.aoa_to_sheet([headers]);
  setColumnWidths(wsData, headers);
  XLSX.utils.book_append_sheet(wb, wsData, "Data Entry");
  const validationRules = {};
  const typeValidationRules = {};
  const sheetIdx = 2;
  const dvRules = [];
  const tRules = [];
  if (valInfo.orgUnitRef) {
    dvRules.push({ col: 0, ref: valInfo.orgUnitRef, startRow: 2, maxRow: 1e3 });
  }
  for (let i = 0; i < columns.length; i++) {
    const osId = columns[i].optionSetId;
    if (osId && valInfo.optionRefs[osId]) {
      dvRules.push({ col: 2 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: 1e3 });
    }
  }
  for (let i = 0; i < columns.length; i++) {
    const osId = columns[i].optionSetId;
    if (osId && valInfo.optionRefs[osId]) continue;
    const vt = valueTypeToValidation(columns[i].valueType);
    if (vt) tRules.push({ col: 2 + i, startRow: 2, maxRow: 1e3, ...vt });
  }
  if (dvRules.length > 0) validationRules[sheetIdx] = dvRules;
  if (tRules.length > 0) typeValidationRules[sheetIdx] = tRules;
  if (wsValidation) {
    XLSX.utils.book_append_sheet(wb, wsValidation, "Validation");
  }
  if (Object.keys(validationRules).length > 0) {
    wb._validationRules = validationRules;
  }
  if (Object.keys(typeValidationRules).length > 0) {
    wb._typeValidationRules = typeValidationRules;
  }
  wb._headerColors = {
    2: [{ startCol: 0, endCol: headers.length - 1, color: DATA_ENTRY_COLOR }]
  };
  return wb;
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
      columns.push({
        header: `${de.displayName} [${de.id}]`,
        deId: de.id,
        cocId: cocs[0]?.id ?? null,
        valueType: de.valueType,
        optionSetId: de.optionSet?.id ?? null
      });
    } else {
      for (const coc of cocs) {
        columns.push({
          header: `${de.displayName} - ${coc.displayName} [${de.id}.${coc.id}]`,
          deId: de.id,
          cocId: coc.id,
          valueType: de.valueType,
          optionSetId: de.optionSet?.id ?? null
        });
      }
    }
  }
  return columns;
}
function collectDataEntryOptionSets(dataSet) {
  const seen = /* @__PURE__ */ new Set();
  const result2 = [];
  for (const dse of dataSet.dataSetElements ?? []) {
    const os = dse.dataElement?.optionSet;
    if (os && !seen.has(os.id)) {
      seen.add(os.id);
      result2.push({ id: os.id, name: os.displayName ?? os.id, options: os.options ?? [] });
    }
  }
  return result2;
}
function buildDataEntryValidationSheet(dataSet) {
  const optionSets = collectDataEntryOptionSets(dataSet);
  const orgUnits = dataSet.organisationUnits ?? [];
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
function buildDataEntryOptionSetIndex(dataSet) {
  const deOs = {};
  for (const dse of dataSet.dataSetElements ?? []) {
    const de = dse.dataElement;
    if (de?.optionSet?.id) deOs[de.id] = de.optionSet.id;
  }
  return deOs;
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
function getSheetHeaders(workbook, sheetName, headerRow = 1) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const aoa = XLSX2.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false, range: headerRow - 1 });
  const first = aoa[0];
  if (!Array.isArray(first)) return [];
  return first.map((h) => h == null ? "" : String(h));
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
function parseDataEntryTemplate(workbook, metadata) {
  const ws = workbook.Sheets["Data Entry"];
  if (!ws) throw new Error('Missing "Data Entry" sheet in workbook.');
  const rows = XLSX2.utils.sheet_to_json(ws, { defval: "" });
  const headers = XLSX2.utils.sheet_to_json(ws, { header: 1 })?.[0] ?? [];
  const uidPattern = /\[([A-Za-z0-9]{11})(?:\.([A-Za-z0-9]{11}))?\]\s*$/;
  const columnDefs = [];
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]);
    const match = h.match(uidPattern);
    if (match) {
      columnDefs.push({ colHeader: h, deId: match[1], cocId: match[2] || null });
    }
  }
  const ouNameToId = {};
  const ouNameCollisions = /* @__PURE__ */ new Set();
  for (const ou of metadata.organisationUnits ?? []) {
    const key = ou.displayName.trim().toLowerCase();
    if (ouNameToId[key] && ouNameToId[key] !== ou.id) {
      ouNameCollisions.add(key);
    }
    ouNameToId[key] = ou.id;
  }
  const deOptionMaps = {};
  for (const dse of metadata.dataSetElements ?? []) {
    const de = dse.dataElement;
    if (de?.optionSet?.options) {
      const m = {};
      for (const opt of de.optionSet.options) {
        const code = (opt.code ?? "").trim();
        if (opt.displayName) m[opt.displayName.trim().toLowerCase()] = code || opt.displayName;
        if (code) m[code.toLowerCase()] = code;
      }
      deOptionMaps[de.id] = m;
    }
  }
  const deDefaultCoc = {};
  for (const dse of metadata.dataSetElements ?? []) {
    const de = dse.dataElement;
    const cocs = de?.categoryCombo?.categoryOptionCombos ?? [];
    if (cocs.length === 1) {
      deDefaultCoc[de.id] = cocs[0].id;
    }
  }
  const dataValues = [];
  for (const row of rows) {
    const orgUnitRaw = String(row["ORG_UNIT_ID *"] ?? row["ORG_UNIT_ID"] ?? "").trim();
    const period = String(row["PERIOD *"] ?? row["PERIOD"] ?? "").trim();
    if (!orgUnitRaw && !period) continue;
    let orgUnit;
    if (/^[A-Za-z0-9]{11}$/.test(orgUnitRaw)) {
      orgUnit = orgUnitRaw;
    } else {
      const key = orgUnitRaw.toLowerCase();
      if (ouNameCollisions.has(key)) {
        orgUnit = orgUnitRaw;
      } else {
        orgUnit = ouNameToId[key] ?? orgUnitRaw;
      }
    }
    for (const col of columnDefs) {
      const value = String(row[col.colHeader] ?? "").trim();
      if (!value) continue;
      const resolvedValue = deOptionMaps[col.deId] ? deOptionMaps[col.deId][value.toLowerCase()] ?? value : value;
      const cocId = col.cocId ?? deDefaultCoc[col.deId] ?? null;
      dataValues.push({
        orgUnit,
        period,
        dataElement: col.deId,
        categoryOptionCombo: cocId,
        value: resolvedValue
      });
    }
  }
  const result2 = { dataValues };
  const drift = detectColumnDrift(workbook, metadata);
  if (drift.unknownColumns.length || drift.missingFields.length) {
    result2.__drift = drift;
  }
  return result2;
}

// src/lib/validator.js
function isInvalidDateValue(val) {
  if (!val) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const d = new Date(val);
    return isNaN(d.getTime());
  }
  return true;
}
function buildOptionSetIndex(metadata) {
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
function validateDataEntryData(parsedData, metadata) {
  const errors = [];
  const warnings = [];
  const dataValues = parsedData.dataValues ?? [];
  if (dataValues.length === 0) {
    errors.push({ source: "File", row: null, field: null, message: "No data values found in the uploaded file." });
    return { errors, warnings };
  }
  const orgUnitIds = new Set((metadata.organisationUnits ?? []).map((ou) => ou.id));
  const validDeIds = new Set((metadata.dataSetElements ?? []).map((dse) => dse.dataElement?.id).filter(Boolean));
  const ouNameCounts = {};
  for (const ou of metadata.organisationUnits ?? []) {
    const key = ou.displayName.trim().toLowerCase();
    ouNameCounts[key] = (ouNameCounts[key] ?? 0) + 1;
  }
  const ouNameCollisions = new Set(
    Object.entries(ouNameCounts).filter(([, count]) => count > 1).map(([name]) => name)
  );
  const optionSetIndex = buildOptionSetIndex(metadata);
  const deValueTypes = {};
  for (const dse of metadata.dataSetElements ?? []) {
    const de = dse.dataElement;
    if (de?.valueType) deValueTypes[de.id] = de.valueType;
  }
  const deValidCocs = {};
  for (const dse of metadata.dataSetElements ?? []) {
    const de = dse.dataElement;
    const cocs = de?.categoryCombo?.categoryOptionCombos;
    if (de && cocs) {
      deValidCocs[de.id] = new Set(cocs.map((c) => c.id));
    }
  }
  const periodPattern = /^(\d{4})(\d{4}|\d{2}|0[1-9]|1[0-2]|Q[1-4]|S[1-2]|W\d{1,2}|BiW\d{1,2}|April|July|Oct|Nov|B\d{2})?$/;
  for (let i = 0; i < dataValues.length; i++) {
    const dv = dataValues[i];
    const row = i + 2;
    if (!dv.orgUnit) {
      errors.push({ source: "Data Entry", row, field: "ORG_UNIT_ID", message: "ORG_UNIT_ID is missing." });
    } else if (orgUnitIds.size > 0 && !orgUnitIds.has(dv.orgUnit)) {
      const isCollision = ouNameCollisions.has(String(dv.orgUnit).trim().toLowerCase());
      errors.push({
        source: "Data Entry",
        row,
        field: "ORG_UNIT_ID",
        message: isCollision ? `Org unit name "${dv.orgUnit}" matches multiple org units in this data set. Use the UID instead.` : `Org unit "${dv.orgUnit}" is not valid for this data set.`
      });
    }
    if (!dv.period) {
      errors.push({ source: "Data Entry", row, field: "PERIOD", message: "PERIOD is missing." });
    } else if (!periodPattern.test(dv.period)) {
      warnings.push({
        source: "Data Entry",
        row,
        field: "PERIOD",
        message: `Period "${dv.period}" may not be in a valid DHIS2 format.`
      });
    }
    if (!dv.dataElement) {
      errors.push({ source: "Data Entry", row, field: "dataElement", message: "Data element ID is missing." });
    } else if (!validDeIds.has(dv.dataElement)) {
      warnings.push({
        source: "Data Entry",
        row,
        field: "dataElement",
        message: `Data element "${dv.dataElement}" is not part of this data set.`
      });
    }
    if (dv.dataElement && dv.categoryOptionCombo && deValidCocs[dv.dataElement]) {
      if (!deValidCocs[dv.dataElement].has(dv.categoryOptionCombo)) {
        errors.push({
          source: "Data Entry",
          row,
          field: dv.dataElement,
          message: `Category option combo "${dv.categoryOptionCombo}" is not valid for data element "${dv.dataElement}".`
        });
      }
    }
    if (dv.dataElement && optionSetIndex.des[dv.dataElement]) {
      if (!optionSetIndex.des[dv.dataElement].has(dv.value)) {
        errors.push({
          source: "Data Entry",
          row,
          field: dv.dataElement,
          message: diagnoseOptionError(dv.value, dv.dataElement, optionSetIndex.des[dv.dataElement], optionSetIndex)
        });
      }
    }
    if (dv.dataElement && !optionSetIndex.des[dv.dataElement] && deValueTypes[dv.dataElement]) {
      const vtError = checkValueType(dv.value, deValueTypes[dv.dataElement]);
      if (vtError) {
        errors.push({
          source: "Data Entry",
          row,
          field: dv.dataElement,
          message: `${vtError} (expected ${deValueTypes[dv.dataElement]}). DHIS2 will reject this.`
        });
      }
    }
  }
  const seen = /* @__PURE__ */ new Map();
  for (let i = 0; i < dataValues.length; i++) {
    const dv = dataValues[i];
    const key = `${dv.orgUnit}|${dv.period}|${dv.dataElement}|${dv.categoryOptionCombo || ""}`;
    if (seen.has(key)) {
      errors.push({
        source: "Data Entry",
        row: i + 2,
        field: dv.dataElement,
        message: `Duplicate data value (same org unit, period, data element, and category option combo as row ${seen.get(key)}). Only one value per combination is allowed.`
      });
    } else {
      seen.set(key, i + 2);
    }
  }
  return { errors, warnings };
}

// src/lib/payloadBuilder.js
var UID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var UID_ALL = UID_CHARS + "0123456789";
function buildDataEntryPayload(parsedData) {
  const payload = { dataValues: [] };
  const rowMap = {};
  for (let i = 0; i < (parsedData.dataValues ?? []).length; i++) {
    const dv = parsedData.dataValues[i];
    const excelRow = i + 2;
    const entry = {
      dataElement: dv.dataElement,
      period: dv.period,
      orgUnit: dv.orgUnit,
      value: dv.value
    };
    if (dv.categoryOptionCombo) {
      entry.categoryOptionCombo = dv.categoryOptionCombo;
    }
    payload.dataValues.push(entry);
    rowMap[i] = { excelRow, type: "DATA_VALUE" };
  }
  return { payload, rowMap };
}

// test-harness/03-aggregate.mjs
var FIELDS = "id,displayName,periodType,categoryCombo[id,displayName,categoryOptionCombos[id,displayName]],dataSetElements[dataElement[id,displayName,valueType,categoryCombo[id,displayName,categoryOptionCombos[id,displayName]],optionSet[id,displayName,options[id,displayName,code]]]],sections[id,displayName,sortOrder,dataElements[id]],organisationUnits[id,displayName,path]";
var result = { flow: "aggregate-import", dataSet: null, steps: [] };
var steps = result.steps;
function step(name, status, detail) {
  steps.push({ name, status, detail });
  ({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ": " + detail : ""}`);
}
try {
  section("Aggregate data entry import");
  const list = await api.get("/api/dataSets?fields=id,displayName,periodType&pageSize=60");
  const monthly = list.dataSets.filter((d) => d.periodType === "Monthly");
  let metadata = null;
  for (const cand of monthly) {
    const meta = await api.get(`/api/dataSets/${cand.id}?fields=${encodeURIComponent(FIELDS)}`);
    const allDefault = meta.dataSetElements.every((dse) => dse.dataElement?.categoryCombo?.displayName === "default" || dse.dataElement?.categoryCombo?.categoryOptionCombos?.length === 1 && dse.dataElement.categoryCombo.categoryOptionCombos[0].displayName === "default");
    const hasOus = meta.organisationUnits?.length > 0;
    if (allDefault && hasOus && meta.dataSetElements.length > 0) {
      metadata = meta;
      break;
    }
  }
  if (!metadata) {
    metadata = await api.get(`/api/dataSets/${monthly[0].id}?fields=${encodeURIComponent(FIELDS)}`);
  }
  result.dataSet = metadata.id;
  step(
    "pick data set",
    "OK",
    `${metadata.displayName} (${metadata.id}), ${metadata.periodType}, ${metadata.dataSetElements.length} DEs, ${metadata.organisationUnits.length} OUs`
  );
  if (metadata.organisationUnits.length === 0) {
    throw new Error("data set has no org units assigned \u2014 pick another");
  }
  const orgUnit = metadata.organisationUnits[0].id;
  const wb = generateDataEntryTemplate(metadata);
  step("generateDataEntryTemplate", "OK", `sheets: ${wb.SheetNames.join(" | ")}`);
  const ds = wb.Sheets["Data Entry"];
  const headers = XLSX3.utils.sheet_to_json(ds, { header: 1 })[0];
  const valueCols = headers.filter((h) => /\[[A-Za-z0-9]{11}(\.[A-Za-z0-9]{11})?\]\s*$/.test(h));
  if (valueCols.length === 0) throw new Error("no data value columns found in template");
  const useCols = valueCols.slice(0, Math.min(5, valueCols.length));
  const period = "202501";
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const row = {};
    for (const h of headers) row[h] = "";
    row["ORG_UNIT_ID *"] = orgUnit;
    row["PERIOD *"] = period;
    for (const c of useCols) {
      const m = c.match(/\[([A-Za-z0-9]{11})(?:\.[A-Za-z0-9]{11})?\]/);
      const deId = m?.[1];
      const de = metadata.dataSetElements.find((dse) => dse.dataElement.id === deId)?.dataElement;
      row[c] = synthDv(de, i);
    }
    if (i > 0 && metadata.organisationUnits[i]) row["ORG_UNIT_ID *"] = metadata.organisationUnits[i].id;
    rows.push(row);
  }
  wb.Sheets["Data Entry"] = XLSX3.utils.json_to_sheet(rows, { header: headers });
  const outDir = path.resolve("test-harness/.tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const buf = XLSX3.write(wb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(path.join(outDir, "aggregate-filled.xlsx"), buf);
  const wb2 = XLSX3.read(buf, { type: "buffer" });
  const parsed = parseDataEntryTemplate(wb2, metadata);
  step("parseDataEntryTemplate", "OK", `dataValues=${parsed.dataValues.length}`);
  const { errors, warnings } = validateDataEntryData(parsed, metadata);
  step(
    "validate",
    errors.length ? "FAIL" : "OK",
    `errors=${errors.length} warnings=${warnings.length}${errors.length ? " " + JSON.stringify(errors.slice(0, 3)) : ""}`
  );
  const { payload } = buildDataEntryPayload(parsed);
  step("buildDataEntryPayload", "OK", `dataValues=${payload.dataValues.length}`);
  fs.writeFileSync(path.join(outDir, "aggregate-payload.json"), JSON.stringify(payload, null, 2));
  const sub = await api.post("/api/dataValueSets?importStrategy=CREATE_AND_UPDATE&dryRun=false", payload);
  const r = sub.body;
  const ic = r?.importCount ?? r?.response?.importCount ?? {};
  const imported = ic.imported ?? 0;
  const updated = ic.updated ?? 0;
  const ignored = ic.ignored ?? 0;
  const acceptedSomething = imported + updated > 0;
  step(
    "POST /api/dataValueSets",
    r?.status !== "ERROR" && (sub.ok || acceptedSomething) ? "OK" : "FAIL",
    `http=${sub.status} status=${r?.status} imported=${imported} updated=${updated} ignored=${ignored} conflicts=${r?.conflicts?.length ?? 0}`
  );
  if (r?.description) info(`    description: ${String(r.description).slice(0, 200)}`);
  if (r?.conflicts?.length) {
    for (const c of r.conflicts.slice(0, 5)) info(`    ${JSON.stringify(c).slice(0, 200)}`);
  }
  if (ignored > 0 && !r?.conflicts?.length) {
    const inner = r?.response ?? {};
    if (inner.conflicts?.length) {
      for (const c of inner.conflicts.slice(0, 5)) info(`    ${JSON.stringify(c).slice(0, 300)}`);
    } else {
      info(`    raw: ${JSON.stringify(r).slice(0, 800)}`);
    }
  }
  const q = `/api/dataValueSets?dataSet=${metadata.id}&period=${period}&orgUnit=${orgUnit}`;
  const check = await api.get(q);
  step(
    "verify dataValues",
    (check.dataValues?.length ?? 0) > 0 ? "OK" : "WARN",
    `returned=${check.dataValues?.length ?? 0}`
  );
  const del = await api.post(`/api/dataValueSets?importStrategy=DELETE`, payload);
  step(
    "cleanup DELETE",
    del.ok && del.body?.status !== "ERROR" ? "OK" : "WARN",
    `http=${del.status} status=${del.body?.status} deleted=${del.body?.importCount?.deleted ?? "?"}`
  );
} catch (e) {
  fail("HARNESS CRASH: " + (e.stack ?? e.message));
  process.exitCode = 1;
}
section("Summary");
var okCount = steps.filter((s) => s.status === "OK").length;
var failCount = steps.filter((s) => s.status === "FAIL").length;
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2));
fs.writeFileSync(path.resolve("test-harness/.tmp", "result-aggregate-import.json"), JSON.stringify(result, null, 2));
function synthDv(de, i = 0) {
  const vt = de?.valueType;
  const os = de?.optionSet;
  if (os?.options?.length) return os.options[0].code ?? os.options[0].displayName;
  switch (vt) {
    case "NUMBER":
    case "INTEGER":
    case "INTEGER_POSITIVE":
    case "INTEGER_ZERO_OR_POSITIVE":
      return 10 + i;
    case "INTEGER_NEGATIVE":
      return -(10 + i);
    case "PERCENTAGE":
      return 50;
    case "UNIT_INTERVAL":
      return 0.5;
    case "BOOLEAN":
      return "true";
    case "TRUE_ONLY":
      return "true";
    case "DATE":
      return "2025-01-15";
    case "TEXT":
    case "LONG_TEXT":
      return `T${i}`;
    default:
      return 1;
  }
}
