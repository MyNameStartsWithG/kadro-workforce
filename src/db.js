/**
 * Minimal JSON data store. Everything lives in data/db.json —
 * copying that one file is a complete backup.
 */
import fs from "node:fs";
import path from "node:path";

const EMPTY = {
  employees: [], equipment: [], crews: [], vehicles: [], projects: [], houses: [], clients: [], documents: [],
  advances: [], timesheets: [],
  notes: [],                // per-person notes (Notes panel on the employee page, see notes.js)
  contracts: [],            // employment periods: person × project × start–end (see contracts.js)
  cash: [],
  cashDeleted: [],          // automatic cash rows deleted by hand: the system never generates them again
  forecast: {},             // forecast cells corrected by hand
  payments: [],             // items marked "paid" on the Payments screen (salary, meal allowance, rent)
  assistantLog: [],         // actions approved through voice commands (with undo information)
  settings: {
    documentRoot: "",
    apiKey: "",
    aiMode: "hybrid",         // hybrid | aiOnly | rulesOnly
    user: "Manager",
    threshold: 0.72,          // below this rule confidence, Claude is asked
  },
};

let filePath = null;
let data = null;

export function init(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  filePath = path.join(dataDir, "db.json");
  if (fs.existsSync(filePath)) {
    try {
      data = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
      data.settings = { ...EMPTY.settings, ...(data.settings || {}) };
    } catch (e) {
      const copy = `${filePath}.corrupt-${Date.now()}`;
      fs.copyFileSync(filePath, copy);
      console.error(`[db] db.json could not be read, saved a copy: ${copy}`);
      data = structuredClone(EMPTY);
    }
  } else {
    data = structuredClone(EMPTY);
    save();
  }
  return data;
}

/** Data for a backup file: API keys never leave this computer. */
export function exportData() {
  const copy = structuredClone(data);
  delete copy.settings.apiKey;
  delete copy.settings.assistantKey;
  return copy;
}

/**
 * Restores from a backup. The current db.json is first copied to data/backups.
 * Settings that belong to this computer (document root, API keys) are kept.
 * Returns: the path of the backup that was taken.
 */
export function importData(incoming) {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("The backup file could not be read.");
  const tables = Object.keys(EMPTY).filter((k) => Array.isArray(EMPTY[k]));
  if (!tables.some((k) => Array.isArray(incoming[k]))) throw new Error("This file is not a Kadro backup.");
  for (const k of tables) {
    if (k in incoming && !Array.isArray(incoming[k])) throw new Error(`The "${k}" section of the backup is corrupt.`);
  }
  if ("forecast" in incoming && (typeof incoming.forecast !== "object" || Array.isArray(incoming.forecast))) {
    throw new Error('The "forecast" section of the backup is corrupt.');
  }

  const previous = backup("before-import");

  const thisComputer = {
    documentRoot: data.settings.documentRoot, apiKey: data.settings.apiKey,
    assistantUrl: data.settings.assistantUrl || "", assistantKey: data.settings.assistantKey || "",
  };
  data = { ...structuredClone(EMPTY), ...structuredClone(incoming) };
  data.settings = { ...EMPTY.settings, ...(incoming.settings || {}), ...thisComputer };
  save();
  return previous;
}

/** Copies db.json to data/backups. Returns: the path of the copy. */
export function backup(label) {
  const dir = path.join(path.dirname(filePath), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  const target = path.join(dir, `db-${stamp}-${label}.json`);
  fs.copyFileSync(filePath, target);
  return target;
}

/**
 * Deletes every record; settings (document root, API keys, rates…) stay. A backup is taken first.
 * Leaves a marker so that seed data embedded in the exe is not loaded again.
 * Returns: the path of the backup.
 */
export function reset() {
  const copy = backup("before-reset");
  const settings = data.settings;
  data = structuredClone(EMPTY);
  data.settings = { ...EMPTY.settings, ...settings, seedData: { date: new Date().toISOString(), skipped: "Records were reset." } };
  save();
  return copy;
}

export function all() { return data; }
export function table(name) { return data[name] || []; }
export function settings() { return data.settings; }

export function saveSettings(changes) {
  data.settings = { ...data.settings, ...changes };
  save();
  return data.settings;
}

export function save() {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

export function newId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function insertRow(tableName, row) {
  const r = { _id: newId(), _created: new Date().toISOString(), ...row };
  data[tableName].push(r);
  save();
  return r;
}

export function updateRow(tableName, id, fields) {
  const r = data[tableName].find((x) => x._id === id);
  if (!r) return null;
  Object.assign(r, fields, { _updated: new Date().toISOString() });
  save();
  return r;
}

export function deleteRow(tableName, id) {
  const i = data[tableName].findIndex((x) => x._id === id);
  if (i < 0) return false;
  data[tableName].splice(i, 1);
  save();
  return true;
}

export function findRow(tableName, match) {
  return data[tableName].find(match) || null;
}
