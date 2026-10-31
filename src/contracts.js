/**
 * Employment periods (contracts): between which dates, on which project a person works.
 *
 * Type "Work":  the range the person is at work. An empty end means open-ended; otherwise it is the leaving date
 *               and can be entered in advance.
 * Type "Leave": a long leave inside employment (e.g. a trip home). Only sets the status to "On leave"; no effect on pay.
 *
 * For a person with employment periods:
 *  - The status is computed from today's date (Active / On leave / Left); it cannot be changed by hand.
 *  - The person is included in a timesheet period if a work range overlaps those 15 days. Days outside the ranges
 *    (rule 2+) count for nothing, like days before the start date: no hours, pay share, meals, rent or deductions.
 *  - The ranges are copied into open timesheet periods as `row.workRanges` and refreshed when they change.
 *    Closed periods stay as they were when they closed.
 * For a person without employment periods everything works as before, from the status entered by hand.
 */
import * as db from "./db.js";

export const TYPES = ["Work", "Leave"];

const pad = (n) => String(n).padStart(2, "0");
const todayText = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isDate = (t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t || ""));
const typeOf = (r) => (r.type === "Leave" ? "Leave" : "Work");

/** A person's records, sorted by start date. */
export const recordsOf = (code) => db.table("contracts")
  .filter((r) => r.employeeCode === code && isDate(r.start))
  .sort((a, b) => a.start.localeCompare(b.start));

/** A person's work ranges: [[start, end | ""], …]. null if there is no work record (no contract). */
export function ranges(code) {
  const r = recordsOf(code).filter((x) => typeOf(x) === "Work");
  return r.length ? r.map((x) => [x.start, isDate(x.end) ? x.end : ""]) : null;
}

export const within = (rs, day) => rs.some(([s, e]) => day >= s && (!e || day <= e));
export const overlaps = (rs, from, to) => rs.some(([s, e]) => s <= to && (!e || e >= from));

/** A person's status on a given day. null if there is no work record (status is set by hand). */
export function computeStatus(code, day = todayText()) {
  const records = recordsOf(code);
  const rs = ranges(code);
  if (!rs) return null;
  if (records.some((r) => typeOf(r) === "Leave" && day >= r.start && (!isDate(r.end) || day <= r.end))) return "On leave";
  if (within(rs, day)) return "Active";
  // Someone hired for a future date also counts as active; they enter timesheets from their start day.
  return rs.some(([s]) => s > day) ? "Active" : "Left";
}

/** Today's state of one record (shown in the table and on the employee page). */
export function recordStatus(r, day = todayText()) {
  if (!isDate(r.start)) return "";
  if (r.start > day) return "Not started";
  if (isDate(r.end) && r.end < day) return "Ended";
  return typeOf(r) === "Leave" ? "On leave" : "Ongoing";
}

/** Before saving: the fields, and overlaps with the same person's other records. */
export function validate(row) {
  if (!db.findRow("employees", (x) => x.code === row.employeeCode)) {
    throw new Error(row.employeeCode ? `No employee with code "${row.employeeCode}".` : "Choose an employee.");
  }
  row.type = typeOf(row);
  if (!isDate(row.start)) throw new Error("Invalid start date.");
  if (row.end && !isDate(row.end)) throw new Error("Invalid end date.");
  if (row.end && row.end < row.start) throw new Error("The end date cannot be before the start date.");
  if (row.project && !db.findRow("projects", (x) => x.code === row.project)) throw new Error(`No project with code "${row.project}".`);
  const last = (r) => (isDate(r.end) ? r.end : "9999-12-31");
  const clash = recordsOf(row.employeeCode)
    .find((r) => r._id !== row._id && typeOf(r) === row.type && r.start <= last(row) && last(r) >= row.start);
  if (clash) {
    const what = row.type === "Leave" ? "leave" : "employment period";
    throw new Error(`These dates overlap another ${what} record of this person (${clash.start} – ${clash.end || "open-ended"}). ` +
      "If the project changes, end the previous period one day earlier.");
  }
}

/** Does the person's status come from employment periods (the status field is locked on the employee page)? */
export const isStatusAutomatic = (code) => Boolean(ranges(code));

/**
 * Updates employee statuses for today and refreshes the range copies in open timesheet periods.
 * Runs at startup, when records change and every hour; safe to run repeatedly. Returns: number of changes.
 */
export function sync(day = todayText()) {
  let changed = 0;
  for (const p of db.table("employees")) {
    const s = computeStatus(p.code, day);
    if (s && p.status !== s) { p.status = s; changed += 1; }
  }
  for (const t of db.table("timesheets")) {
    if (t.status === "closed" || (t.rule || 1) < 2) continue;
    for (const r of t.rows) {
      const rs = ranges(r.employeeCode);
      if (JSON.stringify(rs) === JSON.stringify(r.workRanges ?? null)) continue;
      if (rs) r.workRanges = rs; else delete r.workRanges;
      changed += 1;
    }
  }
  if (changed) db.save();
  return changed;
}

/** Expiry warning: an employment period ending soon. Past periods, leave and periods already followed by another give none. */
export function shouldWarn(r, daysLeft) {
  if (typeOf(r) !== "Work" || daysLeft < 0) return false;
  return !recordsOf(r.employeeCode).some((x) => x._id !== r._id && typeOf(x) === "Work" && x.start > r.start);
}
