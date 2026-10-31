/**
 * Calendar timesheet: 15-day periods, hours, earnings and statistics.
 *
 * Period id: "2026-10-1" (1–15) and "2026-10-2" (16–end of month).
 *
 * PRINCIPLE: when a period is opened, each employee's pay, crew, the crews' meal allowance and the rent share
 * are COPIED into the period (a snapshot). Later changes do not affect opened periods; they only apply to
 * periods opened afterwards.
 *
 * Cell values: hours ("8", "10.5"), "L" leave, "S" sick, "–" absent, "" not entered.
 */
import * as db from "./db.js";
import { projectOf, houseCalc, RENT_FACTOR } from "./relations.js";
import { rateSettings, convert, conversionText } from "./rates.js";
import * as contracts from "./contracts.js";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export const DAY_TYPES = ["normal", "overtime", "holiday"];

export const DEFAULT_SETTINGS = {
  overtimeMultiplier: 1.5,  // pay multiplier of an overtime hour
  normalHours: 8,           // hours expected on a normal day
  weekdayExcess: false,     // if on, hours above the normal hours on a normal day count as overtime
  holidayAsOvertime: true,  // if on, hours worked on a holiday count as overtime
};

/**
 * Calculation rule version. Rule 2 (October 2026, client decision) only applies to periods opened afterwards:
 *  - Overtime is paid at a fixed hourly rate (a period setting per currency; a personal rate can be set on the employee).
 *  - Only a day marked "–" (absent) causes a deduction. Empty cells and days before the start date do not.
 *  - On an absent day: monthly staff lose a daily salary (salary × 12 ÷ 365) + daily rent share + daily meals;
 *    hourly staff lose the daily rent share + daily meals.
 *  - Meal allowance is paid in advance for every day of the period; the rent share is daily (rent × F ÷ 365).
 * Rule 3 (13 October 2026): rule 2 + exchange rates. Rent, meals and advances in a currency other than the salary's
 * are converted with the period's rates (settings.rates, copied from Settings when the period opens) and deducted.
 * Without a rate they are not deducted.
 */
export const CURRENT_RULE = 3;
export const RULE2_SETTINGS = {
  overtimeMode: "rate",          // "rate": fixed hourly overtime rate · "multiplier": hourly value × multiplier
  overtimeRate: { EUR: 5 },      // hourly overtime rate per currency
  deductShortHours: false,       // if on, short hours of monthly staff (outside absent days) are deducted at the hourly value
};

const pad = (n) => String(n).padStart(2, "0");
const round = (n) => Math.round(n * 100) / 100;
const fmt = (n, digits = 2) => Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: digits });
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const todayText = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function add(totals, cur, amount) {
  if (!amount) return;
  const k = cur || "EUR";
  totals[k] = round((totals[k] || 0) + amount);
}
const merge = (totals, more) => { for (const [cur, v] of Object.entries(more || {})) add(totals, cur, v); return totals; };

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

export function parsePeriod(period) {
  const m = /^(\d{4})-(\d{2})-([12])$/.exec(String(period || ""));
  if (!m) throw new Error(`Invalid period: "${period}". Expected format: 2026-10-1`);
  const year = +m[1], month = +m[2], half = +m[3];
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${period}`);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = half === 1 ? 1 : 16;
  const to = half === 1 ? 15 : lastDay;
  const days = [];
  for (let d = from; d <= to; d += 1) days.push(`${year}-${pad(month)}-${pad(d)}`);
  return { period: `${year}-${pad(month)}-${half}`, year, month, half, from, to, days };
}

export const periodName = (period) => {
  const p = parsePeriod(period);
  return `${MONTHS[p.month - 1]} ${p.year} · ${p.half === 1 ? "1st" : "2nd"} half (${p.from}–${p.to})`;
};

export function periodOfDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
  if (!m) return null;
  return `${m[1]}-${m[2]}-${+m[3] <= 15 ? 1 : 2}`;
}
export const currentPeriod = () => periodOfDate(todayText());

export function adjacentPeriod(period, dir) {
  const p = parsePeriod(period);
  let { year, month, half } = p;
  if (dir > 0) { if (half === 1) half = 2; else { half = 1; month += 1; if (month > 12) { month = 1; year += 1; } } }
  else { if (half === 2) half = 1; else { half = 2; month -= 1; if (month < 1) { month = 12; year -= 1; } } }
  return `${year}-${pad(month)}-${half}`;
}

const weekday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Default day type: Saturday is an overtime day, Sunday a holiday, the rest normal. */
export const defaultDayType = (day) => ({ 6: "overtime", 0: "holiday" }[weekday(day)] || "normal");

export function dayInfo(period) {
  return parsePeriod(period).days.map((d) => ({ day: d, no: +d.slice(8), short: DAY_SHORT[weekday(d)] }));
}

/* ------------------------------------------------------------------ */
/* Record access                                                       */
/* ------------------------------------------------------------------ */

const list = () => { const d = db.all(); d.timesheets = d.timesheets || []; return d.timesheets; };
export const find = (period) => list().find((t) => t.period === period) || null;
export const allPeriods = () => [...list()].sort((a, b) => a.period.localeCompare(b.period));

export function get(period) {
  const t = find(period);
  if (!t) throw new Error(`${periodName(period)} has not been opened yet.`);
  return t;
}

function mustBeOpen(t) {
  if (t.status === "closed") throw new Error(`${periodName(t.period)} is closed. Reopen the period to make changes.`);
}

/** A crew as copied into the period. */
function crewCopy(c) {
  const project = c.project ? db.findRow("projects", (x) => x.code === c.project) : null;
  return {
    name: c.name, project: c.project || "", projectName: project?.name || "",
    mealDaily: num(c.mealDaily), mealCurrency: c.mealCurrency || "EUR",
  };
}

/** An employee as copied into the period (pay, crew, rent share, work ranges). */
function rowCopy(p) {
  const house = p.house ? db.findRow("houses", (x) => x.code === p.house) : null;
  const rent = house && house.status !== "Vacated" ? houseCalc(house) : null;
  const workRanges = contracts.ranges(p.code);
  return {
    ...(workRanges ? { workRanges } : {}),
    employeeCode: p.code, name: p.name, role: p.role || "",
    crew: p.crew || "", project: projectOf(p),
    payType: p.payType || "", pay: p.pay || "", currency: p.currency || "EUR",
    overtimeRate: p.overtimeRate || "", startDate: p.startDate || "",
    house: p.house || "", rentShare: rent ? round(rent.rentPerPerson / 2) : 0, rentCurrency: rent?.currency || "EUR",
    rentDaily: rent ? rent.rentPerPersonDaily : 0,
    cells: {}, crewDays: {},
  };
}

/** A house as copied into the period (rent payments are calculated from this copy). */
const houseCopy = (h) => ({
  name: h.name, project: h.project || "", rent: num(h.rent), rentPeriod: h.rentPeriod || "Monthly",
  currency: h.currency || "EUR", status: h.status || "Active",
});

/** The period's house snapshot. Old periods without one use the houses as they are now. */
export const housesSnapshot = (t) => t.houses || Object.fromEntries(db.table("houses").map((h) => [h.code, houseCopy(h)]));

/** People in a period: with employment periods, if one overlaps the period; without, if not Left. */
function periodPeople(p) {
  return db.table("employees").filter((e) => {
    const rs = contracts.ranges(e.code);
    return rs ? contracts.overlaps(rs, p.days[0], p.days.at(-1)) : e.status !== "Left";
  });
}

/** Under rule 2+, is the day outside the row's working time (before the start date or outside a contract)? Returns the reason or "". */
export function dayExcluded(r, day) {
  if (r.startDate && day < r.startDate) return "beforeStart";
  if (Array.isArray(r.workRanges) && !contracts.within(r.workRanges, day)) return "outsideContract";
  return "";
}

// Crew by crew; people without a crew at the bottom. Turkish collation for the names.
const crewOrder = (a, b) => (!a.crew - !b.crew) || (a.crew || "").localeCompare(b.crew || "") || a.name.localeCompare(b.name, "tr");

/** Opens a period: copies active employees, crews and day types. */
export function create(period) {
  const p = parsePeriod(period);
  if (find(p.period)) throw new Error(`${periodName(p.period)} is already open.`);
  const crews = {};
  for (const c of db.table("crews")) crews[c.code] = crewCopy(c);
  const rows = periodPeople(p).map(rowCopy).sort(crewOrder);

  // Settings are inherited from the previous period; the first period uses the defaults.
  const previous = find(adjacentPeriod(p.period, -1));
  const t = {
    _id: db.newId(),
    period: p.period,
    status: "open",
    rule: CURRENT_RULE,
    created: new Date().toISOString(),
    createdBy: db.settings().user,
    settings: { ...DEFAULT_SETTINGS, ...RULE2_SETTINGS, ...(previous?.settings || {}), rates: rateSettings() },
    days: Object.fromEntries(p.days.map((d) => [d, defaultDayType(d)])),
    crews,
    houses: Object.fromEntries(db.table("houses").map((h) => [h.code, houseCopy(h)])),
    rows,
  };
  list().push(t);
  db.save();
  return t;
}

/** Shows what will be copied before a period is opened. */
export function preview(period) {
  const people = periodPeople(parsePeriod(period));
  return {
    people: people.length,
    crews: new Set(people.map((p) => p.crew).filter(Boolean)).size,
    unpaid: people.filter((p) => !p.payType || !num(p.pay)).map((p) => `${p.code} ${p.name}`),
    noCrew: people.filter((p) => !p.crew).length,
    previousSettings: find(adjacentPeriod(period, -1))?.settings || null,
  };
}

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

export function normalizeValue(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return "";
  if (["L", "LEAVE"].includes(s)) return "L";
  if (["S", "SICK"].includes(s)) return "S";
  if (["-", "–", "—", "X", "A", "ABSENT"].includes(s)) return "–";
  const n = Number(s.replace(",", "."));
  if (!/^\d+([.,]\d+)?$/.test(s) || !Number.isFinite(n) || n > 24) {
    throw new Error(`"${v}" is not valid. Enter hours (0–24), L (leave), S (sick) or – (absent).`);
  }
  return String(round(n));
}

const getRow = (t, code) => {
  const r = t.rows.find((x) => x.employeeCode === code);
  if (!r) throw new Error(`${code} is not in this period.`);
  return r;
};

/** Writes several cells at once: [{ employeeCode, day, value }] */
export function writeCells(period, changes) {
  const t = get(period);
  mustBeOpen(t);
  const days = new Set(parsePeriod(period).days);
  const affected = new Set();
  // Validate everything first; if one is wrong, nothing is written.
  const ready = changes.map(({ employeeCode, day, value }) => {
    if (!days.has(day)) throw new Error(`${day} is not in this period.`);
    return { r: getRow(t, employeeCode), day, value: normalizeValue(value) };
  });
  for (const { r, day, value } of ready) {
    if (value) r.cells[day] = value; else delete r.cells[day];
    affected.add(r.employeeCode);
  }
  db.save();
  return [...affected];
}

/** Changes a person's crew on given days (a crew change in the middle of a period). */
export function writeCrewDays(period, employeeCode, days, crewCode) {
  const t = get(period);
  mustBeOpen(t);
  const r = getRow(t, employeeCode);
  if (crewCode && !t.crews[crewCode]) {
    const c = db.findRow("crews", (x) => x.code === crewCode);
    if (!c) throw new Error(`No crew with number "${crewCode}".`);
    t.crews[crewCode] = crewCopy(c); // a crew created after the period opened: copied as it is now
  }
  for (const d of days) {
    if (!crewCode || crewCode === r.crew) delete r.crewDays[d]; else r.crewDays[d] = crewCode;
  }
  db.save();
}

export function writeSettings(period, { settings, days, upgradeRule }) {
  const t = get(period);
  mustBeOpen(t);
  if (upgradeRule && (t.rule || 1) < CURRENT_RULE) {
    // Moves an open period to the current rules: missing settings and new per-person fields are filled from today's data.
    const old = t.rule || 1;
    t.rule = CURRENT_RULE;
    t.settings = { ...RULE2_SETTINGS, ...t.settings };
    if (!t.settings.rates) t.settings.rates = rateSettings();
    if (old < 2) for (const r of t.rows) {
      const e = db.findRow("employees", (x) => x.code === r.employeeCode);
      const fresh = e ? rowCopy(e) : {};
      if (r.overtimeRate === undefined) r.overtimeRate = fresh.overtimeRate || "";
      if (r.startDate === undefined) r.startDate = fresh.startDate || "";
      if (r.rentDaily === undefined) r.rentDaily = r.house && r.house === fresh.house ? fresh.rentDaily || 0 : round((r.rentShare || 0) * 2 * 12 / 365);
    }
    for (const code of Object.keys(t.houses || {})) if (!t.houses[code].rentPeriod) t.houses[code].rentPeriod = "Monthly";
    for (const r of t.rows) { const rs = contracts.ranges(r.employeeCode); if (rs) r.workRanges = rs; }
  }
  if (settings) {
    const s = { ...t.settings };
    if ("overtimeMultiplier" in settings) s.overtimeMultiplier = Math.max(1, Math.min(5, num(settings.overtimeMultiplier) || 1.5));
    if ("normalHours" in settings) s.normalHours = Math.max(1, Math.min(24, num(settings.normalHours) || 8));
    if ("weekdayExcess" in settings) s.weekdayExcess = Boolean(settings.weekdayExcess);
    if ("holidayAsOvertime" in settings) s.holidayAsOvertime = Boolean(settings.holidayAsOvertime);
    if ("overtimeMode" in settings) s.overtimeMode = settings.overtimeMode === "multiplier" ? "multiplier" : "rate";
    if ("deductShortHours" in settings) s.deductShortHours = Boolean(settings.deductShortHours);
    if (settings.rates === "current") s.rates = rateSettings();   // replaces the period's rates with the current ones from Settings
    if (settings.overtimeRate && typeof settings.overtimeRate === "object") {
      s.overtimeRate = { ...(s.overtimeRate || {}) };
      for (const [cur, v] of Object.entries(settings.overtimeRate)) {
        const n = num(v);
        if (n < 0 || n > 100000) throw new Error(`Invalid overtime rate: ${v}`);
        if (n) s.overtimeRate[cur] = round(n); else delete s.overtimeRate[cur];
      }
    }
    t.settings = s;
  }
  if (days) {
    for (const [d, type] of Object.entries(days)) {
      if (!(d in t.days)) throw new Error(`${d} is not in this period.`);
      if (!DAY_TYPES.includes(type)) throw new Error(`Invalid day type: ${type}`);
      t.days[d] = type;
    }
  }
  db.save();
}

/** Someone who started after the period opened: added as they are now. */
export function addRow(period, employeeCode) {
  const t = get(period);
  mustBeOpen(t);
  if (t.rows.some((r) => r.employeeCode === employeeCode)) throw new Error(`${employeeCode} is already in this period.`);
  const e = db.findRow("employees", (x) => x.code === employeeCode);
  if (!e) throw new Error(`${employeeCode} not found.`);
  if (e.crew && !t.crews[e.crew]) {
    const c = db.findRow("crews", (x) => x.code === e.crew);
    if (c) t.crews[c.code] = crewCopy(c);
  }
  t.rows.push(rowCopy(e));
  t.rows.sort(crewOrder);
  db.save();
}

export function removeRow(period, employeeCode) {
  const t = get(period);
  mustBeOpen(t);
  const r = getRow(t, employeeCode);
  if (Object.keys(r.cells).length) throw new Error(`${r.name} has hours entered. Clear the row first.`);
  t.rows = t.rows.filter((x) => x !== r);
  db.save();
}

export function setStatus(period, status, extra = {}) {
  const t = get(period);
  t.status = status;
  if (status === "closed") t.closing = { date: new Date().toISOString(), user: db.settings().user, ...extra };
  else delete t.closing;
  db.save();
  return t;
}

/* ------------------------------------------------------------------ */
/* Calculation                                                         */
/* ------------------------------------------------------------------ */

/** Workdays in the month: normal days of this period + normal days of the other half of the same month. */
function monthWorkdays(t) {
  const p = parsePeriod(t.period);
  const sibling = `${p.year}-${pad(p.month)}-${p.half === 1 ? 2 : 1}`;
  const st = find(sibling);
  const count = (days, typeOf) => days.filter((d) => typeOf(d) === "normal").length;
  return count(p.days, (d) => t.days[d] || defaultDayType(d))
    + count(parsePeriod(sibling).days, (d) => st?.days[d] || defaultDayType(d));
}

function advancesIn(employeeCode, days) {
  const from = days[0], to = days[days.length - 1];
  return db.table("advances").filter((a) => a.employeeCode === employeeCode && a.date >= from && a.date <= to);
}

/** The complete calculation of one row. Returns: hours, money amounts and the day-by-day breakdown. */
export function calcRow(t, r, ctx = {}) {
  return (t.rule || 1) >= 2 ? calcRowRule2(t, r, ctx) : calcRowRule1(t, r, ctx);
}

/** Rule 1 (first version): short hours × hourly value are deducted, overtime = hourly value × multiplier. Old periods stay like this. */
function calcRowRule1(t, r, ctx = {}) {
  const s = { ...DEFAULT_SETTINGS, ...t.settings };
  const nh = num(s.normalHours) || 8;
  const mult = num(s.overtimeMultiplier) || 1.5;
  const days = parsePeriod(t.period).days;
  const today = ctx.today || todayText();
  const closed = t.status === "closed";

  let normal = 0, overtime = 0, short = 0, workedDays = 0, leave = 0, sick = 0, absent = 0, normalDays = 0;
  const meals = {};
  const daily = [];

  for (const d of days) {
    const type = t.days[d] || "normal";
    const v = r.cells[d] || "";
    const crew = r.crewDays[d] || r.crew;
    const hours = /^\d/.test(v) ? Number(v) : 0;
    if (type === "normal") normalDays += 1;

    let n = 0, m = 0;
    if (type === "normal") {
      if (s.weekdayExcess) { n = Math.min(hours, nh); m = hours - n; } else n = hours;
    } else if (type === "overtime") m = hours;
    else if (s.holidayAsOvertime) m = hours; else n = hours;
    normal += n; overtime += m;

    let dayMeals = 0;
    if (hours > 0) {
      workedDays += 1;
      const c = t.crews[crew];
      if (c?.mealDaily) { dayMeals = c.mealDaily; add(meals, c.mealCurrency, dayMeals); }
    }
    if (v === "L") leave += 1;
    else if (v === "S") sick += 1;
    else if (v === "–") absent += 1;

    // Short hours: what is missing from the expected hours on a normal day. Leave and sick days are not short.
    // An empty cell only counts as short once its day has passed (or the period is closed).
    let dayShort = 0;
    if (type === "normal" && v !== "L" && v !== "S" && (v !== "" || closed || d <= today)) {
      dayShort = Math.max(0, nh - hours);
      short += dayShort;
    }
    daily.push({ day: d, crew, n, m, short: dayShort, meals: dayMeals });
  }

  // Pay
  const pay = num(r.pay);
  let earnings = 0, deduction = 0, hourlyValue = 0, basePay = 0;
  if (r.payType === "Hourly") {
    hourlyValue = pay;
    basePay = normal * pay;
    earnings = basePay + overtime * pay * mult;
  } else if (r.payType === "Monthly") {
    const workdays = ctx.monthWorkdays ?? monthWorkdays(t);
    hourlyValue = workdays ? pay / (workdays * nh) : 0;
    const half = pay / 2;
    deduction = Math.min(half, short * hourlyValue);
    basePay = half - deduction;
    earnings = basePay + overtime * hourlyValue * mult;
  }
  const cur = r.currency || "EUR";

  const advanceRecords = advancesIn(r.employeeCode, days);
  const advance = {};
  for (const a of advanceRecords) add(advance, a.currency || "EUR", num(a.amount));
  const net = { [cur]: round(earnings - (advance[cur] || 0)) };
  const otherCurrencies = Object.keys(advance).filter((k) => k !== cur);

  return {
    employeeCode: r.employeeCode, rule: 1,
    total: round(normal + overtime), normal: round(normal), overtime: round(overtime), short: round(short),
    workedDays, leave, sick, absent, normalDays,
    currency: cur, hourlyValue: round(hourlyValue), multiplier: mult,
    overtimeUnit: hourlyValue * mult, overtimePay: round(overtime * hourlyValue * mult),
    basePay: round(basePay), baseNet: round(basePay), deduction: round(deduction), earnings: round(earnings),
    deductionDetail: { salary: 0, shortHours: round(deduction), rent: 0, meals: 0 }, notDeducted: {},
    advance, advanceDeducted: advance[cur] || 0, advanceCount: advanceRecords.length, net,
    warnings: [
      !r.payType || !pay ? "No pay information; earnings not calculated." : "",
      otherCurrencies.length ? `Advance in a different currency (${otherCurrencies.join(", ")}); not deducted from pay.` : "",
    ].filter(Boolean),
    meals, rent: r.rentShare ? { [r.rentCurrency || "EUR"]: r.rentShare } : {},
    daily,
  };
}

/**
 * Rules 2 and 3: fixed overtime rate, deductions only for absent days, daily rent and meals.
 * earnings is gross; net = earnings − deduction − advances. Deductions in the salary's currency are taken from pay.
 * Rent/meals/advances in another currency: under rule 3 converted with the period's rates and deducted; under rule 2,
 * or without a rate, shown in notDeducted and not deducted. deductionItems: the formula breakdown shown on screen.
 */
function calcRowRule2(t, r, ctx = {}) {
  const s = { ...DEFAULT_SETTINGS, ...RULE2_SETTINGS, ...t.settings };
  const nh = num(s.normalHours) || 8;
  const mult = num(s.overtimeMultiplier) || 1.5;
  const days = parsePeriod(t.period).days;
  const cur = r.currency || "EUR";
  const pay = num(r.pay);
  const monthly = r.payType === "Monthly", hourly = r.payType === "Hourly";
  const dailySalary = monthly ? pay * 12 / 365 : 0;
  const rentDaily = r.rentDaily !== undefined ? num(r.rentDaily) : (r.rentShare ? r.rentShare * 2 * 12 / 365 : 0);
  const rentCur = r.rentCurrency || "EUR";

  let normal = 0, overtime = 0, short = 0, partialShort = 0, workedDays = 0, leave = 0, sick = 0, absent = 0, normalDays = 0, daysInWork = 0;
  const meals = {}, rent = {};
  const ded = { salary: 0, shortHours: 0, rent: {}, meals: {} };
  const raw = { rent: {}, meals: {} };   // unrounded deductions (the rule 3 breakdown uses these)
  const addRaw = (tot, c, v) => { tot[c || "EUR"] = (tot[c || "EUR"] || 0) + v; };
  const mealDays = {};   // "CUR|daily amount" → number of absent days (for the breakdown)
  const daily = [];

  for (const d of days) {
    const type = t.days[d] || "normal";
    const crew = r.crewDays[d] || r.crew;
    // Days before the start date and outside the employment periods count for nothing.
    const excluded = dayExcluded(r, d);
    if (excluded) { daily.push({ day: d, crew, n: 0, m: 0, short: 0, meals: 0, [excluded]: true }); continue; }
    daysInWork += 1;
    const v = r.cells[d] || "";
    const hours = /^\d/.test(v) ? Number(v) : 0;
    if (type === "normal") normalDays += 1;

    let n = 0, m = 0;
    if (type === "normal") {
      if (s.weekdayExcess) { n = Math.min(hours, nh); m = hours - n; } else n = hours;
    } else if (type === "overtime") m = hours;
    else if (s.holidayAsOvertime) m = hours; else n = hours;
    normal += n; overtime += m;
    if (hours > 0) workedDays += 1;

    // Meal allowance is paid in advance for every day of the period; the rent share runs every day.
    const c = t.crews[crew];
    const dayMeals = c?.mealDaily || 0;
    if (dayMeals) add(meals, c.mealCurrency, dayMeals);
    if (rentDaily) add(rent, rentCur, rentDaily);

    // Deductions only on a "–" (absent) day. An empty cell causes none.
    let dayShort = 0;
    if (v === "L") leave += 1;
    else if (v === "S") sick += 1;
    else if (v === "–") {
      absent += 1;
      if (type === "normal") dayShort = nh;
      ded.salary += dailySalary;
      if (rentDaily) { add(ded.rent, rentCur, rentDaily); addRaw(raw.rent, rentCur, rentDaily); }
      if (dayMeals) {
        add(ded.meals, c.mealCurrency, dayMeals);
        addRaw(raw.meals, c.mealCurrency, dayMeals);
        const key = `${c.mealCurrency || "EUR"}|${dayMeals}`;
        mealDays[key] = (mealDays[key] || 0) + 1;
      }
    } else if (type === "normal" && hours > 0 && hours < nh) {
      dayShort = nh - hours;      // hours entered but short: informational, deducted if the setting is on
      partialShort += dayShort;
    }
    short += dayShort;
    daily.push({ day: d, crew, n, m, short: dayShort, meals: dayMeals, absent: v === "–" });
  }

  // Base pay: hourly = normal hours × rate; monthly = half the salary, or daily salary × days if at work for part of the period.
  const workdays = ctx.monthWorkdays ?? monthWorkdays(t);
  const hourlyValue = hourly ? pay : monthly && workdays ? pay / (workdays * nh) : 0;
  const partial = daysInWork < days.length;
  const basePay = hourly ? normal * pay : monthly ? (partial ? dailySalary * daysInWork : pay / 2) : 0;
  if (monthly && s.deductShortHours) ded.shortHours = partialShort * hourlyValue;
  // Salary deductions (absent days + short hours) cannot exceed the base pay.
  ded.shortHours = Math.min(ded.shortHours, basePay);
  ded.salary = Math.min(ded.salary, basePay - ded.shortHours);

  // Overtime: fixed rate (personal, otherwise the period's rate for the currency) or hourly value × multiplier.
  const personal = num(r.overtimeRate);
  const overtimeUnit = s.overtimeMode === "multiplier" ? hourlyValue * mult : (personal || num(s.overtimeRate?.[cur]));
  const overtimePay = overtime * overtimeUnit;
  const earnings = basePay + overtimePay;

  // Deduction breakdown: every item with its formula. Under rule 3, items not in the salary's currency are converted.
  const rule3 = (t.rule || 1) >= 3;
  const rates = rule3 ? s.rates || null : null;
  // Rule 2 keeps its daily-rounded totals so its numbers never change; rule 3 uses unrounded totals that match the formula.
  const src = rule3 ? raw : ded;
  const items = [], notDeducted = {};
  const addItem = (kind, name, formula, amount, itemCur) => {
    if (!amount) return;
    if (itemCur === cur) { items.push({ kind, name, formula, amount: round(amount), currency: cur }); return; }
    const conv = rates ? convert(amount, itemCur, cur, rates) : null;
    if (conv === null) {
      notDeducted[`${kind} ${itemCur}`] = round(amount);
      items.push({ kind, name, formula, amount: round(amount), currency: itemCur, notDeducted: rates ? `no ${itemCur} rate entered` : "different currency" });
    } else {
      items.push({ kind, name, formula: `${formula} ${conversionText(itemCur, cur, rates)}`, amount: round(conv), currency: cur, source: { amount: round(amount), currency: itemCur } });
    }
  };
  if (ded.salary) {
    const capped = round(ded.salary) < round(dailySalary * absent);
    addItem("salary", "Daily salary", `${absent} days × ${fmt(pay)} ${cur} × 12 ÷ 365${capped ? " (capped at base pay)" : ""}`, ded.salary, cur);
  }
  if (ded.shortHours) addItem("shortHours", "Short hours", `${fmt(partialShort)} h × ${fmt(hourlyValue)} ${cur}`, ded.shortHours, cur);
  if (Object.keys(src.rent).length) {
    const house = r.house ? housesSnapshot(t)[r.house] : null;
    const F = RENT_FACTOR[house?.rentPeriod] || 12;
    const people = house && rentDaily ? house.rent * F / 365 / rentDaily : 0;
    const rentFormula = house && (house.currency || "EUR") === rentCur && people >= 0.99 && Math.abs(people - Math.round(people)) < 0.01
      ? `${fmt(house.rent)} ${rentCur}${F === 365 ? "" : ` × ${F} ÷ 365`} ÷ ${Math.round(people)} people`
      : `${fmt(rentDaily, 4)} ${rentCur}/day`;
    for (const [c, v] of Object.entries(src.rent)) addItem("rent", "Rent share", `${absent} days × ${rentFormula}`, v, c);
  }
  for (const [c, v] of Object.entries(src.meals)) {
    const parts = Object.entries(mealDays).filter(([k]) => k.split("|")[0] === c)
      .map(([k, n]) => `${n} days × ${fmt(Number(k.split("|")[1]))} ${c}`);
    addItem("meals", "Meals", parts.length > 1 ? `(${parts.join(" + ")})` : parts[0] || `${c}`, v, c);
  }
  const deducted = (kind) => round(items.filter((i) => i.kind === kind && !i.notDeducted).reduce((a, i) => a + i.amount, 0));
  const deductionDetail = { salary: deducted("salary"), shortHours: deducted("shortHours"), rent: deducted("rent"), meals: deducted("meals") };
  const deduction = deductionDetail.salary + deductionDetail.shortHours + deductionDetail.rent + deductionDetail.meals;

  const advanceRecords = advancesIn(r.employeeCode, days);
  const advance = {};
  for (const a of advanceRecords) add(advance, a.currency || "EUR", num(a.amount));
  // Advances in another currency: converted and deducted under rule 3.
  let advanceDeducted = advance[cur] || 0;
  const otherCurrencies = [], advanceConverted = [];
  for (const [c, v] of Object.entries(advance)) {
    if (c === cur) continue;
    const conv = rates ? convert(v, c, cur, rates) : null;
    if (conv === null) otherCurrencies.push(c);
    else { advanceDeducted += conv; advanceConverted.push({ amount: v, currency: c, converted: round(conv), formula: `${fmt(v)} ${c} ${conversionText(c, cur, rates)}` }); }
  }
  advanceDeducted = round(advanceDeducted);
  const net = { [cur]: round(earnings - deduction - advanceDeducted) };

  return {
    employeeCode: r.employeeCode, rule: rule3 ? 3 : 2,
    total: round(normal + overtime), normal: round(normal), overtime: round(overtime), short: round(short),
    workedDays, leave, sick, absent, normalDays, daysInWork,
    currency: cur, hourlyValue: round(hourlyValue), multiplier: mult,
    overtimeMode: s.overtimeMode, overtimeUnit: round(overtimeUnit), overtimePay: round(overtimePay),
    dailySalary: round(dailySalary), rentDaily: round(rentDaily),
    basePay: round(basePay), baseNet: round(basePay - ded.salary - ded.shortHours),
    earnings: round(earnings), deduction: round(deduction), deductionDetail, notDeducted, deductionItems: items,
    rates: rates || null,
    advance, advanceDeducted, advanceConverted, advanceCount: advanceRecords.length, net,
    warnings: [
      !r.payType || !pay ? "No pay information; earnings not calculated." : "",
      overtime > 0 && !overtimeUnit ? `No overtime rate entered (${cur}); ${round(overtime)} h of overtime not paid.` : "",
      otherCurrencies.length ? `Advance in a different currency (${otherCurrencies.join(", ")}); not deducted from pay.` : "",
      Object.keys(notDeducted).length
        ? `Deduction in a different currency (${Object.entries(notDeducted).map(([k, v]) => `${k} ${v}`).join(", ")}); ${rates ? "no rate entered, so " : ""}not deducted from pay.` : "",
    ].filter(Boolean),
    meals, rent,
    daily,
  };
}

/** Every row of the period + summary statistics. */
export function calc(t) {
  const workdays = monthWorkdays(t);
  const today = todayText();
  const rows = t.rows.map((r) => calcRow(t, r, { monthWorkdays: workdays, today }));

  // In the 2nd half, the month-end payment: the sum of both periods' net.
  const p = parsePeriod(t.period);
  if (p.half === 2) {
    const first = find(`${p.year}-${pad(p.month)}-1`);
    const firstWorkdays = first ? monthWorkdays(first) : 0;
    for (const h of rows) {
      const r1 = first?.rows.find((x) => x.employeeCode === h.employeeCode);
      const h1 = r1 ? calcRow(first, r1, { monthWorkdays: firstWorkdays, today }) : null;
      h.monthEnd = merge({ ...h.net }, h1?.net);
      h.firstHalfNet = h1?.net || null;
    }
  }

  const summary = {
    people: rows.length,
    crews: new Set(t.rows.flatMap((r) => [r.crew, ...Object.values(r.crewDays)]).filter(Boolean)).size,
    totalHours: 0, normal: 0, overtime: 0, short: 0, leave: 0, sick: 0, absent: 0, workedDays: 0,
    earnings: {}, deduction: {}, advance: {}, net: {}, monthEnd: {}, meals: {}, rent: {},
    deductionSalary: {}, deductionRent: {}, deductionMeals: {}, overtimePay: {},
    unpaid: 0, rule: t.rule || 1,
  };
  rows.forEach((h) => {
    summary.totalHours += h.total; summary.normal += h.normal; summary.overtime += h.overtime; summary.short += h.short;
    summary.leave += h.leave; summary.sick += h.sick; summary.absent += h.absent; summary.workedDays += h.workedDays;
    add(summary.earnings, h.currency, h.earnings);
    add(summary.deduction, h.currency, h.deduction);
    add(summary.deductionSalary, h.currency, h.deductionDetail.salary + h.deductionDetail.shortHours);
    add(summary.deductionRent, h.currency, h.deductionDetail.rent);
    add(summary.deductionMeals, h.currency, h.deductionDetail.meals);
    add(summary.overtimePay, h.currency, h.overtimePay);
    merge(summary.advance, h.advance);
    merge(summary.net, h.net);
    if (h.monthEnd) merge(summary.monthEnd, h.monthEnd);
    merge(summary.meals, h.meals);
    merge(summary.rent, h.rent);
    if (h.warnings.some((x) => x.startsWith("No pay"))) summary.unpaid += 1;
  });
  for (const k of ["totalHours", "normal", "overtime", "short"]) summary[k] = round(summary[k]);

  // Meals and person-days per crew (shown in the statistics panel).
  const crewSummary = {};
  rows.forEach((h) => {
    for (const d of h.daily) {
      if (!d.crew || !(d.n + d.m || d.meals)) continue;
      const c = (crewSummary[d.crew] ||= { code: d.crew, name: t.crews[d.crew]?.name || d.crew, personDays: 0, hours: 0, meals: {} });
      if (d.n + d.m) { c.personDays += 1; c.hours = round(c.hours + d.n + d.m); }
      if (d.meals) add(c.meals, t.crews[d.crew]?.mealCurrency, d.meals);
    }
  });

  return { rows: rows.map(({ daily, ...h }) => h), summary, crewSummary: Object.values(crewSummary), monthWorkdays: workdays };
}

/* ------------------------------------------------------------------ */
/* Statistics: per employee and per project, across several periods    */
/* ------------------------------------------------------------------ */

/** Spreads a row's amounts over projects according to the crew of each day. */
function spreadToProjects(t, r, h, totals) {
  const put = (project, field, cur, amount) => {
    const k = project || "—";
    const p = (totals[k] ||= { project: k, people: new Set(), hours: 0, normal: 0, overtime: 0, short: 0, earnings: {}, meals: {}, rent: {} });
    if (field === "person") { p.people.add(r.employeeCode); return; }
    if (typeof p[field] === "number") p[field] = round(p[field] + amount);
    else add(p[field], cur, amount);
  };
  const totalNormal = h.daily.reduce((a, d) => a + d.n, 0);
  for (const d of h.daily) {
    const project = t.crews[d.crew]?.project || r.project;
    if (d.n + d.m > 0) put(project, "person");
    put(project, "hours", null, d.n + d.m);
    put(project, "normal", null, d.n);
    put(project, "overtime", null, d.m);
    put(project, "short", null, d.short);
    if (d.meals) put(project, "meals", t.crews[d.crew]?.mealCurrency, d.meals);
    // Overtime pay goes to the day's project; base pay is split by the share of normal hours.
    put(project, "earnings", h.currency, d.m * h.overtimeUnit);
    if (totalNormal) put(project, "earnings", h.currency, h.baseNet * (d.n / totalNormal));
  }
  if (!totalNormal && h.baseNet) put(r.project, "earnings", h.currency, h.baseNet);
  for (const [cur, a] of Object.entries(h.rent)) put(r.project, "rent", cur, a);
}

export function statistics(from, to) {
  const periods = allPeriods().filter((t) => (!from || t.period >= from) && (!to || t.period <= to));
  const people = {}, projects = {};
  const today = todayText();

  for (const t of periods) {
    const workdays = monthWorkdays(t);
    for (const r of t.rows) {
      const h = calcRow(t, r, { monthWorkdays: workdays, today });
      const k = (people[r.employeeCode] ||= {
        employeeCode: r.employeeCode, name: r.name, periodCount: 0,
        hours: 0, normal: 0, overtime: 0, short: 0, leave: 0, sick: 0, absent: 0, workedDays: 0,
        earnings: {}, deduction: {}, advance: {}, net: {}, meals: {}, rent: {}, projects: new Set(),
        deductionSalary: {}, deductionRent: {}, deductionMeals: {},
      });
      k.periodCount += 1;
      k.hours = round(k.hours + h.total); k.normal = round(k.normal + h.normal);
      k.overtime = round(k.overtime + h.overtime); k.short = round(k.short + h.short);
      k.leave += h.leave; k.sick += h.sick; k.absent += h.absent; k.workedDays += h.workedDays;
      add(k.earnings, h.currency, h.earnings); add(k.deduction, h.currency, h.deduction);
      add(k.deductionSalary, h.currency, h.deductionDetail.salary + h.deductionDetail.shortHours);
      add(k.deductionRent, h.currency, h.deductionDetail.rent); add(k.deductionMeals, h.currency, h.deductionDetail.meals);
      merge(k.advance, h.advance); merge(k.net, h.net);
      merge(k.meals, h.meals); merge(k.rent, h.rent);
      for (const d of h.daily) { const pr = t.crews[d.crew]?.project || r.project; if (pr && d.n + d.m) k.projects.add(pr); }
      spreadToProjects(t, r, h, projects);
    }
  }

  const projectName = (code) => db.findRow("projects", (x) => x.code === code)?.name || (code === "—" ? "No project" : code);
  const employeeId = (code) => db.findRow("employees", (x) => x.code === code)?._id || null;
  return {
    periods: periods.map((t) => ({ period: t.period, name: periodName(t.period), status: t.status })),
    people: Object.values(people).map((k) => ({ ...k, _id: employeeId(k.employeeCode), projects: [...k.projects].map((x) => ({ code: x, name: projectName(x) })) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr")),
    projects: Object.values(projects)
      .filter((p) => p.hours || Object.keys(p.earnings).length || Object.keys(p.rent).length)
      .map((p) => ({ ...p, name: projectName(p.project), people: p.people.size }))
      .sort((a, b) => b.hours - a.hours),
  };
}

/** Period-by-period breakdown for the employee page. */
export function employeeBreakdown(employeeCode) {
  const out = [];
  for (const t of allPeriods()) {
    const r = t.rows.find((x) => x.employeeCode === employeeCode);
    if (!r) continue;
    const { daily, ...h } = calcRow(t, r);
    out.push({
      period: t.period, name: periodName(t.period), status: t.status, crew: r.crew, payType: r.payType, pay: r.pay, ...h,
      absentDays: daily.filter((d) => d.absent).map((d) => d.day),
    });
  }
  return out.reverse();
}
