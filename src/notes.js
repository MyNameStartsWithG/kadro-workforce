/**
 * Per-person notes: the Notes panel on the employee page. Each note has a title and a text and is saved,
 * edited and deleted on its own. These are manager notes: they never reach the employee's page,
 * the voice assistant or Excel.
 */
import * as db from "./db.js";

const records = () => { const d = db.all(); d.notes = d.notes || []; return d.notes; };

/** An empty title is taken from the first line of the text. */
function prepare({ title, text }) {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) throw new Error("A note cannot be empty.");
  const h = String(title ?? "").trim() || t.split("\n")[0].slice(0, 60);
  if (h.length > 120) throw new Error("A note title can be at most 120 characters.");
  return { title: h, text: t };
}

export const list = (employeeCode) => records()
  .filter((n) => n.employeeCode === employeeCode)
  .sort((a, b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));

export function add(employeeCode, fields) {
  if (!db.findRow("employees", (x) => x.code === employeeCode)) throw new Error(`No employee with code "${employeeCode}".`);
  const n = { _id: db.newId(), employeeCode, ...prepare(fields), created: new Date().toISOString(), user: db.settings().user };
  records().push(n);
  db.save();
  return n;
}

export function update(id, fields) {
  const n = records().find((x) => x._id === id);
  if (!n) throw new Error("Note not found.");
  Object.assign(n, prepare(fields), { updated: new Date().toISOString() });
  db.save();
  return n;
}

export function remove(id) {
  const d = db.all();
  const before = records().length;
  d.notes = records().filter((x) => x._id !== id);
  if (d.notes.length === before) throw new Error("Note not found.");
  db.save();
}

/** When an employee is deleted, their notes go too. */
export function removeForEmployee(employeeCode) {
  db.all().notes = records().filter((x) => x.employeeCode !== employeeCode);
}

/**
 * The old single-line "notes" field is moved into the panel once, as a "General note". The original field is
 * kept; the person is marked with `notesMigrated` so the note is not moved again even if it is deleted later.
 */
export function migrateOldNotes() {
  let changed = false;
  for (const p of db.table("employees")) {
    if (p.notesMigrated) continue;
    const text = String(p.notes || "").trim();
    if (text) records().push({ _id: db.newId(), employeeCode: p.code, title: "General note", text, created: p._created || new Date().toISOString(), user: "migrated" });
    p.notesMigrated = true;
    changed = true;
  }
  if (changed) db.save();
}
