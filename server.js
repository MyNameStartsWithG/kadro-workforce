/**
 * Kadro — Workforce Management (ACME ENGINEERING)
 * Local server. Started by start.bat, runs in the browser.
 */
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { exec, execSync } from "node:child_process";
import sea from "node:sea";

import * as db from "./src/db.js";
import * as folders from "./src/folders.js";
import * as excel from "./src/excel.js";
import { classify, byRules, suggestedName } from "./src/classifier.js";
import { TABLES, nextCode, CODED } from "./src/tables.js";
import * as relations from "./src/relations.js";
import * as timesheet from "./src/timesheet.js";
import * as cash from "./src/cash.js";
import * as forecast from "./src/forecast.js";
import * as payments from "./src/payments.js";
import * as rates from "./src/rates.js";
import * as employeeView from "./src/employee-view.js";
import * as assistant from "./src/assistant.js";
import * as contracts from "./src/contracts.js";
import * as notes from "./src/notes.js";
import { flatTree, TEMPLATES } from "./src/structure.js";

// When packaged as KADRO.exe (see build.mjs) the UI is read from inside the exe,
// and data lives under Documents\KADRO wherever the exe is.
const PACKAGED = sea.isSea();

function documentsFolder() {
  try {
    const p = execSync(`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`,
      { encoding: "utf8", windowsHide: true }).trim();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return path.join(os.homedir(), "Documents");
}

// KADRO_FOLDER: keeps the data in another folder for testing (without touching the real Documents\KADRO data).
const HOME = process.env.KADRO_FOLDER
  ? path.resolve(process.env.KADRO_FOLDER)
  : PACKAGED
    ? path.join(documentsFolder(), "KADRO")
    : path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HOME, "data");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const PORT = Number(process.env.PORT) || 4360;
const VERSION = "2.5.2";

fs.mkdirSync(TMP_DIR, { recursive: true });
db.init(DATA_DIR);

// Update: the first time a new version starts, the data is backed up before it is migrated (data/backups).
// The client only replaces the exe; records stay in Documents\KADRO and this backup is the way back if anything goes wrong.
const previousVersion = db.settings().version || null;
if (previousVersion !== VERSION && db.table("employees").length) {
  try { console.log(`  Update backup: ${db.backup(`before-update-${previousVersion || "old"}`)}`); }
  catch (e) { console.error(`[update backup] failed: ${e.message}`); }
}

/** Runs at startup and after a restore: migrates older data, syncs cash with its sources. */
function prepareData() {
  // v1 → v2: old equipment records stay as personal equipment.
  let changed = false;
  for (const e of db.table("equipment")) {
    if (!e.ownerType) { e.ownerType = "Person"; e.crewCode = e.crewCode || ""; changed = true; }
  }
  if (changed) db.save();
  // v2.5: an employee's single-line note moves to the Notes panel as a "General note".
  try { notes.migrateOldNotes(); } catch (e) { console.error(`[notes] could not migrate: ${e.message}`); }
  // Statuses of people with employment periods, and the range copies in open timesheets.
  try { contracts.sync(); } catch (e) { console.error(`[contracts] could not sync: ${e.message}`); }
  // Sync the automatic cash rows (advances, salary, meals, rent) with their sources.
  try { return cash.sync(); } catch (e) { console.error(`[cash] could not sync: ${e.message}`); return null; }
}
prepareData();
if (previousVersion !== VERSION) db.saveSettings({ version: VERSION });

// The document root is created next to the app on first start.
if (!db.settings().documentRoot) {
  db.saveSettings({ documentRoot: path.join(HOME, "ACME ENGINEERING") });
}
const root = () => db.settings().documentRoot;

const app = express();
app.use(express.json({ limit: "5mb" }));
// After every request that changes data, the monthly cash files are refreshed (only changed months are written).
app.use((req, res, next) => {
  if (req.method !== "GET" && req.path.startsWith("/api/")) res.on("finish", scheduleCashFiles);
  next();
});
if (PACKAGED) {
  app.use((req, res, next) => {
    const name = req.path === "/" ? "index.html" : req.path.slice(1);
    if (!["index.html", "app.js", "style.css"].includes(name)) return next();
    res.type(path.extname(name)).send(Buffer.from(sea.getAsset(name)));
  });
} else {
  app.use(express.static(path.join(HOME, "public")));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, TMP_DIR),
    filename: (_r, _f, cb) => cb(null, `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 30 },
});

/** Uploaded files not filed yet. */
const pending = new Map();

// Note: fn may also throw synchronously; the async wrapper catches both.
// (Promise.resolve(fn(...)) misses a synchronous throw and Express answers with an HTML 500.)
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(`[error] ${req.method} ${req.path} — ${e.message}`);
    if (!res.headersSent) res.status(400).json({ error: e.message });
  }
};

/* ------------------------------------------------------------------ */
/* Status and settings                                                 */
/* ------------------------------------------------------------------ */

app.get("/api/status", wrap((_req, res) => {
  const s = db.settings();
  const built = fs.existsSync(root());
  res.json({
    documentRoot: root(),
    built,
    aiMode: s.aiMode,
    threshold: s.threshold,
    user: s.user,
    rates: rates.rateSettings(),
    apiKeySet: Boolean(s.apiKey || process.env.ANTHROPIC_API_KEY),
    apiKeySource: s.apiKey ? "settings" : (process.env.ANTHROPIC_API_KEY ? "environment variable" : null),
    assistant: { ready: assistant.config().ready, url: s.assistantUrl || "", defaultUrl: assistant.DEFAULT_URL, keySet: Boolean(s.assistantKey), embedded: assistant.hasEmbeddedKey },
    counts: {
      employees: db.table("employees").length,
      equipment: db.table("equipment").filter((e) => e.status === "Issued").length,
      crews: db.table("crews").filter((c) => c.status !== "Inactive").length,
      vehicles: db.table("vehicles").length,
      projects: db.table("projects").filter((p) => p.status === "In progress").length,
      houses: db.table("houses").filter((h) => h.status !== "Vacated").length,
      advances: db.table("advances").length,
      contracts: db.table("contracts").filter((r) => ["Ongoing", "On leave", "Not started"].includes(contracts.recordStatus(r))).length,
      cash: db.table("cash").length,
      paymentsDue: paymentsDue(),
      clients: db.table("clients").length,
      documents: db.table("documents").length,
    },
    version: VERSION,
    port: PORT,
  });
}));

app.post("/api/settings", wrap((req, res) => {
  const allowed = ["documentRoot", "apiKey", "aiMode", "user", "threshold", "assistantUrl", "assistantKey"];
  const changes = {};
  for (const k of allowed) if (k in req.body) changes[k] = req.body[k];
  if (changes.documentRoot) changes.documentRoot = path.resolve(String(changes.documentRoot));
  if ("assistantUrl" in changes) {
    const url = String(changes.assistantUrl || "").trim().replace(/\/+$/, "");
    if (url && !/^https:\/\/[^\s/]+/.test(url)) throw new Error("The assistant address must start with https:// (e.g. https://n8n.example.com).");
    changes.assistantUrl = url;
  }
  if ("assistantKey" in changes) changes.assistantKey = String(changes.assistantKey || "").trim();
  if (changes.threshold !== undefined) changes.threshold = Math.max(0, Math.min(1, Number(changes.threshold) || 0.72));
  // Rates: 1 base currency = x of another. Opened timesheet periods keep their own rates.
  if ("rates" in req.body) changes.rates = rates.validate(req.body.rates);
  res.json(db.saveSettings(changes));
}));

app.post("/api/build", wrap((_req, res) => res.json(folders.buildStructure(root()))));

/* Backup: every record in one .json file. Documents (folders) are not part of it. */

app.get("/api/backup", wrap((_req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify({ app: "Kadro", version: VERSION, date: new Date().toISOString(), data: db.exportData() }, null, 2);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`Kadro backup ${date}.json`)}`);
  res.end(body);
}));

app.post("/api/backup", upload.single("file"), wrap((req, res) => {
  if (!req.file) throw new Error("No file received.");
  let incoming;
  try { incoming = JSON.parse(fs.readFileSync(req.file.path, "utf8").replace(/^﻿/, "")); }
  catch { throw new Error("The file could not be read. Choose a Kadro backup (.json) downloaded from the system."); }
  finally { try { fs.unlinkSync(req.file.path); } catch {} }
  // Both the package the system downloads and a plain db.json are accepted.
  const previousBackup = db.importData(incoming?.app === "Kadro" ? incoming.data : incoming);
  const cashReport = prepareData();
  const counts = Object.fromEntries(["employees", "crews", "equipment", "projects", "houses", "vehicles", "clients", "advances", "cash", "timesheets", "documents"]
    .map((k) => [k, db.table(k).length]));
  res.json({ counts, previousBackup: path.relative(HOME, previousBackup), cash: cashReport });
}));

/**
 * Resets every record. A backup goes to data/backups first; settings stay.
 * documents: true moves the document folder aside as "(old date)" instead of deleting it and builds an empty structure.
 */
app.post("/api/reset", wrap((req, res) => {
  if (req.body?.confirm !== "DELETE") throw new Error('Type "DELETE" to confirm.');
  // Document folder first: if an open file stops it from moving, no record is deleted.
  const oldRoot = req.body.documents ? folders.setRootAside(root()) : null;
  const backup = db.reset();
  for (const p of pending.values()) { try { fs.unlinkSync(p.path); } catch {} }
  pending.clear();
  cashSignature.clear(); cashFileError.clear();
  if (oldRoot) folders.buildStructure(root());
  res.json({ backup: path.relative(HOME, backup), oldRoot });
}));

/* ------------------------------------------------------------------ */
/* Folder tree                                                         */
/* ------------------------------------------------------------------ */

app.get("/api/tree", wrap((_req, res) => res.json(folders.scanTree(root()))));

app.get("/api/structure", wrap((_req, res) => res.json({ flat: flatTree(), templates: TEMPLATES })));

app.get("/api/targets", wrap((_req, res) => res.json(folders.targetFolders(root()))));

app.post("/api/open-folder", wrap((req, res) => {
  const full = folders.explorerPath(root(), req.body.path || "");
  if (!fs.existsSync(full)) return res.status(404).json({ error: "The folder is not on disk. Press Build Folder Structure first." });
  if (process.platform === "win32") exec(`explorer "${full}"`);
  else if (process.platform === "darwin") exec(`open "${full}"`);
  else exec(`xdg-open "${full}"`);
  res.json({ opened: full });
}));

/* Deleting documents: the file moves to "_Deleted" and the Document Register gets a note. It can be restored. */

const now = () => new Date().toLocaleString("en-GB");

app.post("/api/document/delete", wrap((req, res) => {
  const { folder, name } = req.body || {};
  const result = folders.deleteFile(root(), folder, name);
  const status = `Deleted ${now()} · ${db.settings().user} · in Deleted`;
  // Mark the latest log entry; if there is none (a file put there by hand) a deletion entry is created.
  const entry = db.table("documents").filter((d) => d.targetPath === folder && d.fileName === name && !d.deletedPath).at(-1);
  if (entry) db.updateRow("documents", entry._id, { status, deletedPath: result.path });
  else {
    db.insertRow("documents", {
      date: now(), fileName: name, targetPath: folder, docType: "", related: "", method: "Manual", confidence: "—", size: "",
      user: db.settings().user, status, deletedPath: result.path,
    });
  }
  res.json(result);
}));

app.post("/api/document/restore", wrap((req, res) => {
  const { folder, name } = req.body || {};
  const result = folders.restoreFile(root(), folder, name);
  const entry = db.table("documents").find((d) => d.deletedPath === `${folder}/${name}`);
  if (entry) {
    db.updateRow("documents", entry._id, {
      status: `Restored ${now()} · ${db.settings().user}`, fileName: result.name, targetPath: result.folder, deletedPath: "",
    });
  }
  res.json(result);
}));

app.post("/api/document/purge", wrap((req, res) => {
  const { folder, name } = req.body || {};
  folders.purgeFile(root(), folder, name);
  const entry = db.table("documents").find((d) => d.deletedPath === `${folder}/${name}`);
  if (entry) db.updateRow("documents", entry._id, { status: `Deleted permanently ${now()} · ${db.settings().user}`, deletedPath: "" });
  res.json({ deleted: true });
}));

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

function getDef(name) {
  const t = TABLES[name];
  if (!t) throw new Error(`Unknown table: ${name}`);
  return t;
}

/** Side effects when a row is saved: code generation, folders, default values. */
function prepareRow(tableName, incoming, existing) {
  const def = getDef(tableName);
  const row = { ...(existing || {}) };

  for (const c of def.columns) {
    if (c.computed || (c.type === "readonly" && c.key !== "code")) continue;
    if (c.key in incoming) row[c.key] = incoming[c.key];
    else if (row[c.key] === undefined) row[c.key] = c.default ?? "";
  }
  // Computed columns are never stored.
  for (const c of def.columns) if (c.computed) delete row[c.key];

  for (const c of def.columns) {
    if (c.required && !String(row[c.key] || "").trim()) {
      throw new Error(`"${c.label}" cannot be empty.`);
    }
  }

  if (CODED.includes(tableName) && !row.code) {
    row.code = nextCode(tableName, db.table(tableName));
  }
  if (tableName === "equipment") {
    if (row.ownerType === "Crew") {
      if (!db.findRow("crews", (x) => x.code === row.crewCode)) {
        throw new Error(row.crewCode ? `No crew with number "${row.crewCode}".` : "Choose a crew for crew equipment.");
      }
      row.employeeCode = "";
    } else {
      row.ownerType = "Person";
      if (!db.findRow("employees", (x) => x.code === row.employeeCode)) {
        throw new Error(row.employeeCode ? `No employee with code "${row.employeeCode}".` : "Choose an employee for personal equipment.");
      }
      row.crewCode = "";
    }
  }
  if (tableName === "advances" && !db.findRow("employees", (x) => x.code === row.employeeCode)) {
    throw new Error(`No employee with code "${row.employeeCode}".`);
  }
  if (tableName === "contracts") contracts.validate(row);
  if (tableName === "employees") recordPayHistory(row, existing);
  if (tableName === "cash") prepareCashRow(row, existing);
  return row;
}

/**
 * When the pay section changes it is written to a dated history. Timesheet periods copy the pay as it is
 * when they open, so a change only applies to new periods.
 */
function recordPayHistory(row, existing) {
  const fields = ["payType", "pay", "currency", "overtimeRate"];
  const changed = fields.some((k) => String(existing?.[k] ?? "") !== String(row[k] ?? ""));
  if (!changed || !(String(row.pay || "").trim() || existing?.pay)) return;
  row.payHistory = [
    ...(existing?.payHistory || []),
    {
      date: new Date().toISOString().slice(0, 10),
      payType: row.payType || "", pay: row.pay || "", currency: row.currency || "",
      overtimeRate: row.overtimeRate || "",
      user: db.settings().user,
    },
  ];
}

/** Cash row: a row entered by hand has source "Manual"; an automatic row edited by hand is never overwritten again. */
function prepareCashRow(row, existing) {
  if (!["Income", "Expense"].includes(row.type)) throw new Error('Type must be "Income" or "Expense".');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ""))) throw new Error("Invalid date.");
  if (!(relations.num(row.amount) > 0)) throw new Error("The amount must be a number greater than zero.");
  if (!existing) row.source = "Manual";
  else if (existing.key && !existing.editedByHand && cash.changedByHand(existing, row)) row.editedByHand = true;
}

/** A warning shown to the user when a record changes (e.g. a house is over capacity). */
function recordWarning(tableName, row, before) {
  if (tableName === "employees" && row.house && row.house !== before?.house) {
    const h = db.findRow("houses", (x) => x.code === row.house);
    const c = h && relations.houseCalc(h);
    if (c?.overCapacity) return `${h.code} ${h.name}: ${c.headcount} people live there, ${c.beds} beds. Over capacity.`;
  }
  if (tableName === "employees" && before && contracts.isStatusAutomatic(row.code) && row.status !== before.status) {
    return "This person's status is computed from employment periods and cannot be changed by hand. Edit it in the Employment Periods card on the employee page.";
  }
  return null;
}

/** When an employment period or an employee changes, statuses and open timesheets are refreshed. */
const syncContracts = (tableName) => { if (tableName === "contracts" || tableName === "employees") contracts.sync(); };

app.get("/api/table/:name", wrap((req, res) => {
  const def = getDef(req.params.name);
  res.json({ def, rows: db.table(req.params.name).map((r) => relations.enrich(req.params.name, r)) });
}));

app.get("/api/detail/:name/:id", wrap((req, res) => {
  const def = getDef(req.params.name);
  if (!def.detail) throw new Error(`${def.name} has no detail page.`);
  const d = relations.detail(req.params.name, req.params.id);
  const folderPath = def.folderType ? folders.dynamicPath(def.folderType, d.row) : null;
  res.json({ def, folderPath, ...d });
}));

/* Insert / update / delete: the table screen and voice commands take the same path. */

function insertRecord(tableName, incoming) {
  const def = getDef(tableName);
  if (def.readOnly) throw new Error(`${def.name} cannot be edited.`);

  const row = db.insertRow(tableName, prepareRow(tableName, incoming || {}, null));
  if (tableName === "advances") cash.sync();
  syncContracts(tableName);
  let folderReport = null;
  if (def.folderType) folderReport = folders.buildDynamicFolder(root(), def.folderType, row);
  return {
    row: relations.enrich(tableName, row),
    folderReport,
    folderPath: def.folderType ? folders.dynamicPath(def.folderType, row) : null,
    warning: recordWarning(tableName, row, null),
  };
}

function updateRecord(tableName, id, incoming) {
  const def = getDef(tableName);
  if (def.readOnly) throw new Error(`${def.name} cannot be edited.`);

  const before = db.findRow(tableName, (x) => x._id === id);
  if (!before) throw new Error("Record not found.");

  const copy = { ...before };
  const ready = prepareRow(tableName, incoming || {}, before);
  const requestedStatus = ready.status;
  const row = db.updateRow(tableName, id, ready);
  if (tableName === "advances") cash.sync();
  syncContracts(tableName);

  let renamed = null;
  if (def.folderType) {
    renamed = folders.renameFolder(root(), def.folderType, copy, row);
    folders.buildDynamicFolder(root(), def.folderType, row);
  }
  return { row: relations.enrich(tableName, row), renamed, warning: recordWarning(tableName, { ...row, status: requestedStatus }, copy) };
}

app.post("/api/table/:name", wrap((req, res) => res.json(insertRecord(req.params.name, req.body))));

app.put("/api/table/:name/:id", wrap((req, res) => res.json(updateRecord(req.params.name, req.params.id, req.body))));

/**
 * Clears the fields that point to the deleted record. A crew cannot be deleted while it holds equipment.
 * Returns: a note for the user (if any).
 */
function beforeDelete(tableName, row) {
  const clear = (table, field) => {
    for (const r of db.table(table)) if (r[field] === row.code) db.updateRow(table, r._id, { [field]: "" });
  };
  if (tableName === "crews") {
    const open = relations.crewEquipment(row.code);
    if (open.length) {
      throw new Error(`${row.code} ${row.name} holds ${open.length} items of equipment. ` +
        "Take them back or transfer them to another crew/person first.");
    }
    clear("employees", "crew");
  }
  if (tableName === "houses") clear("employees", "house");
  if (tableName === "employees") {
    db.all().contracts = db.table("contracts").filter((r) => r.employeeCode !== row.code);
    notes.removeForEmployee(row.code);
  }
  if (tableName === "projects") { clear("crews", "project"); clear("houses", "project"); }
  if (tableName === "cash") return cash.onDelete(row);
  return null;
}

function deleteRecord(tableName, id) {
  const def = getDef(tableName);
  if (def.readOnly) throw new Error(`${def.name} cannot be edited.`);
  const target = db.findRow(tableName, (x) => x._id === id);
  const note = target ? beforeDelete(tableName, target) : null;
  const deleted = db.deleteRow(tableName, id);
  if (tableName === "advances") cash.sync();
  syncContracts(tableName);
  // The folder is deliberately kept — documents stay. The user can delete it by hand.
  return { deleted, warning: note || (def.folderType ? "Record deleted. The folder and documents on disk are untouched." : null) };
}

app.delete("/api/table/:name/:id", wrap((req, res) => res.json(deleteRecord(req.params.name, req.params.id))));

assistant.connect({ insert: insertRecord, update: updateRecord, remove: deleteRecord });
assistant.startLog(DATA_DIR, VERSION);

/* Per-person notes (the Notes panel on the employee page) */

app.get("/api/notes/:code", wrap((req, res) => res.json(notes.list(req.params.code))));
app.post("/api/notes", wrap((req, res) => res.json(notes.add(req.body?.employeeCode, req.body || {}))));
app.put("/api/notes/:id", wrap((req, res) => res.json(notes.update(req.params.id, req.body || {}))));
app.delete("/api/notes/:id", wrap((req, res) => { notes.remove(req.params.id); res.json({ deleted: true }); }));

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sendFile = (res, buffer, name, type = XLSX) => {
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.end(Buffer.from(buffer));
};

app.get("/api/table/:name/excel", wrap(async (req, res) => {
  const def = getDef(req.params.name);
  const buffer = await excel.writeTable(req.params.name, db.table(req.params.name).map((r) => relations.enrich(req.params.name, r)));
  sendFile(res, buffer, `Kadro ${def.name} ${new Date().toISOString().slice(0, 10)}.xlsx`);
}));

app.post("/api/table/:name/excel", upload.single("file"), wrap(async (req, res) => {
  const tableName = req.params.name;
  const def = getDef(tableName);
  if (def.readOnly) throw new Error(`${def.name} cannot be imported.`);
  if (!req.file) throw new Error("No file received.");

  const { rows, recognisedColumns } = await excel.readTable(tableName, fs.readFileSync(req.file.path));
  fs.unlinkSync(req.file.path);

  const key = { employees: "code", projects: "code", clients: "code", crews: "code", houses: "code", vehicles: "plate" }[tableName] || null;
  const report = { added: 0, updated: 0, skipped: [], folders: 0 };

  for (const [i, raw] of rows.entries()) {
    try {
      const existing = key && raw[key]
        ? db.findRow(tableName, (x) => String(x[key]).trim() === String(raw[key]).trim())
        : null;
      if (existing) {
        const row = db.updateRow(tableName, existing._id, prepareRow(tableName, raw, existing));
        if (def.folderType) { folders.buildDynamicFolder(root(), def.folderType, row); report.folders += 1; }
        report.updated += 1;
      } else {
        const row = db.insertRow(tableName, prepareRow(tableName, raw, null));
        if (def.folderType) { folders.buildDynamicFolder(root(), def.folderType, row); report.folders += 1; }
        report.added += 1;
      }
    } catch (e) {
      report.skipped.push({ row: i + 1, reason: e.message });
    }
  }
  if (tableName === "advances") cash.sync();
  syncContracts(tableName);
  res.json({ ...report, recognisedColumns, read: rows.length });
}));

/* ------------------------------------------------------------------ */
/* Document upload and automatic filing                                */
/* ------------------------------------------------------------------ */

app.post("/api/upload", upload.array("files", 30), wrap(async (req, res) => {
  if (!req.files?.length) throw new Error("No file received.");
  const results = [];

  for (const f of req.files) {
    const decoded = Buffer.from(f.originalname, "latin1").toString("utf8");
    const name = /[À-ÿ]/.test(f.originalname) && !/[ğüşıöçİĞÜŞÖÇ]/.test(f.originalname)
      ? decoded : f.originalname;
    try {
      const result = await classify(f.path, name);
      const ticket = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      pending.set(ticket, { path: f.path, name, size: f.size, time: Date.now() });
      results.push({ ticket, size: f.size, ...result });
    } catch (e) {
      try { fs.unlinkSync(f.path); } catch {}
      results.push({ fileName: name, error: e.message });
    }
  }
  res.json({ results });
}));

app.post("/api/place", wrap((req, res) => {
  const { ticket, targetPath, fileName, docType, related, method, confidence } = req.body || {};
  const p = pending.get(ticket);
  if (!p) throw new Error("The file has expired or was already filed. Please upload it again.");
  if (!targetPath) throw new Error("No target folder chosen.");

  const placed = folders.placeFile(root(), p.path, targetPath, fileName || p.name);
  pending.delete(ticket);

  const logEntry = db.insertRow("documents", {
    date: new Date().toLocaleString("en-GB"),
    fileName: placed.name,
    targetPath,
    docType: docType || "",
    related: related || "",
    method: method === "claude" ? "AI" : method === "rules" ? "Rules" : "Manual",
    confidence: confidence ? `${Math.round(confidence * 100)}%` : "—",
    size: `${(placed.size / 1024).toFixed(0)} KB`,
    user: db.settings().user,
  });
  res.json({ placed, logEntry });
}));

app.post("/api/cancel", wrap((req, res) => {
  const p = pending.get(req.body.ticket);
  if (p) { try { fs.unlinkSync(p.path); } catch {} pending.delete(req.body.ticket); }
  res.json({ cancelled: true });
}));

/** Refreshes the suggested file name when the target is changed by hand. */
app.post("/api/suggest-name", wrap((req, res) => {
  const { fileName, targetPath } = req.body || {};
  const rules = byRules(fileName || "");
  res.json({ name: suggestedName(fileName || "", { ...rules, targetPath }) });
}));

/* ------------------------------------------------------------------ */
/* Timesheet                                                           */
/* ------------------------------------------------------------------ */

/** The period package sent to the screen: record + calculation + day headers + neighbouring periods. */
function timesheetPackage(period) {
  const pid = timesheet.parsePeriod(period).period;
  const t = timesheet.find(pid);
  const common = {
    period: pid, name: timesheet.periodName(pid),
    previous: timesheet.adjacentPeriod(pid, -1), next: timesheet.adjacentPeriod(pid, 1),
    current: timesheet.currentPeriod(),
    days: timesheet.dayInfo(pid),
  };
  if (!t) return { ...common, missing: true, preview: timesheet.preview(pid) };
  return { ...common, record: t, calc: timesheet.calc(t) };
}

const timesheetFilePath = (period) => {
  const p = timesheet.parsePeriod(period);
  return `02 - Accounting/Payroll/Timesheets/${p.year}-${String(p.month).padStart(2, "0")} H${p.half}.xlsx`;
};

const writeTimesheetFile = async (t) =>
  excel.writeTimesheet(t, timesheet.calc(t), timesheet.dayInfo(t.period), timesheet.periodName(t.period));

app.get("/api/timesheets", wrap((_req, res) => {
  res.json(timesheet.allPeriods().map((t) => ({ period: t.period, name: timesheet.periodName(t.period), status: t.status, people: t.rows.length })));
}));

app.get("/api/timesheet/:period", wrap((req, res) => res.json(timesheetPackage(req.params.period))));

app.post("/api/timesheet/:period", wrap((req, res) => {
  timesheet.create(req.params.period);
  res.json(timesheetPackage(req.params.period));
}));

app.put("/api/timesheet/:period/cells", wrap((req, res) => {
  const list = Array.isArray(req.body?.changes) ? req.body.changes : [req.body];
  timesheet.writeCells(req.params.period, list);
  res.json(timesheetPackage(req.params.period));
}));

app.put("/api/timesheet/:period/crew-days", wrap((req, res) => {
  const { employeeCode, days, crew } = req.body || {};
  timesheet.writeCrewDays(req.params.period, employeeCode, days || [], crew || "");
  res.json(timesheetPackage(req.params.period));
}));

app.put("/api/timesheet/:period/settings", wrap((req, res) => {
  timesheet.writeSettings(req.params.period, req.body || {});
  res.json(timesheetPackage(req.params.period));
}));

app.post("/api/timesheet/:period/row", wrap((req, res) => {
  timesheet.addRow(req.params.period, req.body?.employeeCode);
  res.json(timesheetPackage(req.params.period));
}));

app.delete("/api/timesheet/:period/row/:code", wrap((req, res) => {
  timesheet.removeRow(req.params.period, req.params.code);
  res.json(timesheetPackage(req.params.period));
}));

app.post("/api/timesheet/:period/close", wrap(async (req, res) => {
  const t = timesheet.get(req.params.period);
  if (t.status === "closed") throw new Error("The period is already closed.");
  // Lock first, then write the Excel file in its closed state (empty days now count as short).
  timesheet.setStatus(t.period, "closed");
  const file = timesheetFilePath(t.period);
  let written = null;
  try {
    const full = folders.fullPath(root(), file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(await writeTimesheetFile(t)));
    written = file;
  } catch (e) {
    console.error(`[timesheet] Excel could not be written: ${e.message}`);
  }
  timesheet.setStatus(t.period, "closed", { file: written });
  const cashReport = cash.sync();
  res.json({
    ...timesheetPackage(t.period), file: written, cash: cashReport,
    fileError: written ? null : "The period is closed but the Excel file could not be written to disk. Check the document root.",
  });
}));

app.post("/api/timesheet/:period/open", wrap((req, res) => {
  timesheet.setStatus(timesheet.get(req.params.period).period, "open");
  // Meal / rent / salary rows written to cash at closing are taken back (rows corrected by hand stay).
  res.json({ ...timesheetPackage(req.params.period), cash: cash.sync() });
}));

app.get("/api/timesheet/:period/excel", wrap(async (req, res) => {
  const t = timesheet.get(req.params.period);
  const p = timesheet.parsePeriod(t.period);
  sendFile(res, await writeTimesheetFile(t), `Kadro Timesheet ${p.year}-${String(p.month).padStart(2, "0")} H${p.half}.xlsx`);
}));

app.post("/api/timesheet/:period/excel", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) throw new Error("No file received.");
  const t = timesheet.get(req.params.period);
  let read;
  try {
    read = await excel.readTimesheet(fs.readFileSync(req.file.path), t, timesheet.dayInfo(t.period));
  } finally {
    fs.unlinkSync(req.file.path);
  }
  // Skip cells that did not change; if one value is invalid, nothing is written.
  const changed = read.changes.filter(({ employeeCode, day, value }) => {
    const r = t.rows.find((x) => x.employeeCode === employeeCode);
    return (r.cells[day] || "") !== timesheet.normalizeValue(value);
  });
  if (changed.length) timesheet.writeCells(t.period, changed);
  res.json({ ...timesheetPackage(t.period), report: { changed: changed.length, unknown: read.unknown } });
}));

app.get("/api/statistics", wrap((req, res) => {
  res.json(timesheet.statistics(req.query.from || "", req.query.to || ""));
}));

app.get("/api/statistics/employee/:code", wrap((req, res) => res.json(timesheet.employeeBreakdown(req.params.code))));

/** Employee's view: the person's own timesheet, earnings, reasons for deductions and payments. */
app.get("/api/employee-view/:code", wrap((req, res) => res.json({ ...employeeView.view(req.params.code), rates: rates.rateSettings() })));

/* ------------------------------------------------------------------ */
/* Cash                                                                */
/* ------------------------------------------------------------------ */

const cashFilePath = (month) => `02 - Accounting/Cash/${month} Cash.xlsx`;

/** Cash rows for the screen and Excel: status label, project and employee names added. */
function cashRows(rows) {
  const projects = new Map(db.table("projects").map((x) => [x.code, x.name]));
  const employees = new Map(db.table("employees").map((x) => [x.code, x.name]));
  return rows.map((r) => ({
    ...relations.enrich("cash", r),
    projectName: r.project ? projects.get(r.project) || r.project : "",
    employeeName: r.employeeCode ? employees.get(r.employeeCode) || r.employeeCode : "",
  }));
}

const cashMonth = (month) => { const v = cash.month(month); return { ...v, rows: cashRows(v.rows) }; };

// Monthly cash file: the signature of the last written content, and the reason if it could not be written.
const cashSignature = new Map();
const cashFileError = new Map();
let cashTimer = null;

function scheduleCashFiles() {
  clearTimeout(cashTimer);
  cashTimer = setTimeout(() => writeCashFiles().catch((e) => console.error(`[cash] ${e.message}`)), 400);
}

async function writeCashFiles() {
  if (!fs.existsSync(root())) return; // the structure has not been built on disk yet
  for (const month of new Set([...cashSignature.keys(), ...cash.months()])) {
    const v = cashMonth(month);
    const signature = JSON.stringify([v.rows.map((r) => [r._id, r.date, r.type, r.category, r.description, r.project,
      r.employeeCode, r.amount, r.currency, r.statusLabel]), v.summary.carry, v.deleted.length]);
    const full = folders.fullPath(root(), cashFilePath(month));
    if (cashSignature.get(month) === signature && fs.existsSync(full)) continue;
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, Buffer.from(await excel.writeCash(v)));
      cashSignature.set(month, signature);
      cashFileError.delete(month);
    } catch (e) {
      cashFileError.set(month, ["EBUSY", "EPERM"].includes(e.code)
        ? "The cash file could not be updated because it is open in Excel. It will be written on the next change after you close it."
        : `The cash file could not be written: ${e.message}`);
    }
  }
}

// "report" is not a month; it must be defined before the :month routes.
app.get("/api/cash/report", wrap((req, res) => res.json(cash.report(req.query))));

app.get("/api/cash/report/excel", wrap(async (req, res) => {
  const r = cash.report(req.query);
  const typeName = { period: "15-Day", month: "Monthly", quarter: "Quarterly", half: "Half-Yearly", year: "Yearly", project: "By Project" }[r.type];
  const title = `Cash Report · ${typeName}${r.type === "year" ? "" : ` · ${r.year}`} · ${r.projectName}`;
  sendFile(res, await excel.writeCashReport(r, title), `Kadro Cash Report ${typeName} ${r.type === "year" ? "" : r.year}.xlsx`.replace(/\s+\./, "."));
}));

app.get("/api/cash/:month", wrap((req, res) => {
  const month = req.params.month === "current" ? cash.currentMonth() : req.params.month;
  res.json({
    ...cashMonth(month), def: TABLES.cash,
    file: cashFilePath(month), fileError: cashFileError.get(month) || null,
  });
}));

app.get("/api/cash/:month/excel", wrap(async (req, res) => {
  sendFile(res, await excel.writeCash(cashMonth(req.params.month)), `Kadro ${req.params.month} Cash.xlsx`);
}));

app.post("/api/cash/:month/restore", wrap((req, res) => res.json(cash.restoreMonth(req.params.month))));

app.post("/api/cash/row/:id/system", wrap((req, res) => {
  const report = cash.releaseToSystem(req.params.id);
  const row = db.findRow("cash", (x) => x._id === req.params.id);
  res.json({ ...report, row: row ? cashRows([row])[0] : null });
}));

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

/** Unpaid items due today or earlier: the counter in the menu. */
function paymentsDue() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const paid = new Set(db.table("payments").map((r) => r.key));
    return payments.items().filter((k) => k.due <= today && !paid.has(k.key)).length;
  } catch { return 0; }
}

function adjacentMonth(month, dir) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

app.get("/api/payments/:month", wrap((req, res) => {
  const month = req.params.month === "current" ? cash.currentMonth() : req.params.month;
  res.json({ ...payments.month(month), name: cash.monthName(month), previous: adjacentMonth(month, -1), next: adjacentMonth(month, 1), current: cash.currentMonth() });
}));

app.post("/api/payments", wrap((req, res) => {
  const count = payments.pay(req.body?.list || []);
  res.json({ count, cash: cash.sync() });
}));

app.post("/api/payments/undo", wrap((req, res) => {
  payments.undo(req.body?.key);
  res.json({ cash: cash.sync() });
}));

/* ------------------------------------------------------------------ */
/* Forecast                                                            */
/* ------------------------------------------------------------------ */

app.get("/api/forecast", wrap((req, res) => res.json(forecast.calc(req.query))));

app.put("/api/forecast/cell", wrap((req, res) => {
  forecast.writeCell(req.body || {});
  res.json(forecast.calc(req.body?.view || {}));
}));

app.get("/api/forecast/excel", wrap(async (req, res) => {
  const v = forecast.calc(req.query);
  sendFile(res, await excel.writeForecast(v), `Kadro Forecast ${v.columns[0].period} - ${v.columns.at(-1).period}.xlsx`);
}));

/* ------------------------------------------------------------------ */
/* Voice commands (see src/assistant.js)                               */
/* ------------------------------------------------------------------ */

app.get("/api/assistant", wrap((_req, res) => res.json(assistant.status())));

app.post("/api/assistant/text", wrap(async (req, res) => {
  res.json(await assistant.command(req.body?.text, req.body?.conversationId));
}));

app.post("/api/assistant/voice", upload.single("audio"), wrap(async (req, res) => {
  if (!req.file) throw new Error("No audio received.");
  try { res.json(await assistant.voiceCommand(req.file.path, req.file.mimetype, req.body?.conversationId)); }
  finally { fs.unlink(req.file.path, () => {}); }
}));

app.post("/api/assistant/approve", wrap((req, res) => res.json(assistant.approve(req.body?.id))));
app.post("/api/assistant/cancel", wrap((req, res) => res.json(assistant.cancel(req.body?.id))));
app.post("/api/assistant/undo", wrap((req, res) => res.json(assistant.undo(req.body?.id))));
// Command log: how many records are queued; send = send now instead of waiting 15 minutes.
app.get("/api/assistant/log", wrap((_req, res) => res.json(assistant.logStatus())));
app.post("/api/assistant/log/send", wrap(async (_req, res) => res.json({ ...(await assistant.logSend()), ...assistant.logStatus() })));

/* ------------------------------------------------------------------ */
/* Expiry warnings                                                     */
/* ------------------------------------------------------------------ */

app.get("/api/warnings", wrap((_req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];

  for (const [tableName, def] of Object.entries(TABLES)) {
    const warnColumns = def.columns.filter((c) => c.warnDays);
    if (!warnColumns.length) continue;

    for (const row of db.table(tableName)) {
      if (["Left", "Sold", "Archived", "Vacated", "Inactive"].includes(row.status)) continue;
      for (const c of warnColumns) {
        const raw = String(row[c.key] || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
        const d = new Date(raw + "T00:00:00");
        const daysLeft = Math.round((d - today) / 86400000);
        if (daysLeft > c.warnDays) continue;
        const person = row.employeeCode ? db.findRow("employees", (x) => x.code === row.employeeCode) : null;
        if (tableName === "contracts" && !contracts.shouldWarn(row, daysLeft)) continue;
        out.push({
          table: tableName,
          tableName: def.name,
          id: row._id,
          who: row.name || row.plate || row.code || person?.name || "—",
          href: tableName === "contracts" && person ? `#d/employees/${person._id}` : null,
          field: c.label,
          date: raw,
          daysLeft,
          level: daysLeft < 0 ? "past" : daysLeft <= 15 ? "critical" : "soon",
        });
      }
    }
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft);
  res.json(out);
}));

/* ------------------------------------------------------------------ */

// When the day turns, the status of people whose employment period ends / starts is updated.
setInterval(() => { try { contracts.sync(); } catch (e) { console.error(`[contracts] ${e.message}`); } }, 3600_000).unref();

// Clean up pending uploads older than an hour.
setInterval(() => {
  const limit = Date.now() - 3600_000;
  for (const [ticket, p] of pending) {
    if (p.time < limit) { try { fs.unlinkSync(p.path); } catch {} pending.delete(ticket); }
  }
}, 600_000).unref();

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Unknown endpoint." });
  if (PACKAGED) return res.type("html").send(Buffer.from(sea.getAsset("index.html")));
  res.sendFile(path.join(HOME, "public", "index.html"));
});

/** In the packaged version the window must not close on an error, so the user can read the message. */
function stopAndWait(message) {
  console.error("\n  [ERROR] " + message + "\n");
  if (!PACKAGED) process.exit(1);
  console.error("  Press any key or close the window to exit.");
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(1));
}
process.on("uncaughtException", (e) => stopAndWait(e.message));

/**
 * Seed data: records embedded in the client's exe (build.mjs --seed).
 * Loaded once on this computer's first start, if the system is empty; the folder structure is built and the
 * Excel files of closed timesheets and cash are written. If there are records, nothing is touched.
 */
function loadSeedData() {
  if (!PACKAGED || db.settings().seedData) return null;
  let raw;
  try { raw = Buffer.from(sea.getAsset("seed-data.json")).toString("utf8"); } catch { return null; }
  const date = new Date().toISOString();
  const hasData = ["employees", "projects", "crews", "houses", "clients", "vehicles", "equipment", "advances", "timesheets", "cash"].some((k) => db.table(k).length);
  if (hasData) {
    db.saveSettings({ seedData: { date, skipped: "This computer already had records." } });
    return { skipped: true };
  }
  const incoming = JSON.parse(raw.replace(/^﻿/, ""));
  db.importData(incoming?.app === "Kadro" ? incoming.data : incoming);
  db.saveSettings({ seedData: { date, source: incoming?.date || null } });
  prepareData();
  folders.buildStructure(root());
  (async () => {
    for (const t of timesheet.allPeriods().filter((x) => x.status === "closed")) {
      const full = folders.fullPath(root(), timesheetFilePath(t.period));
      if (fs.existsSync(full)) continue;
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, Buffer.from(await writeTimesheetFile(t)));
    }
    await writeCashFiles();
  })().catch((e) => console.error(`[seed data] files could not be written: ${e.message}`));
  return { employees: db.table("employees").length, projects: db.table("projects").length };
}
let seed = null;
try { seed = loadSeedData(); } catch (e) { console.error(`[seed data] could not be loaded: ${e.message}`); }

const server = app.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log("");
  console.log("  Kadro — Workforce Management · ACME ENGINEERING");
  console.log("  " + "─".repeat(46));
  console.log(`  Address      : ${url}`);
  console.log(`  Document root: ${root()}`);
  console.log(`  AI           : ${db.settings().apiKey || process.env.ANTHROPIC_API_KEY ? "on" : "off (no API key entered)"}`);
  console.log(`  Computer     : ${os.hostname()}`);
  if (seed?.employees !== undefined) console.log(`  Seed data    : loaded (${seed.employees} employees, ${seed.projects} projects)`);
  console.log("");
  console.log("  Close this window to stop.");
  console.log("");
  if (!process.env.KADRO_NO_BROWSER && process.platform === "win32") {
    exec(`start "" "${url}"`);
  }
});

server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") return stopAndWait(e.message);
  // The program is already running (double-clicked twice): show the running one in the browser.
  console.log(`  Kadro is already running, opening it in the browser: http://localhost:${PORT}`);
  if (!process.env.KADRO_NO_BROWSER && process.platform === "win32") exec(`start "" "http://localhost:${PORT}"`);
  setTimeout(() => process.exit(0), 1500);
});
