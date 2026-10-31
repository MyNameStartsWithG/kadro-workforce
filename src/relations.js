/**
 * Links between records: Project ──< Crew ──< Employee ──> House; equipment goes to a crew or a person.
 *
 * Links always use CODES (KDR-2026-0001, CRW-01, HSE-01, PRJ-2026-0001), so renaming
 * never breaks them. Computed columns (headcount, occupancy, rent per person…) are not
 * stored; they are produced here on every read.
 */
import * as db from "./db.js";
import { recordStatus, isStatusAutomatic } from "./contracts.js";
import { list as noteList } from "./notes.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Day count used for 15-day estimates until a timesheet exists. */
export const STANDARD_PERIOD_DAYS = 15;

const INACTIVE = new Set(["Left"]);

export const num = (v) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const round = (n) => Math.round(n * 100) / 100;
export const moneyText = (n, cur) => (n ? `${round(n).toLocaleString("en-GB")} ${cur || ""}`.trim() : "—");

/** Adds to totals of the form { EUR: 10, RSD: 5 }. */
function add(totals, cur, amount) {
  if (!amount) return;
  const k = cur || "EUR";
  totals[k] = round((totals[k] || 0) + amount);
}

const byCode = (table, code) => (code ? db.findRow(table, (x) => x.code === code) : null);
const activeEmployees = () => db.table("employees").filter((p) => !INACTIVE.has(p.status));

export const crewMembers = (code) => activeEmployees().filter((p) => p.crew === code);
export const houseResidents = (code) => activeEmployees().filter((p) => p.house === code);
export const projectCrews = (code) => db.table("crews").filter((c) => c.project === code);

/** The project a person's costs are charged to: their crew's project, otherwise their house's project. */
export function projectOf(p) {
  return byCode("crews", p.crew)?.project || byCode("houses", p.house)?.project || "";
}

export function crewCalc(c) {
  const people = crewMembers(c.code).length;
  const daily = num(c.mealDaily);
  return {
    headcount: people,
    currency: c.mealCurrency || "EUR",
    mealPerPersonDaily: daily,
    mealCrewDaily: round(daily * people),
    mealCrewPeriod: round(daily * people * STANDARD_PERIOD_DAYS),
  };
}

/** Rent periods per year: daily rent = rent × F ÷ 365. */
export const RENT_FACTOR = { Monthly: 12, Weekly: 52, Daily: 365 };
export const dailyRent = (rent, period) => num(rent) * (RENT_FACTOR[period] || 12) / 365;
/** One month of rent: the rent itself for monthly rents, daily rent × days in the month for weekly/daily ones. */
export const monthlyRent = (rent, period, daysInMonth = 365 / 12) =>
  (!period || period === "Monthly") ? num(rent) : dailyRent(rent, period) * daysInMonth;

export function houseCalc(h) {
  const people = houseResidents(h.code).length;
  const beds = num(h.beds);
  const rent = num(h.rent);
  const period = h.rentPeriod || "Monthly";
  const monthly = monthlyRent(rent, period);
  const daily = dailyRent(rent, period);
  return {
    headcount: people,
    beds,
    overCapacity: beds > 0 && people > beds,
    currency: h.currency || "EUR",
    rent,
    rentPeriod: period,
    rentMonthly: round(monthly),
    rentDaily: round(daily),
    rentPerPerson: people ? round(monthly / people) : 0,
    rentPerPersonDaily: people ? Math.round(daily / people * 10000) / 10000 : 0,
  };
}

/** Adds the computed columns to a table row (not stored). */
export function enrich(tableName, row) {
  if (!row) return row;
  const r = { ...row };
  if (tableName === "crews") {
    const c = crewCalc(r);
    r.headcount = String(c.headcount);
    r.mealCrewDaily = moneyText(c.mealCrewDaily, c.currency);
    r.mealCrewPeriod = moneyText(c.mealCrewPeriod, c.currency);
  } else if (tableName === "houses") {
    const c = houseCalc(r);
    r.occupancy = `${c.headcount}/${c.beds || "?"}${c.overCapacity ? " !" : ""}`;
    r.rentPerPerson = moneyText(c.rentPerPerson, c.currency);
    r.rentPerPersonDaily = moneyText(c.rentPerPersonDaily, c.currency);
  } else if (tableName === "projects") {
    const crews = projectCrews(r.code);
    r.crewCount = String(crews.length);
    r.headcount = String(crews.reduce((a, c) => a + crewMembers(c.code).length, 0));
  } else if (tableName === "advances") {
    r.employeeName = db.findRow("employees", (p) => p.code === r.employeeCode)?.name || "—";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date || "");
    r.period = m ? `${MONTHS[+m[2] - 1]} ${m[1]} · ${+m[3] <= 15 ? "1st" : "2nd"} half` : "—";
  } else if (tableName === "contracts") {
    r.employeeName = db.findRow("employees", (p) => p.code === r.employeeCode)?.name || "—";
    r.statusLabel = recordStatus(r);
  } else if (tableName === "cash") {
    const auto = r.source && r.source !== "Manual";
    r.statusLabel = !auto ? "Entered by hand" : r.editedByHand ? "Corrected by hand" : "Automatic";
    r.systemAmount = auto && r.editedByHand && r.system
      ? (r.system.deleted ? "source deleted" : moneyText(r.system.amount, r.system.currency))
      : "";
  } else if (tableName === "equipment") {
    r.ownerName = r.ownerType === "Crew"
      ? (byCode("crews", r.crewCode)?.name || "—")
      : (db.findRow("employees", (p) => p.code === r.employeeCode)?.name || r.employeeName || "—");
  }
  return r;
}

const stillIssued = (e) => e.status !== "Returned";
const personalEquipment = (code) => db.table("equipment").filter((e) => e.ownerType !== "Crew" && e.employeeCode === code && stillIssued(e));
export const crewEquipment = (code) => db.table("equipment").filter((e) => e.ownerType === "Crew" && e.crewCode === code && stillIssued(e));

const personSummary = (p) => ({
  _id: p._id, code: p.code, name: p.name, role: p.role, status: p.status,
  crew: p.crew, house: p.house, payType: p.payType, pay: p.pay, currency: p.currency,
});

/** Daily meal and monthly rent load of a project (from per-person shares). */
function projectCost(projectCode) {
  const mealDaily = {}, rentMonthly = {}, salaryMonthly = {};
  let hourlyCount = 0;
  for (const c of projectCrews(projectCode)) {
    const k = crewCalc(c);
    add(mealDaily, k.currency, k.mealCrewDaily);
  }
  for (const h of db.table("houses")) {
    if (h.status === "Vacated") continue;
    const k = houseCalc(h);
    for (const p of houseResidents(h.code)) {
      if (projectOf(p) === projectCode) add(rentMonthly, k.currency, k.rentPerPerson);
    }
  }
  for (const p of activeEmployees()) {
    if (projectOf(p) !== projectCode) continue;
    if (p.payType === "Monthly") add(salaryMonthly, p.currency, num(p.pay));
    else if (p.payType === "Hourly") hourlyCount += 1;
  }
  return { mealDaily, rentMonthly, salaryMonthly, hourlyCount };
}

/** Everything the detail page needs about a record and the records linked to it. */
export function detail(tableName, id) {
  const row = db.findRow(tableName, (x) => x._id === id);
  if (!row) throw new Error("Record not found.");
  const out = { row: enrich(tableName, row) };
  const eq = (e) => enrich("equipment", e);

  if (tableName === "employees") {
    const crew = byCode("crews", row.crew);
    const house = byCode("houses", row.house);
    out.crew = crew ? enrich("crews", crew) : null;
    out.house = house ? { ...enrich("houses", house), calc: houseCalc(house) } : null;
    out.project = byCode("projects", projectOf(row));
    out.personalEquipment = personalEquipment(row.code).map(eq);
    out.crewEquipment = crew ? crewEquipment(crew.code).map(eq) : [];
    out.payHistory = [...(row.payHistory || [])].reverse();
    out.mealDaily = crew ? { amount: num(crew.mealDaily), currency: crew.mealCurrency || "EUR" } : null;
    out.contracts = db.table("contracts").filter((r) => r.employeeCode === row.code)
      .map((r) => ({ ...enrich("contracts", r), projectName: byCode("projects", r.project)?.name || "" }))
      .sort((a, b) => String(b.start).localeCompare(String(a.start)));
    out.statusAutomatic = isStatusAutomatic(row.code);
    out.notes = noteList(row.code);
  }

  if (tableName === "crews") {
    out.project = byCode("projects", row.project);
    out.leader = db.findRow("employees", (p) => p.code === row.leader);
    out.calc = crewCalc(row);
    out.members = crewMembers(row.code).map(personSummary);
    out.equipment = crewEquipment(row.code).map(eq);
    out.personalEquipment = out.members.flatMap((m) => personalEquipment(m.code)).map(eq);
  }

  if (tableName === "projects") {
    out.client = byCode("clients", row.client);
    out.crews = projectCrews(row.code).map((c) => {
      const members = crewMembers(c.code);
      return {
        ...enrich("crews", c),
        calc: crewCalc(c),
        members: members.map(personSummary),
        equipment: crewEquipment(c.code).map(eq),
        personalEquipment: members.flatMap((m) => personalEquipment(m.code)).map(eq),
      };
    });
    out.houses = db.table("houses")
      .filter((h) => h.project === row.code || houseResidents(h.code).some((p) => projectOf(p) === row.code))
      .map((h) => ({ ...enrich("houses", h), calc: houseCalc(h), residents: houseResidents(h.code).map(personSummary) }));
    out.cost = projectCost(row.code);
  }

  if (tableName === "houses") {
    out.project = byCode("projects", row.project);
    out.calc = houseCalc(row);
    out.residents = houseResidents(row.code).map((p) => ({ ...personSummary(p), project: projectOf(p) }));
    const shares = {};
    for (const p of out.residents) {
      const k = p.project || "—";
      shares[k] = shares[k] || { project: k, name: byCode("projects", p.project)?.name || "No project", people: 0, amount: 0 };
      shares[k].people += 1;
      shares[k].amount = round(shares[k].amount + out.calc.rentPerPerson);
    }
    out.rentShares = Object.values(shares);
  }

  return out;
}
