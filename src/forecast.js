/**
 * Forecast table: columns are 15-day periods, rows are cost items.
 *
 * Past periods (their days are over or their timesheet is closed) show the ACTUAL value:
 *   Salary, overtime, meals → from the timesheet (accrued earnings; the amount goes to the project of the day's crew)
 *   Rent, other expenses, income → from cash
 * Future periods show an ESTIMATE:
 *   Salary   → current pay of active employees (monthly: half the salary; hourly: workdays × normal hours × rate).
 *              A person with employment periods only counts between those dates (monthly: daily salary × days).
 *   Overtime → the person's average overtime pay over the last 4 closed periods
 *   Meals    → crew meal amount × people in the crew × days in the period
 *   Rent     → house rents, in the 1st period of the month; to each person's project by per-person share
 *   Other    → future-dated manual expenses in cash + expenses marked "repeats monthly"
 *   Income   → the same, income side
 * Estimate cells can be corrected by hand (db.forecast). A correction applies to the project view it was made in.
 * No currency conversion: each currency is calculated separately.
 */
import * as db from "./db.js";
import * as timesheet from "./timesheet.js";
import * as contracts from "./contracts.js";
import { projectOf, houseCalc, houseResidents, crewMembers, monthlyRent, num } from "./relations.js";

const pad = (n) => String(n).padStart(2, "0");
const round = (n) => Math.round(n * 100) / 100;
const todayText = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const CURRENCY_ORDER = ["EUR", "TRY", "RSD"];
const AUTO_CATEGORIES = new Set(["Salary", "Advance", "Meals", "Rent"]);
const OVERTIME_SAMPLES = 4;

export const ROWS = [
  { key: "salary", name: "Salaries", kind: "expense",
    actual: "Timesheet earnings (excluding overtime, after deductions)",
    estimate: "Current pay of active employees. Monthly: half the salary. Hourly: workdays × normal hours × rate. People with employment periods only between those dates" },
  { key: "overtime", name: "Overtime", kind: "expense",
    actual: "Overtime pay in the timesheet", estimate: `The person's average overtime pay over the last ${OVERTIME_SAMPLES} closed periods` },
  { key: "meals", name: "Meals", kind: "expense",
    actual: "Meal allowance in the timesheet (paid in advance for the period's days)", estimate: "Crew meal amount × people in the crew × days in the period (paid in advance)" },
  { key: "rent", name: "House rents", kind: "expense",
    actual: "Rent expenses in cash (rents marked paid)",
    estimate: "That month's rent of the houses (weekly/daily rent by the days in the month), in the 1st half. Split over projects by per-person share" },
  { key: "other", name: "Other expenses", kind: "expense",
    actual: "Other expenses in cash (excluding salary, advance, meals, rent)", estimate: "Future-dated manual expenses in cash and expenses marked \"repeats monthly\"" },
  { key: "income", name: "Income", kind: "income",
    actual: "Income in cash", estimate: "Future-dated income in cash and income marked \"repeats monthly\"" },
];
const ROW_KEYS = new Set(ROWS.map((r) => r.key));

const manualKey = (period, row, cur, project) => `${period}|${row}|${cur}|${project || "*"}`;
const manuals = () => { const d = db.all(); d.forecast = d.forecast || {}; return d.forecast; };

/** Corrects an estimate cell by hand; an empty value removes the correction. */
export function writeCell({ period, row, currency, project, value }) {
  const p = timesheet.parsePeriod(period);
  if (!ROW_KEYS.has(row)) throw new Error(`Unknown row: ${row}`);
  if (!CURRENCY_ORDER.includes(currency)) throw new Error(`Invalid currency: ${currency}`);
  if (isActual(p)) throw new Error(`${timesheet.periodName(p.period)} is a completed period; only estimates can be corrected.`);
  const key = manualKey(p.period, row, currency, project);
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) delete manuals()[key];
  else {
    // Accepts "1,500.25" (thousands separator) as well as "1500.25" and "1500,25".
    const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".");
    const n = Number(plain);
    if (!/^\d+(\.\d+)?$/.test(plain) || !Number.isFinite(n)) throw new Error(`"${value}" is not a valid amount.`);
    manuals()[key] = { value: round(n), date: new Date().toISOString(), user: db.settings().user };
  }
  db.save();
}

function isActual(p, today = todayText()) {
  return timesheet.find(p.period)?.status === "closed" || p.days.at(-1) < today;
}

/** Day types of a period: from its timesheet if opened, otherwise the default (Sat overtime, Sun holiday). */
function dayTypes(p) {
  const t = timesheet.find(p.period);
  return p.days.map((d) => t?.days[d] || timesheet.defaultDayType(d));
}

/** A person's average overtime pay over the last closed periods: { currency, amount, samples } */
function overtimeAverages() {
  const closed = timesheet.allPeriods().filter((t) => t.status === "closed");
  const out = new Map();
  for (const t of closed.reverse()) {
    for (const r of t.rows) {
      const o = out.get(r.employeeCode) || { total: 0, samples: 0, currency: null };
      if (o.samples >= OVERTIME_SAMPLES) continue;
      const h = timesheet.calcRow(t, r);
      o.total += h.overtimePay;
      o.samples += 1; o.currency = o.currency || h.currency;
      out.set(r.employeeCode, o);
    }
  }
  for (const o of out.values()) o.amount = o.samples ? round(o.total / o.samples) : 0;
  return out;
}

/** Normal hours per day of the latest timesheet (8 if there is none). */
function normalHours() {
  const last = timesheet.allPeriods().at(-1);
  return num(last?.settings?.normalHours) || timesheet.DEFAULT_SETTINGS.normalHours;
}

/** Manual cash rows marked "repeats monthly": the latest record of the same item is the source of the series. */
function recurringSeries() {
  const series = new Map();
  for (const r of db.table("cash")) {
    if (r.recurring !== "Yes" || (r.source && r.source !== "Manual") || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) continue;
    const key = [r.type, r.category, (r.description || "").trim().toLocaleLowerCase("tr"), r.project, r.currency].join("|");
    const s = series.get(key);
    if (!s) series.set(key, { source: r, months: new Set([r.date.slice(0, 7)]) });
    else {
      s.months.add(r.date.slice(0, 7));
      if (r.date > s.source.date) s.source = r;
    }
  }
  return [...series.values()];
}

/**
 * Calculates the table. from: first period ("2026-07-1"), count: number of columns, project: "" all, "-" no project, or a code.
 */
export function calc({ from, count = 24, project = "" } = {}) {
  count = Math.max(1, Math.min(72, Number(count) || 24));
  const today = todayText();
  const current = timesheet.currentPeriod();
  from = from ? timesheet.parsePeriod(from).period : (() => { let p = current; for (let i = 0; i < 4; i += 1) p = timesheet.adjacentPeriod(p, -1); return p; })();

  const periods = [];
  for (let i = 0, p = from; i < count; i += 1, p = timesheet.adjacentPeriod(p, 1)) periods.push(p);

  // values[key][period][cur] = { system, detail: Map(label → amount) }
  const values = Object.fromEntries(ROWS.map((r) => [r.key, {}]));
  const projectMatches = (code) => !project || (code || "-") === project;
  const put = (key, period, cur, amount, projectCode, label) => {
    if (!amount || !projectMatches(projectCode)) return;
    const c = ((values[key][period] ||= {})[cur || "EUR"] ||= { system: 0, detail: new Map() });
    c.system += amount;
    c.detail.set(label, (c.detail.get(label) || 0) + amount);
  };

  const cash = db.table("cash").filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date || ""));
  const employees = db.table("employees");
  const nh = normalHours();
  const otAverages = overtimeAverages();
  const series = recurringSeries();
  const columns = [];

  for (const period of periods) {
    const p = timesheet.parsePeriod(period);
    const last = p.days.at(-1), first = p.days[0];
    const t = timesheet.find(period);
    const actual = isActual(p, today);
    const monthCode = `${p.year}-${pad(p.month)}`;
    columns.push({
      period, name: timesheet.periodName(period), month: `${timesheet.MONTHS[p.month - 1]} ${p.year}`, half: p.half,
      range: `${p.from}–${p.to}`, state: actual ? "actual" : "estimate", current: period === current,
      timesheet: t ? t.status : null,
    });
    const periodCash = cash.filter((r) => r.date >= first && r.date <= last);

    if (actual) {
      // Timesheet: earnings, overtime and meals, spread over the project of each day's crew.
      for (const r of t?.rows || []) {
        const h = timesheet.calcRow(t, r, { today });
        const totalNormal = h.daily.reduce((a, d) => a + d.n, 0);
        for (const d of h.daily) {
          const pr = t.crews[d.crew]?.project || r.project;
          if (totalNormal) put("salary", period, h.currency, h.baseNet * (d.n / totalNormal), pr, r.name);
          put("overtime", period, h.currency, d.m * h.overtimeUnit, pr, r.name);
          if (d.meals) put("meals", period, t.crews[d.crew]?.mealCurrency, d.meals, pr, `${d.crew} ${t.crews[d.crew]?.name || ""}`.trim());
        }
        if (!totalNormal) put("salary", period, h.currency, h.baseNet, r.project, r.name);
      }
      for (const r of periodCash) {
        const a = num(r.amount), label = r.description || r.category || "—";
        if (r.type === "Income") put("income", period, r.currency, a, r.project, label);
        else if (r.category === "Rent") put("rent", period, r.currency, a, r.project, label);
        else if (!AUTO_CATEGORIES.has(r.category)) put("other", period, r.currency, a, r.project, label);
      }
      continue;
    }

    // --- estimate ---
    const types = dayTypes(p);
    const normalDays = types.filter((x) => x === "normal").length;
    const periodDays = p.days.length;

    // Days the person is at work in this period: from employment periods if any, otherwise status and start date (whole period).
    const daysAtWork = (e) => {
      const rs = contracts.ranges(e.code);
      if (rs) return p.days.filter((d) => contracts.within(rs, d));
      return e.status === "Left" || (e.startDate && e.startDate > last) ? [] : p.days;
    };

    for (const e of employees) {
      const days = daysAtWork(e);
      if (!days.length) continue;
      const full = days.length === periodDays;
      const pay = num(e.pay), pr = projectOf(e), cur = e.currency || "EUR";
      const label = full ? e.name : `${e.name} · ${days.length} days`;
      const normal = full ? normalDays : p.days.filter((d, i) => types[i] === "normal" && days.includes(d)).length;
      if (e.payType === "Monthly") put("salary", period, cur, full ? pay / 2 : pay * 12 / 365 * days.length, pr, label);
      else if (e.payType === "Hourly") put("salary", period, cur, normal * nh * pay, pr, label);
      const o = otAverages.get(e.code);
      if (o?.amount) put("overtime", period, o.currency, o.amount * days.length / periodDays, pr, label);
    }

    for (const c of db.table("crews")) {
      if (c.status === "Inactive" || !(num(c.mealDaily) > 0)) continue;
      const dayCounts = crewMembers(c.code).map((e) => daysAtWork(e).length).filter(Boolean);
      const people = dayCounts.length, personDays = dayCounts.reduce((a, n) => a + n, 0);
      const label = personDays === people * periodDays ? `${people} people × ${periodDays} days` : `${people} people · ${personDays} person-days`;
      put("meals", period, c.mealCurrency || "EUR", num(c.mealDaily) * personDays, c.project, `${c.code} ${c.name} · ${label}`);
    }

    if (p.half === 1) {
      for (const h of db.table("houses")) {
        if (h.status === "Vacated") continue;
        const k = houseCalc(h);
        const monthRent = monthlyRent(h.rent, h.rentPeriod, new Date(Date.UTC(p.year, p.month, 0)).getUTCDate());
        if (!(monthRent > 0)) continue;
        const residents = houseResidents(h.code);
        if (!residents.length) put("rent", period, k.currency, monthRent, h.project, `${h.code} ${h.name} · empty`);
        for (const r of residents) put("rent", period, k.currency, monthRent / residents.length, projectOf(r), `${h.code} ${h.name}`);
      }
    }

    // Manual cash rows entered with a future date in this period.
    for (const r of periodCash) {
      if (r.source && r.source !== "Manual") continue;
      put(r.type === "Income" ? "income" : "other", period, r.currency, num(r.amount), r.project, r.description || r.category || "—");
    }
    // Monthly repeats: in the months after the source's month, on the same day (the last day if the month is shorter).
    for (const s of series) {
      const r = s.source;
      if (monthCode <= r.date.slice(0, 7) || s.months.has(monthCode)) continue;
      const day = Math.min(+r.date.slice(8), new Date(Date.UTC(p.year, p.month, 0)).getUTCDate());
      if (day < p.from || day > p.to) continue;
      put(r.type === "Income" ? "income" : "other", period, r.currency, num(r.amount), r.project, `${r.description || r.category || "—"} (monthly)`);
    }
  }

  // Manual corrections and final values.
  const manual = manuals();
  const usedCurrencies = new Set();
  const out = {};
  for (const row of ROWS) {
    out[row.key] = {};
    for (const col of columns) {
      const cells = values[row.key][col.period] || {};
      const curs = new Set(Object.keys(cells));
      if (col.state === "estimate") {
        for (const cur of CURRENCY_ORDER) if (manual[manualKey(col.period, row.key, cur, project)]) curs.add(cur);
      }
      for (const cur of curs) {
        const c = cells[cur];
        const system = round(c?.system || 0);
        const m = col.state === "estimate" ? manual[manualKey(col.period, row.key, cur, project)] : null;
        const value = m ? m.value : system;
        if (!value && !m) continue;
        usedCurrencies.add(cur);
        (out[row.key][col.period] ||= {})[cur] = {
          value, system, manual: Boolean(m),
          detail: c ? [...c.detail].map(([name, a]) => ({ name, amount: round(a) })).filter((x) => x.amount).sort((a, b) => b.amount - a.amount) : [],
        };
      }
    }
  }

  // Totals: expense, net and cash balance (actual columns: the balance in cash; estimates: previous + net).
  const currencies = CURRENCY_ORDER.filter((c) => usedCurrencies.has(c));
  const projectCash = cash.filter((r) => projectMatches(r.project));
  const cashBalance = (until, cur) => round(projectCash.filter((r) => r.date <= until && (r.currency || "EUR") === cur)
    .reduce((a, r) => a + (r.type === "Income" ? 1 : -1) * num(r.amount), 0));
  for (const r of cash) { const cur = r.currency || "EUR"; if (projectMatches(r.project) && !currencies.includes(cur) && CURRENCY_ORDER.includes(cur)) currencies.push(cur); }
  currencies.sort((a, b) => CURRENCY_ORDER.indexOf(a) - CURRENCY_ORDER.indexOf(b));
  if (!currencies.length) currencies.push("EUR");

  const totals = { expense: {}, income: {}, net: {}, balance: {} };
  const previous = {};
  for (const cur of currencies) previous[cur] = cashBalance(timesheet.parsePeriod(timesheet.adjacentPeriod(from, -1)).days.at(-1), cur);
  for (const col of columns) {
    for (const t of Object.values(totals)) t[col.period] = {};
    for (const cur of currencies) {
      const val = (k) => out[k][col.period]?.[cur]?.value || 0;
      const expense = round(ROWS.filter((r) => r.kind === "expense").reduce((a, r) => a + val(r.key), 0));
      const income = round(val("income"));
      const net = round(income - expense);
      const balance = col.state === "actual" ? cashBalance(timesheet.parsePeriod(col.period).days.at(-1), cur) : round(previous[cur] + net);
      previous[cur] = balance;
      Object.assign(totals.expense[col.period], { [cur]: expense });
      Object.assign(totals.income[col.period], { [cur]: income });
      Object.assign(totals.net[col.period], { [cur]: net });
      Object.assign(totals.balance[col.period], { [cur]: balance });
    }
  }

  const projectName = !project ? "All projects" : project === "-" ? "No project" : db.findRow("projects", (x) => x.code === project)?.name || project;
  return {
    from, count, project, projectName, currentPeriod: current, previous: timesheet.adjacentPeriod(from, -1),
    columns, currencies, rows: ROWS, values: out, totals,
    info: {
      normalHours: nh,
      overtimeSamples: OVERTIME_SAMPLES,
      closedPeriods: timesheet.allPeriods().filter((t) => t.status === "closed").length,
      recurringSeries: series.length,
      unpaid: employees.filter((e) => e.status !== "Left" && (!e.payType || !num(e.pay))).length,
      manualCount: Object.keys(manual).length,
    },
  };
}
