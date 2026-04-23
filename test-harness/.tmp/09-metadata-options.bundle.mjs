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

// test-harness/09-metadata-options.mjs
var failures = 0;
var expect = (label, cond, detail) => {
  if (cond) ok(label);
  else {
    fail(`${label}${detail ? ` \u2014 ${detail}` : ""}`);
    failures++;
  }
};
section("A. buildMetadataParams \u2014 pure");
{
  const p = buildMetadataParams();
  expect("defaults: CREATE_AND_UPDATE", p.importStrategy === "CREATE_AND_UPDATE");
  expect("defaults: atomicMode=NONE", p.atomicMode === "NONE");
  expect("defaults: MERGE", p.mergeMode === "MERGE");
  expect("defaults: identifier=AUTO", p.identifier === "AUTO");
  expect("defaults: skipSharing=true", p.skipSharing === "true");
  expect("defaults: no importMode", p.importMode === void 0);
}
{
  const p = buildMetadataParams({ skipSharing: false });
  expect("skipSharing=false omits key", p.skipSharing === void 0);
}
{
  const p = buildMetadataParams({ dryRun: true });
  expect("dryRun=true \u2192 importMode=VALIDATE", p.importMode === "VALIDATE");
}
{
  const p = buildMetadataParams({ importStrategy: "CREATE", mergeMode: "REPLACE" });
  expect("CREATE strategy passes through", p.importStrategy === "CREATE");
  expect("REPLACE merge passes through", p.mergeMode === "REPLACE");
}
{
  const q = paramsToQuery(buildMetadataParams({ dryRun: true }));
  expect("paramsToQuery contains importMode=VALIDATE", q.includes("importMode=VALIDATE"));
  expect("paramsToQuery contains skipSharing=true", q.includes("skipSharing=true"));
  expect("paramsToQuery encodes atomicMode=NONE", q.includes("atomicMode=NONE"));
}
section("B. Live DHIS2 round-trip");
try {
  await api.get("/api/me?fields=id");
} catch (e) {
  info(`skipped live tests (no DHIS2): ${e.message.slice(0, 120)}`);
  console.log("\n" + (failures === 0 ? "[OK] METADATA OPTIONS (unit only)" : `[FAIL] ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}
var postMeta = (opts, payload) => api.post(`/api/metadata?${paramsToQuery(buildMetadataParams(opts))}`, payload);
var existing = await api.get("/api/dataElements?fields=id,name,shortName,formName,valueType,aggregationType,domainType&pageSize=1");
var de = existing.dataElements?.[0];
if (!de) {
  fail("no dataElements available on server");
  process.exit(1);
}
info(`using existing DE: ${de.id} "${de.name}"`);
{
  const r = await postMeta(
    { importStrategy: "CREATE" },
    { dataElements: [{ ...de, name: de.name + " EDIT" }] }
  );
  const status = r.body?.status;
  const created = r.body?.stats?.created ?? 0;
  expect(
    "CREATE on existing UID does not create",
    status === "ERROR" || status === "WARNING" || created === 0,
    `status=${status} created=${created}`
  );
}
{
  const freshId = "x" + Math.random().toString(36).slice(2, 12);
  const newDe = {
    id: freshId,
    name: `Test DE ${freshId}`,
    shortName: `Test ${freshId}`.slice(0, 50),
    formName: `Test ${freshId}`,
    valueType: "NUMBER",
    aggregationType: "SUM",
    domainType: "AGGREGATE"
  };
  const r = await postMeta({ importStrategy: "UPDATE" }, { dataElements: [newDe] });
  const created = r.body?.stats?.created ?? 0;
  expect("UPDATE strategy does not create new UIDs", created === 0, `created=${created}`);
}
{
  const marker = `DRYRUN-${Date.now()}`;
  const r = await postMeta(
    { dryRun: true, mergeMode: "MERGE" },
    { dataElements: [{ ...de, description: marker }] }
  );
  expect("dry run returns 200", r.status === 200, `status=${r.status}`);
  const check = await api.get(`/api/dataElements/${de.id}?fields=description`);
  expect(
    "dry run did not persist change",
    (check.description ?? "") !== marker,
    `description="${check.description}"`
  );
}
{
  const original = `ORIGINAL-${Date.now()}`;
  await postMeta(
    { importStrategy: "UPDATE", mergeMode: "MERGE" },
    { dataElements: [{ ...de, description: original }] }
  );
  let got = await api.get(`/api/dataElements/${de.id}?fields=description,name`);
  expect("MERGE sets description", got.description === original, `got="${got.description}"`);
  await postMeta(
    { importStrategy: "UPDATE", mergeMode: "MERGE" },
    { dataElements: [{ id: de.id, name: got.name }] }
  );
  got = await api.get(`/api/dataElements/${de.id}?fields=description`);
  expect("MERGE preserves omitted fields", got.description === original, `got="${got.description}"`);
  await postMeta(
    { importStrategy: "UPDATE", mergeMode: "REPLACE" },
    {
      dataElements: [{
        id: de.id,
        name: de.name,
        shortName: de.shortName ?? de.name.slice(0, 50),
        valueType: de.valueType,
        aggregationType: de.aggregationType,
        domainType: de.domainType
      }]
    }
  );
  got = await api.get(`/api/dataElements/${de.id}?fields=description`);
  expect("REPLACE clears omitted fields", !got.description, `got="${got.description}"`);
  await postMeta(
    { importStrategy: "UPDATE", mergeMode: "MERGE" },
    { dataElements: [{ ...de, description: de.description ?? "" }] }
  );
}
{
  const ghostUserUid = "ghostUser01";
  const payload = {
    dataElements: [{
      ...de,
      sharing: {
        public: "rw------",
        owner: ghostUserUid,
        users: { [ghostUserUid]: { access: "rw------", id: ghostUserUid } },
        userGroups: {}
      }
    }]
  };
  const rSkip = await postMeta({ skipSharing: true, dryRun: true }, payload);
  expect("skipSharing=true validates OK despite bad owner", rSkip.status === 200 && rSkip.body?.status !== "ERROR", `status=${rSkip.body?.status}`);
  const rNoSkip = await postMeta({ skipSharing: false, dryRun: true }, payload);
  info(`skipSharing=false status=${rNoSkip.body?.status}`);
}
console.log("\n" + (failures === 0 ? "[OK] METADATA OPTIONS VERIFIED" : `[FAIL] ${failures} failure(s)`));
process.exit(failures === 0 ? 0 : 1);
