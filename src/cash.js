/**
 * Cash: income and expenses, automatic rows and reports.
 *
 * Automatic rows are regenerated from their source on every sync:
 *   Advance → every advance record, as an expense on its own date.
 *   Payment → salary, meal allowance and rent marked "paid" on the Payments screen; on the payment date, with the
 *             amount paid. Rent is split over the residents' projects. (Before October 2026 these were written when a
 *             period closed; by client decision they now only come from the paid mark.)
 * Since an advance is already a separate expense, the salary payment is the amount after advances; together they equal the earnings.
 *
 * Rules:
 *  - An automatic row corrected by hand is never overwritten again. The system's figure is kept next to it in `system`.
 *  - An automatic row deleted by hand is never generated again (cashDeleted). It can be brought back from the Cash screen.
 *  - An automatic row whose source is gone (period reopened, advance deleted) is removed.
 *    If it was corrected by hand it stays and is marked "source deleted".
 */
import * as db from "./db.js";
import * as timesheet from "./timesheet.js";
import * as payments from "./payments.js";
import { projectOf, num } from "./relations.js";

const pad = (n) => String(n).padStart(2, "0");
const round = (n) => Math.round(n * 100) / 100;
const { MONTHS } = timesheet;

function add(totals, cur, amount) {
  if (!amount) return;
  const k = cur || "EUR";
  totals[k] = round((totals[k] || 0) + amount);
}
const difference = (a, b) => {
  const out = {};
  for (const cur of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const v = round((a[cur] || 0) - (b[cur] || 0));
    if (v) out[cur] = v;
  }
  return out;
};
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Fields that make a row "corrected by hand" when edited. */
const VALUE_FIELDS = ["date", "type", "category", "description", "project", "employeeCode", "amount", "currency"];

export function changedByHand(before, after) {
  return VALUE_FIELDS.some((k) => (k === "amount"
    ? num(before[k]) !== num(after[k])
    : String(before[k] ?? "") !== String(after[k] ?? "")));
}

const isAutomatic = (r) => Boolean(r.key);

/* ------------------------------------------------------------------ */
/* Automatic rows                                                      */
/* ------------------------------------------------------------------ */

const employeeName = (code) => db.findRow("employees", (x) => x.code === code)?.name || code;

/** The project of an advance: from the crew of that day if the period is open, otherwise the person's current project. */
function advanceProject(a, existing) {
  const t = timesheet.find(timesheet.periodOfDate(a.date));
  const r = t?.rows.find((x) => x.employeeCode === a.employeeCode);
  if (r) return t.crews[r.crewDays[a.date]]?.project || r.project || "";
  // A row written before its period was opened keeps its project (the person may have moved to another project since).
  if (existing?.system && existing.system.employeeCode === a.employeeCode) return existing.system.project || "";
  const e = db.findRow("employees", (x) => x.code === a.employeeCode);
  return e ? projectOf(e) : "";
}

/** The automatic rows the sources call for: key → row. */
function targetRows(existing) {
  const out = new Map();
  const put = (key, r) => {
    if (!(num(r.amount) > 0)) return;
    out.set(key, { type: "Expense", employeeCode: "", project: "", ...r, amount: round(r.amount) });
  };

  for (const a of db.table("advances")) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || "")) continue;
    const key = `advance:${a._id}`;
    put(key, {
      date: a.date, category: "Advance", source: "Advance",
      description: `Advance — ${employeeName(a.employeeCode)}${a.description ? ` · ${a.description}` : ""}`,
      employeeCode: a.employeeCode, project: advanceProject(a, existing.get(key)),
      amount: num(a.amount), currency: a.currency || "EUR",
    });
  }

  // Salary, meals and rent: items marked "paid" on the Payments screen, as expenses on the payment date.
  for (const r of payments.cashRows()) put(r.key, r);
  return out;
}

/** Syncs the automatic rows with their sources. Returns: { added, updated, deleted } */
export function sync() {
  const cash = db.table("cash");
  const existing = new Map(cash.filter(isAutomatic).map((r) => [r.key, r]));
  const target = targetRows(existing);
  const deletedByHand = new Set(db.table("cashDeleted").map((x) => x.key));
  const report = { added: 0, updated: 0, deleted: 0 };
  let changed = false;
  const now = new Date().toISOString();

  for (const r of [...cash]) {
    if (!isAutomatic(r) || (target.has(r.key) && !deletedByHand.has(r.key))) continue;
    if (r.editedByHand) {
      if (!r.system?.deleted) { r.system = { ...(r.system || {}), deleted: true }; changed = true; }
      continue;
    }
    cash.splice(cash.indexOf(r), 1);
    report.deleted += 1; changed = true;
  }

  for (const [key, t] of target) {
    if (deletedByHand.has(key)) continue;
    const system = { date: t.date, amount: t.amount, currency: t.currency, project: t.project, employeeCode: t.employeeCode };
    const r = existing.get(key);
    if (!r) {
      cash.push({ _id: db.newId(), _created: now, ...t, recurring: "No", key, editedByHand: false, system });
      report.added += 1; changed = true;
    } else if (r.editedByHand) {
      if (JSON.stringify(r.system) !== JSON.stringify(system)) { r.system = system; changed = true; }
    } else if (changedByHand(r, t) || r.source !== t.source || JSON.stringify(r.system) !== JSON.stringify(system)) {
      Object.assign(r, t, { system, _updated: now });
      report.updated += 1; changed = true;
    }
  }
  if (changed) db.save();
  return report;
}

/** When an automatic row is deleted by hand: a marker so the system never generates it again. */
export function onDelete(r) {
  if (!isAutomatic(r)) return null;
  db.table("cashDeleted").push({
    key: r.key, date: r.date, description: r.description, amount: r.amount, currency: r.currency,
    deletedAt: new Date().toISOString(), user: db.settings().user,
  });
  return "Automatic row deleted; the system will not write it again. You can bring it back from the Cash screen.";
}

/** Brings back the automatic rows deleted by hand in a month. */
export function restoreMonth(monthCode) {
  const list = db.table("cashDeleted");
  const keep = list.filter((x) => !String(x.date || "").startsWith(monthCode));
  const restored = list.length - keep.length;
  list.splice(0, list.length, ...keep);
  db.save();
  return { restored, ...sync() };
}

/** Hands an automatic row corrected by hand back to the system's calculation. */
export function releaseToSystem(id) {
  const r = db.findRow("cash", (x) => x._id === id);
  if (!r) throw new Error("Cash row not found.");
  if (!isAutomatic(r)) throw new Error("This row was entered by hand; there is no system figure.");
  r.editedByHand = false;
  db.save();
  return sync();
}

/* ------------------------------------------------------------------ */
/* Summary and reports                                                 */
/* ------------------------------------------------------------------ */

const projectName = (code) => (code ? db.findRow("projects", (x) => x.code === code)?.name || code : "No project");

/** Summary of the rows in [from, to]; the carry-over is the net of every row before `from`. */
function summarize(rows, from, to) {
  const carry = {}, income = {}, expense = {};
  const categories = new Map(), projects = new Map();
  let count = 0;
  for (const r of rows) {
    const d = r.date || "";
    const amount = num(r.amount), cur = r.currency || "EUR";
    const sign = r.type === "Income" ? 1 : -1;
    if (d < from) { add(carry, cur, sign * amount); continue; }
    if (d > to) continue;
    count += 1;
    add(r.type === "Income" ? income : expense, cur, amount);
    const ck = `${r.type}|${r.category || "Uncategorised"}`;
    if (!categories.has(ck)) categories.set(ck, { type: r.type, category: r.category || "Uncategorised", amount: {} });
    add(categories.get(ck).amount, cur, amount);
    const pk = r.project || "";
    if (!projects.has(pk)) projects.set(pk, { project: pk, name: projectName(pk), income: {}, expense: {} });
    add(projects.get(pk)[r.type === "Income" ? "income" : "expense"], cur, amount);
  }
  const net = difference(income, expense);
  const balance = { ...carry };
  for (const [cur, v] of Object.entries(net)) add(balance, cur, v);
  for (const cur of Object.keys(balance)) if (!balance[cur]) delete balance[cur];
  return {
    carry, income, expense, net, balance, count,
    categories: [...categories.values()].sort((a, b) => a.type.localeCompare(b.type) || a.category.localeCompare(b.category)),
    projects: [...projects.values()].map((x) => ({ ...x, net: difference(x.income, x.expense) })).sort((a, b) => a.name.localeCompare(b.name, "tr")),
  };
}

const parseMonth = (m) => {
  const x = /^(\d{4})-(\d{2})$/.exec(String(m || ""));
  if (!x || +x[2] < 1 || +x[2] > 12) throw new Error(`Invalid month: "${m}". Expected format: 2026-10`);
  return { year: +x[1], month: +x[2] };
};
export const monthName = (m) => { const a = parseMonth(m); return `${MONTHS[a.month - 1]} ${a.year}`; };
const adjacentMonth = (m, dir) => {
  const a = parseMonth(m);
  const d = new Date(Date.UTC(a.year, a.month - 1 + dir, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
export const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

/** Months with movements. */
export const months = () => [...new Set(db.table("cash").map((r) => String(r.date || "").slice(0, 7)).filter((x) => /^\d{4}-\d{2}$/.test(x)))].sort();

/** A whole month, for the Cash screen and the monthly file. */
export function month(monthCode) {
  const a = parseMonth(monthCode);
  const from = `${monthCode}-01`, to = `${monthCode}-${pad(lastDay(a.year, a.month))}`;
  const all = db.table("cash");
  const rows = all.filter((r) => r.date >= from && r.date <= to)
    .sort((x, y) => x.date.localeCompare(y.date) || (x.type === "Income" ? -1 : 1) - (y.type === "Income" ? -1 : 1));
  return {
    month: monthCode, name: monthName(monthCode), from, to,
    previous: adjacentMonth(monthCode, -1), next: adjacentMonth(monthCode, 1), current: currentMonth(),
    rows,
    summary: summarize(all, from, to),
    deleted: db.table("cashDeleted").filter((x) => String(x.date || "").startsWith(monthCode)),
  };
}

const REPORT_TYPES = ["period", "month", "quarter", "half", "year", "project"];

function buckets(type, year, rows) {
  const out = [];
  const range = (m1, m2) => [`${year}-${pad(m1)}-01`, `${year}-${pad(m2)}-${pad(lastDay(year, m2))}`];
  if (type === "period") {
    for (let m = 1; m <= 12; m += 1) {
      for (const half of [1, 2]) {
        const p = timesheet.parsePeriod(`${year}-${pad(m)}-${half}`);
        out.push({ key: p.period, name: `${MONTHS[m - 1]} ${half === 1 ? "1st" : "2nd"} half`, from: p.days[0], to: p.days.at(-1) });
      }
    }
  } else if (type === "month") {
    for (let m = 1; m <= 12; m += 1) { const [from, to] = range(m, m); out.push({ key: `${year}-${pad(m)}`, name: MONTHS[m - 1], from, to }); }
  } else if (type === "quarter") {
    for (let q = 1; q <= 4; q += 1) {
      const [from, to] = range(q * 3 - 2, q * 3);
      out.push({ key: `${year}-Q${q}`, name: `Q${q} (${MONTHS[q * 3 - 3]}–${MONTHS[q * 3 - 1]})`, from, to });
    }
  } else if (type === "half") {
    out.push({ key: `${year}-H1`, name: "H1 (January–June)", from: `${year}-01-01`, to: `${year}-06-30` });
    out.push({ key: `${year}-H2`, name: "H2 (July–December)", from: `${year}-07-01`, to: `${year}-12-31` });
  } else if (type === "year") {
    const years = rows.map((r) => +String(r.date).slice(0, 4)).filter(Boolean);
    const first = Math.min(new Date().getFullYear(), ...years), last = Math.max(new Date().getFullYear(), ...years);
    for (let y = first; y <= last; y += 1) out.push({ key: String(y), name: String(y), from: `${y}-01-01`, to: `${y}-12-31` });
  }
  return out;
}

/**
 * Cash report. type: period | month | quarter | half | year | project. project: "" all, "-" no project, or a code.
 * Each bucket: carry-over, income, expense, net, balance, category and project breakdown. Amounts per currency.
 */
export function report({ type = "month", year, project = "" } = {}) {
  if (!REPORT_TYPES.includes(type)) throw new Error(`Invalid report type: ${type}`);
  year = Number(year) || new Date().getFullYear();
  const all = db.table("cash");
  const rows = project ? all.filter((r) => (r.project || "-") === project) : all;
  const yearFrom = `${year}-01-01`, yearTo = `${year}-12-31`;

  let list;
  if (type === "project") {
    const codes = [...new Set(rows.filter((r) => r.date >= yearFrom && r.date <= yearTo).map((r) => r.project || ""))];
    list = codes.map((k) => ({
      key: k || "-", name: projectName(k), project: k,
      ...summarize(rows.filter((r) => (r.project || "") === k), yearFrom, yearTo),
    })).sort((a, b) => (a.project ? 0 : 1) - (b.project ? 0 : 1) || a.name.localeCompare(b.name, "tr"));
  } else {
    list = buckets(type, year, rows).map((b) => ({ ...b, ...summarize(rows, b.from, b.to) }));
  }

  const years = [...new Set([new Date().getFullYear(), ...all.map((r) => +String(r.date).slice(0, 4)).filter(Boolean)])].sort();
  const total = type === "year" && list.length
    ? summarize(rows, list[0].from, list.at(-1).to)
    : summarize(rows, yearFrom, yearTo);
  return {
    type, year, project, projectName: project ? projectName(project === "-" ? "" : project) : "All projects",
    years, buckets: list, total,
  };
}
