/**
 * Employee's view: a person's own timesheet, earnings, reasons for deductions, advances and payments.
 * The manager opens it from the employee page ("Employee's view"); a future employee portal will show the same data.
 * So it only returns fields that belong to that person and may be shown to them: manager notes, other people's
 * data, cash and manager warnings are left out.
 */
import * as db from "./db.js";
import * as timesheet from "./timesheet.js";
import * as payments from "./payments.js";
import * as contracts from "./contracts.js";
import { houseCalc, projectOf } from "./relations.js";

const byCode = (table, code) => (code ? db.findRow(table, (x) => x.code === code) : null);
const weekday = (day) => timesheet.DAY_SHORT[new Date(`${day}T00:00:00Z`).getUTCDay()];

export function view(employeeCode) {
  const person = byCode("employees", employeeCode);
  if (!person) throw new Error(`No employee with code "${employeeCode}".`);

  const crew = byCode("crews", person.crew);
  const house = byCode("houses", person.house);
  const project = byCode("projects", projectOf(person));
  const hc = house ? houseCalc(house) : null;

  const periods = [];
  for (const t of timesheet.allPeriods()) {
    const r = t.rows.find((x) => x.employeeCode === employeeCode);
    if (!r) continue;
    const i = t.rows.indexOf(r);
    const h = timesheet.calc(t).rows[i];            // the whole period, for monthEnd and firstHalfNet
    const { daily } = timesheet.calcRow(t, r);
    const crewName = (code) => t.crews[code]?.name || code;
    const p = timesheet.parsePeriod(t.period);
    const advances = db.table("advances")
      .filter((a) => a.employeeCode === employeeCode && a.date >= p.days[0] && a.date <= p.days.at(-1))
      .map((a) => ({ date: a.date, amount: Number(a.amount) || 0, currency: a.currency || "EUR" }))
      .sort((a, b) => a.date.localeCompare(b.date));

    periods.push({
      period: t.period, name: timesheet.periodName(t.period), half: p.half, status: t.status, rule: h.rule,
      crew: r.crew ? { code: r.crew, name: crewName(r.crew) } : null,
      payType: r.payType, pay: r.pay, currency: h.currency,
      // Day by day: n/m normal and overtime hours (totals of a chosen date range are computed from these).
      days: daily.map((d) => {
        const excluded = d.beforeStart || d.outsideContract;
        return {
          day: d.day, wd: weekday(d.day), type: t.days[d.day] || "normal", value: r.cells[d.day] || "",
          n: d.n, m: d.m,
          // Rule 1 day breakdowns have no "absent" flag; it is read from the cell.
          absent: !excluded && (Boolean(d.absent) || r.cells[d.day] === "–"),
          beforeStart: Boolean(d.beforeStart), outsideContract: Boolean(d.outsideContract),
          otherCrew: d.crew && d.crew !== r.crew ? crewName(d.crew) : "",
        };
      }),
      total: h.total, normal: h.normal, overtime: h.overtime, workedDays: h.workedDays,
      leave: h.leave, sick: h.sick, absent: h.absent,
      basePay: h.basePay, overtimeUnit: h.overtimeUnit, overtimePay: h.overtimePay, earnings: h.earnings,
      deduction: h.deduction, deductionItems: h.deductionItems || null, deductionDetail: h.deductionDetail, notDeducted: h.notDeducted,
      advances, advanceDeducted: h.advanceDeducted, advanceConverted: h.advanceConverted || [],
      net: h.net, monthEnd: h.monthEnd || null, firstHalfNet: h.firstHalfNet || null,
      rates: h.rates || null,
    });
  }

  // Payments: salary / hourly wages / meal allowance; paid or not, and when. `period` comes from the key (meals:<period>:…).
  const periodOfKey = (key) => String(key || "").split(":")[1] || null;
  const paid = new Map((db.table("payments") || []).map((r) => [r.key, r]));
  const allItems = payments.items();
  const list = allItems
    .filter((k) => k.employeeCode === employeeCode)
    .map((k) => {
      const r = paid.get(k.key);
      return { type: k.type, period: periodOfKey(k.key), description: k.description, due: k.due, amount: k.amount, currency: k.currency,
        paid: Boolean(r), paidDate: r?.date || null, paidAmount: r ? Number(r.amount) : null };
    });
  // Paid records whose item is no longer calculated are shown too.
  const seen = new Set(allItems.map((k) => k.key));
  for (const r of db.table("payments") || []) {
    if (r.employeeCode !== employeeCode || seen.has(r.key)) continue;
    list.push({ type: r.type, period: periodOfKey(r.key), description: r.description, due: r.due, amount: r.systemAmount, currency: r.currency,
      paid: true, paidDate: r.date, paidAmount: Number(r.amount) });
  }
  list.sort((a, b) => b.due.localeCompare(a.due) || a.type.localeCompare(b.type));

  return {
    person: {
      _id: person._id, code: person.code, name: person.name, role: person.role || "", status: person.status || "",
      payType: person.payType || "", pay: person.pay || "", currency: person.currency || "EUR",
      startDate: person.startDate || "",
      documents: [
        ["Work permit", person.workPermitExpiry], ["Residence permit", person.residencePermitExpiry], ["Passport", person.passportExpiry],
      ].filter(([, d]) => d).map(([name, expiry]) => ({ name, expiry })),
    },
    crew: crew ? { code: crew.code, name: crew.name, mealDaily: Number(crew.mealDaily) || 0, mealCurrency: crew.mealCurrency || "EUR" } : null,
    project: project ? { code: project.code, name: project.name } : null,
    house: house ? {
      code: house.code, name: house.name, address: [house.address, house.city].filter(Boolean).join(", "),
      people: hc.headcount, rentPerPerson: hc.rentPerPerson, rentPerPersonDaily: hc.rentPerPersonDaily, currency: hc.currency,
    } : null,
    // Employment periods (contracts); manager notes are not included.
    work: contracts.recordsOf(employeeCode).map((r) => ({
      type: r.type || "Work", start: r.start, end: r.end || "", status: contracts.recordStatus(r),
      project: r.project ? byCode("projects", r.project)?.name || r.project : "",
    })).reverse(),
    periods: periods.reverse(),
    payments: list,
    created: new Date().toISOString(),
  };
}
