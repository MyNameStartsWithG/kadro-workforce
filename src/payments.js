/**
 * Payments: who gets paid, when, how much, and whether it has been paid.
 *
 * Payment items are generated from the timesheets (not stored, computed on every read):
 *   Meal allowance → at the start of every opened period (the 1st and 16th), per person, in advance for the period's days.
 *   Hourly wages   → the day after every closed period (the 16th and the 1st of next month), the period's net.
 *   Monthly salary → when the 2nd half of the month closes, on the 1st of next month, the net of both halves (month-end pay).
 *   House rent     → when the 1st half of the month opens, on the 1st; split over the projects of the residents.
 * The paid mark is written to db.payments (date, amount paid, note). The amount paid may differ from the calculated
 * one (e.g. 90 instead of 100): the difference stays visible. A paid mark becomes an expense row in cash (see cash.js).
 */
import * as db from "./db.js";
import * as timesheet from "./timesheet.js";
import { monthlyRent, num } from "./relations.js";

const pad = (n) => String(n).padStart(2, "0");
const round = (n) => Math.round(n * 100) / 100;
const CURRENCY_ORDER = ["EUR", "TRY", "RSD"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GROUPS = {
  rent: { name: "House rents", category: "Rent", order: 1 },
  monthly: { name: "Monthly salaries", category: "Salary", order: 2 },
  hourly: { name: "Hourly wages", category: "Salary", order: 3 },
  meals: { name: "Meal allowances", category: "Meals", order: 4 },
};

const nextDay = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const records = () => { const d = db.all(); d.payments = d.payments || []; return d.payments; };

/** All payment items (without the paid information). */
export function items() {
  const out = [];
  for (const t of timesheet.allPeriods()) {
    const p = timesheet.parsePeriod(t.period);
    const monthCode = `${p.year}-${pad(p.month)}`;
    const monthName = `${timesheet.MONTHS[p.month - 1]} ${p.year}`;
    const periodShort = `${monthName} ${p.half === 1 ? "1st" : "2nd"} half (${p.from}–${p.to})`;
    const c = timesheet.calc(t);
    const firstHalfClosed = p.half === 2 ? timesheet.find(`${monthCode}-1`)?.status === "closed" : true;

    t.rows.forEach((r, i) => {
      const h = c.rows[i];
      const project = t.crews[r.crew]?.project || r.project || "";
      const common = { employeeCode: r.employeeCode, who: r.name, crew: r.crew, period: t.period, project };

      for (const [cur, amount] of Object.entries(h.meals)) {
        if (!(amount > 0)) continue;
        out.push({
          ...common, key: `meals:${t.period}:${r.employeeCode}:${cur}`, type: "meals", due: p.days[0],
          description: `Meal allowance · ${periodShort}`, amount: round(amount), currency: cur,
          detail: { days: h.daysInWork ?? p.days.length, daily: t.crews[r.crew]?.mealDaily || 0 },
        });
      }
      if (t.status !== "closed") return;
      const detail = {
        earnings: h.earnings, overtime: h.overtime, overtimePay: h.overtimePay, deduction: h.deduction,
        deductionDetail: h.deductionDetail, absent: h.absent, advance: h.advanceDeducted ?? (h.advance[h.currency] || 0),
      };
      if (r.payType === "Hourly") {
        for (const [cur, amount] of Object.entries(h.net)) {
          if (!(amount > 0)) continue;
          out.push({
            ...common, key: `salary:${t.period}:${r.employeeCode}:${cur}`, type: "hourly", due: nextDay(p.days.at(-1)),
            description: `Hourly wages · ${periodShort}`, amount, currency: cur, detail,
          });
        }
      } else if (r.payType === "Monthly" && p.half === 2) {
        for (const [cur, amount] of Object.entries(h.monthEnd || h.net)) {
          if (!(amount > 0)) continue;
          out.push({
            ...common, key: `salary:${monthCode}:${r.employeeCode}:${cur}`, type: "monthly", due: nextDay(p.days.at(-1)),
            description: `Monthly salary · ${monthName}`, amount, currency: cur,
            detail: { ...detail, firstHalf: h.firstHalfNet?.[cur] ?? null },
            warning: firstHalfClosed ? null : "The 1st half of the month is not closed yet; the amount may change.",
          });
        }
      }
    });

    // Rent: when the 1st half of the month opens, that month's rent, split over the residents' projects.
    if (p.half === 1) {
      const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
      for (const [houseCode, h] of Object.entries(timesheet.housesSnapshot(t))) {
        if (h.status === "Vacated" || !(h.rent > 0)) continue;
        const amount = round(monthlyRent(h.rent, h.rentPeriod, daysInMonth));
        const residents = t.rows.filter((r) => r.house === houseCode);
        const shares = {};
        for (const r of residents) shares[r.project || ""] = (shares[r.project || ""] || 0) + 1;
        const split = residents.length
          ? Object.entries(shares).map(([project, n]) => ({ project, ratio: n / residents.length }))
          : [{ project: h.project || "", ratio: 1 }];
        out.push({
          key: `rent:${monthCode}:${houseCode}:${h.currency}`, type: "rent", due: p.days[0],
          who: `${houseCode} ${h.name}`, houseCode, period: t.period, project: h.project || "",
          description: `House rent · ${monthName}${h.rentPeriod && h.rentPeriod !== "Monthly" ? ` (${h.rentPeriod.toLowerCase()} rent × ${daysInMonth} days)` : ""}`,
          amount, currency: h.currency, split,
          detail: { people: residents.length, rent: h.rent, period: h.rentPeriod || "Monthly" },
        });
      }
    }
  }
  return out;
}

/** The payment days of a month: items due this month, with paid information, by day and group. */
export function month(monthCode) {
  if (!/^\d{4}-\d{2}$/.test(String(monthCode || ""))) throw new Error(`Invalid month: "${monthCode}". Expected format: 2026-10`);
  const all = items();
  const paid = new Map(records().map((r) => [r.key, r]));
  const today = new Date().toISOString().slice(0, 10);

  const join = (k) => {
    const r = paid.get(k.key);
    return { ...k, paid: Boolean(r), payment: r || null, changed: r && r.systemAmount !== k.amount ? k.amount : null };
  };
  const thisMonth = all.filter((k) => k.due.startsWith(monthCode)).map(join);
  // Paid records whose item is no longer generated (e.g. the period was reopened) stay on the list.
  const present = new Set(thisMonth.map((k) => k.key));
  for (const r of records()) {
    if (!r.due?.startsWith(monthCode) || present.has(r.key)) continue;
    thisMonth.push({ ...r, amount: r.systemAmount, paid: true, payment: r, noSource: true });
  }

  const days = new Map();
  for (const k of thisMonth) {
    const d = (days.get(k.due) || days.set(k.due, { due: k.due, groups: new Map() }).get(k.due));
    const g = (d.groups.get(k.type) || d.groups.set(k.type, { type: k.type, name: GROUPS[k.type]?.name || k.type, items: [] }).get(k.type));
    g.items.push(k);
  }
  const summarize = (list) => {
    const s = { total: {}, paid: {}, remaining: {}, count: list.length, paidCount: 0 };
    for (const k of list) {
      const cur = k.currency;
      s.total[cur] = round((s.total[cur] || 0) + (k.amount || 0));
      if (k.paid) { s.paidCount += 1; s.paid[cur] = round((s.paid[cur] || 0) + num(k.payment.amount)); }
      else s.remaining[cur] = round((s.remaining[cur] || 0) + (k.amount || 0));
    }
    return s;
  };
  const sortedDays = [...days.values()].sort((a, b) => a.due.localeCompare(b.due)).map((d) => ({
    due: d.due, past: d.due < today,
    groups: [...d.groups.values()].sort((a, b) => (GROUPS[a.type]?.order || 9) - (GROUPS[b.type]?.order || 9)).map((g) => ({
      ...g, items: g.items.sort((a, b) => a.who.localeCompare(b.who, "tr") || CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency)),
      summary: summarize(g.items),
    })),
    summary: summarize(d.groups.size ? [...d.groups.values()].flatMap((x) => x.items) : []),
  }));

  const olderUnpaid = all.filter((k) => k.due < `${monthCode}-01` && !paid.has(k.key));
  return {
    month: monthCode, days: sortedDays, summary: summarize(thisMonth),
    overdue: { count: olderUnpaid.length, oldest: olderUnpaid.map((k) => k.due).sort()[0] || null },
  };
}

/** Sets or updates the paid mark: [{ key, date, amount, note }] */
export function pay(list) {
  if (!Array.isArray(list) || !list.length) throw new Error("No payment item selected.");
  const all = new Map(items().map((k) => [k.key, k]));
  const recs = records();
  const ready = list.map(({ key, date, amount, note }) => {
    const existing = recs.find((r) => r.key === key);
    const k = all.get(key) || (existing && { ...existing, amount: existing.systemAmount });
    if (!k) throw new Error(`Payment item not found: ${key}`);
    if (!DATE.test(String(date || ""))) throw new Error(`${k.who}: invalid payment date.`);
    const n = amount === undefined || amount === null || amount === "" ? k.amount : num(amount);
    if (!(n >= 0)) throw new Error(`${k.who}: invalid amount paid.`);
    return { k, existing, date, amount: round(n), note: String(note ?? existing?.note ?? "").trim() };
  });
  for (const { k, existing, date, amount, note } of ready) {
    const r = {
      key: k.key, type: k.type, due: k.due, who: k.who, description: k.description,
      employeeCode: k.employeeCode || "", houseCode: k.houseCode || "", period: k.period, project: k.project || "",
      split: k.split || null, currency: k.currency,
      systemAmount: k.amount, amount, date, note,
      user: db.settings().user, recordedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, r); else recs.push(r);
  }
  db.save();
  return ready.length;
}

/** Removes the paid mark (its cash row goes too). */
export function undo(key) {
  const recs = records();
  const i = recs.findIndex((r) => r.key === key);
  if (i < 0) throw new Error("This item already looks unpaid.");
  recs.splice(i, 1);
  db.save();
}

/** Cash rows of paid items (cash.sync writes these as automatic rows). */
export function cashRows() {
  const out = [];
  for (const r of records()) {
    const category = GROUPS[r.type]?.category || "Other expense";
    const diff = r.amount !== r.systemAmount ? ` (calculated ${r.systemAmount.toLocaleString("en-GB")} ${r.currency})` : "";
    const description = `${r.description} — ${r.who}${diff}${r.note ? ` · ${r.note}` : ""}`;
    const common = { date: r.date, type: "Expense", category, source: "Payment", description, employeeCode: r.employeeCode || "", currency: r.currency };
    if (r.split?.length > 1) {
      for (const s of r.split) out.push({ ...common, key: `payment:${r.key}:${s.project || "-"}`, project: s.project, amount: r.amount * s.ratio });
    } else {
      out.push({ ...common, key: `payment:${r.key}`, project: r.split?.[0]?.project ?? r.project, amount: r.amount });
    }
  }
  return out;
}
