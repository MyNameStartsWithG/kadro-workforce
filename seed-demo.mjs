/**
 * Demo data: adds records to a running Kadro (default http://127.0.0.1:4360) through the API.
 * Existing records are not touched; this adds on top. Records are processed as if entered by hand
 * (codes, folders, pay history and cash rows are produced by the system itself).
 *
 *   node seed-demo.mjs            → adds to the Kadro on port 4360
 *   node seed-demo.mjs 4370       → adds to a Kadro on another port (e.g. one with a test folder)
 *
 * Dates were chosen relative to 9 October 2026: past, critical (≤15 days), upcoming (≤60 days) and distant dates mixed.
 * It expects one project, crew, house and client to exist already (the first of each is used).
 */
const PORT = process.argv[2] || 4360;
const API = `http://127.0.0.1:${PORT}/api`;

async function j(route, method = "GET", body) {
  const r = await fetch(API + route, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const v = await r.json();
  if (!r.ok) throw new Error(`${method} ${route}: ${v.error}`);
  return v;
}
const add = async (table, row) => (await j(`/table/${table}`, "POST", row)).row;
const update = async (table, id, fields) => (await j(`/table/${table}/${id}`, "PUT", fields)).row;

const current = await j("/status");
console.log(`Kadro ${current.version} · ${current.counts.employees} employees, ${current.counts.projects} projects`);
const oldEmployees = (await j("/table/employees")).rows;
if (oldEmployees.length + 13 > 15) throw new Error(`There are already ${oldEmployees.length} employees; adding 13 more would go over 15.`);
if (oldEmployees.some((p) => p.name === "Mehmet Kaya")) throw new Error("The demo data seems to be there already.");
const projectCode = (await j("/table/projects")).rows[0]?.code;   // the first project (e.g. Serbia-1)
const crewCode = (await j("/table/crews")).rows[0]?.code;         // the first crew
const houseCode = (await j("/table/houses")).rows[0]?.code;       // the first house
const clientCode = (await j("/table/clients")).rows[0]?.code;     // the first client

/* ---------------- clients and projects ---------------- */
console.log("— clients, projects");
const c2 = await add("clients", { name: "Hotel Vojvodina d.o.o.", contact: "Milan Petrović", phone: "+381 21 555 0101", email: "milan@hotelvojvodina.rs", country: "Serbia", taxNo: "108765432", address: "Bulevar Oslobođenja 12, Novi Sad", status: "Active" });
const c3 = await add("clients", { name: "Marmara Gıda A.Ş.", contact: "Ayla Karaca", phone: "0216 555 44 33", email: "ayla.karaca@marmaragida.com.tr", country: "Turkey", taxNo: "6120456789", address: "Tuzla OSB 3. Cad. No:8, Istanbul", status: "Active" });

const P2 = await add("projects", { name: "Novi Sad Hotel Electrical", client: c2.code, location: "Novi Sad", start: "2026-06-01", end: "2027-06-30", contractValue: "1200000", currency: "EUR", siteManager: "Murat Aydın", status: "In progress" });
const P3 = await add("projects", { name: "Istanbul Factory Automation", client: c3.code, location: "Tuzla, Istanbul", start: "2026-09-01", end: "2026-10-25", contractValue: "18500000", currency: "TRY", siteManager: "Kemal Yılmaz", status: "In progress" });
await add("projects", { name: "Belgrade Mall Maintenance", client: clientCode, location: "Belgrade", start: "2025-03-01", end: "2026-07-31", contractValue: "250000", currency: "EUR", siteManager: "Murat Aydın", status: "Completed" });
await add("projects", { name: "Niš Logistics Warehouse (bid)", client: c2.code, location: "Niš", start: "2027-01-15", end: "2027-09-30", contractValue: "480000", currency: "EUR", siteManager: "Murat Aydın", status: "Bid" });

/* ---------------- crews ---------------- */
console.log("— crews");
const E2 = await add("crews", { name: "Novi Sad Electrical", project: P2.code, mealDaily: "1200", mealCurrency: "RSD", status: "Active", notes: "Meals are paid in Serbian dinars" });
const E3 = await add("crews", { name: "Novi Sad Mechanical", project: P2.code, mealDaily: "11", mealCurrency: "EUR", status: "Active" });
const E4 = await add("crews", { name: "Istanbul Installation", project: P3.code, mealDaily: "450", mealCurrency: "TRY", status: "Active" });

/* ---------------- houses (type in the name and the note) ---------------- */
console.log("— houses");
const H2 = await add("houses", { name: "Novi Sad Flat 3+1", project: P2.code, country: "Serbia", city: "Novi Sad", address: "Futoška 45, 3rd floor", beds: "5", rent: "900", currency: "EUR", leaseEnd: "2026-10-20", landlord: "Dragana Ilić", landlordPhone: "+381 63 111 2233", status: "Active", notes: "Type: 3+1 flat. The lease ends in 11 days" });
const H3 = await add("houses", { name: "Novi Sad Detached House", project: P2.code, country: "Serbia", city: "Novi Sad", address: "Sremska 7, Petrovaradin", beds: "2", rent: "95000", currency: "RSD", leaseEnd: "2027-09-01", landlord: "Zoran Jovanović", landlordPhone: "+381 64 222 3344", status: "Active", notes: "Type: detached house with a garden. 2 beds but 3-4 people live there: over capacity (test)" });
await add("houses", { name: "Belgrade Studio 1+1", project: projectCode, country: "Serbia", city: "Belgrade", address: "Knez Mihailova 20, flat 4", beds: "2", rent: "650", currency: "EUR", leaseEnd: "2026-09-30", landlord: "Ana Marković", landlordPhone: "+381 65 333 4455", status: "Active", notes: "Type: short-let studio. Empty now; the lease has ended" });
await add("houses", { name: "Novi Sad Container Camp", project: P2.code, country: "Serbia", city: "Novi Sad", address: "Site area", beds: "8", rent: "300", currency: "EUR", leaseEnd: "2026-05-31", landlord: "—", status: "Vacated", notes: "Type: site container. Vacated; rent is no longer written" });

/* ---------------- employees: 13 people ---------------- */
console.log("— employees");
const permits = (work, residence, passport) => ({ workPermitExpiry: work, residencePermitExpiry: residence, passportExpiry: passport });
const people = [
  // long term, monthly
  { name: "Murat Aydın", role: "Crew Leader", department: "Field", crew: E2.code, house: H2.code, payType: "Monthly", pay: "2400", currency: "EUR", phone: "+381 60 100 0001", startDate: "2017-01-10", ...permits("2028-01-10", "2028-01-10", "2032-05-20"), iban: "TR33 0006 1005 1978 6457 8413 26", notes: "Long term. Novi Sad crew leader" },
  { name: "Mehmet Kaya", role: "Master Electrician", department: "Field", crew: E2.code, house: H2.code, payType: "Monthly", pay: "1800", currency: "EUR", phone: "+381 60 100 0002", startDate: "2019-04-15", ...permits("2027-04-15", "2027-04-15", "2031-02-10"), notes: "Long term" },
  { name: "Oğuz Koç", role: "Master Mechanic", department: "Field", crew: E3.code, house: H3.code, payType: "Monthly", pay: "1700", currency: "EUR", phone: "+381 60 100 0003", startDate: "2022-09-12", ...permits("2027-09-12", "2027-09-12", "2030-08-01"), notes: "Worked a few days in the Electrical crew in the 2nd half of September" },
  { name: "Emre Şahin", role: "Plumber", department: "Field", crew: E3.code, house: H3.code, payType: "Monthly", pay: "160000", currency: "RSD", phone: "+381 60 100 0004", startDate: "2023-02-20", ...permits("2027-02-20", "2027-02-20", "2029-11-15"), notes: "Paid in dinars" },
  { name: "Kemal Yılmaz", role: "Automation Technician", department: "Field", crew: E4.code, payType: "Monthly", pay: "65000", currency: "TRY", phone: "0532 100 00 05", startDate: "2020-03-02", iban: "TR12 0001 2009 4520 0058 0012 34", notes: "Works in Turkey; no permit needed" },
  // long term, hourly
  { name: "Hasan Çelik", role: "Welder", department: "Field", crew: E3.code, house: H3.code, payType: "Hourly", pay: "11", currency: "EUR", phone: "+381 60 100 0006", startDate: "2021-06-01", ...permits("2026-11-30", "2026-11-30", "2026-09-30"), notes: "Passport expired, being renewed. Work permit ends in 52 days" },
  { name: "Serkan Arslan", role: "Electrician", department: "Field", crew: E2.code, house: H2.code, payType: "Hourly", pay: "10", currency: "EUR", phone: "+381 60 100 0007", startDate: "2024-05-06", ...permits("2026-10-12", "2026-10-12", "2033-03-03"), notes: "Work permit ends in 3 days (critical)" },
  { name: "Cem Polat", role: "Electrician", department: "Field", crew: crewCode, house: houseCode, payType: "Hourly", pay: "12", currency: "EUR", phone: "+381 60 100 0008", startDate: "2025-02-03", ...permits("2027-02-03", "2027-02-03", "2034-07-07") },
  { name: "Volkan Demir", role: "Fitter", department: "Field", crew: E4.code, payType: "Hourly", pay: "380", currency: "TRY", phone: "0533 100 00 09", startDate: "2025-11-17", status: "On leave", notes: "On annual leave (2nd half of September)" },
  // short term
  { name: "Ali Yıldız", role: "Electrician", department: "Field", crew: E2.code, house: H2.code, payType: "Hourly", pay: "9.5", currency: "EUR", phone: "+381 60 100 0010", startDate: "2026-09-14", ...permits("2026-12-14", "2026-12-14", "2030-01-20"), notes: "Short term: 3-month contract (14/09–14/12)" },
  { name: "Burak Öztürk", role: "Helper", department: "Field", crew: E3.code, house: H3.code, payType: "Hourly", pay: "950", currency: "RSD", phone: "+381 60 100 0011", startDate: "2026-08-25", ...permits("2026-11-25", "2026-11-25", "2029-04-04"), notes: "Short term. Left on 5 October" },
  { name: "Selin Aksoy", role: "PLC Programmer", department: "Field", crew: E4.code, payType: "Hourly", pay: "520", currency: "TRY", phone: "0534 100 00 12", startDate: "2026-09-01", notes: "Short term: only for the Istanbul project" },
  { name: "Tolga Er", role: "Helper", department: "Field", crew: crewCode, house: houseCode, payType: "Monthly", pay: "1100", currency: "EUR", phone: "+381 60 100 0013", startDate: "2026-11-02", ...permits("2027-11-02", "2027-11-02", "2036-01-01"), notes: "Not started yet: starts on 2 November (shows in the forecast from November)" },
];
const K = {};
for (const k of people) K[k.name] = await add("employees", { status: "Active", ...k });
await update("crews", E2._id, { leader: K["Murat Aydın"].code });
await update("crews", E3._id, { leader: K["Oğuz Koç"].code });
await update("crews", E4._id, { leader: K["Kemal Yılmaz"].code });
// A raise for the pay history: Mehmet 1700 → 1800 (applies to new periods).
await update("employees", K["Mehmet Kaya"]._id, { pay: "1700" });
await update("employees", K["Mehmet Kaya"]._id, { pay: "1800" });

/* ---------------- vehicles and equipment ---------------- */
console.log("— vehicles, equipment");
await add("vehicles", { plate: "NS 123-AB", make: "Renault", model: "Master", year: "2021", type: "Van", inspectionExpiry: "2026-10-30", cascoExpiry: "2027-03-01", liabilityExpiry: "2026-10-15", lastServiceKm: "84000", currentKm: "91200", driver: "Murat Aydın", status: "Active" });
await add("vehicles", { plate: "34 KDR 034", make: "Fiat", model: "Doblo", year: "2023", type: "Pickup", inspectionExpiry: "2027-06-01", cascoExpiry: "2026-09-20", liabilityExpiry: "2027-06-01", lastServiceKm: "30000", currentKm: "38500", driver: "Kemal Yılmaz", status: "Active" });
const eq = (x) => add("equipment", { quantity: "1", status: "Issued", ...x });
await eq({ ownerType: "Crew", crewCode: E2.code, item: "Hilti TE 30 rotary hammer", category: "Hand tool", serialNo: "HT-30-55821", issuedDate: "2026-06-03" });
await eq({ ownerType: "Crew", crewCode: E2.code, item: "Fluke 1664 FC installation tester", category: "Measuring device", serialNo: "FL-1664-0098", issuedDate: "2026-06-03" });
await eq({ ownerType: "Crew", crewCode: E3.code, item: "Lincoln 200A welding machine", category: "Hand tool", serialNo: "LN-200-7781", issuedDate: "2026-06-10" });
await eq({ ownerType: "Crew", crewCode: E4.code, item: "Laptop (with PLC software)", category: "Computer", serialNo: "DL-5540-1120", issuedDate: "2026-09-01" });
await eq({ ownerType: "Crew", crewCode: crewCode, item: "Mobile scaffold", category: "Other", quantity: "2", issuedDate: "2026-08-15" });
await eq({ ownerType: "Person", employeeCode: K["Murat Aydın"].code, item: "Company phone Samsung A54", category: "Phone", serialNo: "IMEI 3567…0012", issuedDate: "2026-01-05" });
await eq({ ownerType: "Person", employeeCode: K["Kemal Yılmaz"].code, item: "Laptop Lenovo T14", category: "Computer", serialNo: "LN-T14-8890", issuedDate: "2024-02-01" });
await eq({ ownerType: "Person", employeeCode: K["Hasan Çelik"].code, item: "Welding mask", category: "PPE", issuedDate: "2026-06-10", status: "Damaged", notes: "Cracked glass, to be replaced" });
await eq({ ownerType: "Person", employeeCode: K["Burak Öztürk"].code, item: "Helmet + safety harness", category: "PPE", issuedDate: "2026-08-25", returnedDate: "2026-10-05", status: "Returned" });

/* ---------------- advances (go into the cash book by themselves) ---------------- */
console.log("— advances");
const advance = (name, date, amount, currency, description = "") => add("advances", { employeeCode: K[name]?.code || name, date, amount, currency, description });
await advance("Emre Şahin", "2026-09-05", "20000", "RSD", "Household goods");
await advance("Kemal Yılmaz", "2026-09-10", "10000", "TRY");
await advance(oldEmployees.find((p) => p.payType === "Monthly")?.code || oldEmployees[0].code, "2026-09-12", "5000", "TRY", "Before the holiday");
await advance("Ali Yıldız", "2026-09-20", "200", "EUR", "First month");
await advance("Selin Aksoy", "2026-10-03", "5000", "TRY");
await advance("Hasan Çelik", "2026-10-06", "150", "EUR", "Passport fee");

/* ---------------- timesheets ---------------- */
console.log("— timesheets");
// crew → how many hours it works on Saturday (overtime)
const saturday = { [E2.code]: 6, [E3.code]: 5, [E4.code]: 0, [crewCode]: 4 };
const everyone = () => [...Object.values(K), ...oldEmployees];
async function fill(period, { lastDay = "9999", except = () => null } = {}) {
  const p = await j(`/timesheet/${period}`, "POST");
  // People who have not started yet are removed from the period.
  for (const s of p.record.rows) {
    const person = everyone().find((x) => x.code === s.employeeCode);
    if (person?.startDate && person.startDate > p.days.at(-1).day) await j(`/timesheet/${period}/row/${s.employeeCode}`, "DELETE");
  }
  const now = await j(`/timesheet/${period}`);
  const changes = [];
  for (const s of now.record.rows) {
    const person = everyone().find((x) => x.code === s.employeeCode);
    for (const g of now.days) {
      if (g.day > lastDay) continue;
      const type = now.record.days[g.day];
      let value = type === "normal" ? "8" : type === "overtime" ? String(saturday[s.crew] || 0 || "") : "";
      if (value === "0") value = "";
      if (person?.startDate && g.day < person.startDate) value = "";
      const special = except(person?.name || s.name, g.day, type);
      if (special !== null) value = special;
      if (value) changes.push({ employeeCode: s.employeeCode, day: g.day, value });
    }
  }
  await j(`/timesheet/${period}/cells`, "PUT", { changes });
  return now;
}

// September 1st half: Hasan 2 days sick, Emre 1 day on leave, Burak absent 2 days, Mehmet 10 hours one day.
await fill("2026-09-1", {
  except: (name, day) => ({
    "Hasan Çelik|2026-09-08": "S", "Hasan Çelik|2026-09-09": "S",
    "Emre Şahin|2026-09-11": "L",
    "Burak Öztürk|2026-09-03": "–", "Burak Öztürk|2026-09-04": "–",
    "Mehmet Kaya|2026-09-10": "10",
  })[`${name}|${day}`] ?? null,
});
// September 2nd half: Volkan on leave the whole period, Ali 6 hours one day, Oğuz in the Electrical crew on 21–25 September.
await fill("2026-09-2", {
  except: (name, day, type) => {
    if (name === "Volkan Demir") return type === "normal" ? "L" : "";
    return ({ "Ali Yıldız|2026-09-17": "6", "Serkan Arslan|2026-09-29": "–" })[`${name}|${day}`] ?? null;
  },
});
await j("/timesheet/2026-09-2/crew-days", "PUT", { employeeCode: K["Oğuz Koç"].code, days: ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"], crew: E2.code });
await j("/timesheet/2026-09-2/settings", "PUT", { settings: { overtimeMultiplier: 1.5 } });
for (const d of ["2026-09-1", "2026-09-2"]) {
  const r = await j(`/timesheet/${d}/close`, "POST");
  console.log(`   ${d} closed · ${r.cash.added} rows into the cash book · ${r.file || r.fileError}`);
}

// Burak left on 5 October; October 1st half opens without him and is filled up to 8 October (this period stays open).
await update("employees", K["Burak Öztürk"]._id, { status: "Left" });
await update("employees", K["Volkan Demir"]._id, { status: "Active", notes: "Was on annual leave in the 2nd half of September" });
await fill("2026-10-1", {
  lastDay: "2026-10-08",
  except: (name, day) => ({ "Selin Aksoy|2026-10-06": "S", "Cem Polat|2026-10-02": "10" })[`${name}|${day}`] ?? null,
});

/* ---------------- cash: income / expenses by hand ---------------- */
console.log("— cash");
const cash = (x) => add("cash", { recurring: "No", ...x });
await cash({ date: "2026-09-15", type: "Income", category: "Progress billing / Invoice", description: "Progress bill #4 — Hotel Vojvodina", project: P2.code, amount: "85000", currency: "EUR", recurring: "Yes" });
await cash({ date: "2026-09-30", type: "Income", category: "Progress billing / Invoice", description: "Progress bill #1 — Marmara Gıda", project: P3.code, amount: "2750000", currency: "TRY" });
await cash({ date: "2026-10-05", type: "Income", category: "Progress billing / Invoice", description: "Serbia-1 interim progress bill", project: projectCode, amount: "1500000", currency: "TRY" });
await cash({ date: "2026-09-01", type: "Expense", category: "Other expense", description: "Belgrade office rent", amount: "1200", currency: "EUR", recurring: "Yes" });
await cash({ date: "2026-09-10", type: "Expense", category: "Utilities (power, water, internet)", description: "Office internet (SBB)", amount: "3500", currency: "RSD", recurring: "Yes" });
await cash({ date: "2026-09-08", type: "Expense", category: "Fuel", description: "Renault Master fuel", project: P2.code, amount: "180", currency: "EUR" });
await cash({ date: "2026-09-18", type: "Expense", category: "Materials", description: "NYM cable 3x2.5 — 2000 m", project: P2.code, amount: "4200", currency: "EUR" });
await cash({ date: "2026-09-26", type: "Expense", category: "Tax / social security", description: "September social security contributions", amount: "85000", currency: "TRY", recurring: "Yes" });
await cash({ date: "2026-10-02", type: "Expense", category: "Transport", description: "Istanbul–Belgrade flights (2 people)", project: projectCode, amount: "380", currency: "EUR" });
await cash({ date: "2026-11-10", type: "Expense", category: "Materials", description: "PLC panel (planned purchase)", project: P3.code, amount: "320000", currency: "TRY" });

const done = await j("/status");
console.log("\nDone:", JSON.stringify(done.counts));
console.log(`Warning list: ${(await j("/warnings")).length} records (on the Dashboard)`);
