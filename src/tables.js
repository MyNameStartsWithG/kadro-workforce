/**
 * Column definitions for the spreadsheet-like tables.
 * The editable grid in the UI, .xlsx import/export and expiry warnings are all
 * generated from these definitions. To add a column, add a line here.
 *
 *   type     : text | date | number | money | select | link | readonly
 *   computed : the readonly value is not stored; relations.js computes it on every read
 *   detail   : rows of the table have a detail page (#d/table/id)
 *   warnDays : days — a warning is raised when this date is this many days away
 *   width    : column width in the UI (pixels)
 */

export const CURRENCIES = ["EUR", "TRY", "RSD"];

/** Period the rent is entered for. Daily rent = rent × F ÷ 365 (F: monthly 12, weekly 52, daily 365). */
export const RENT_PERIODS = ["Monthly", "Weekly", "Daily"];

/** Cash categories. Salary, Advance, Meals and Rent are also used by automatic rows. */
export const CASH_CATEGORIES = [
  "Progress billing / Invoice", "Advance repayment", "Other income",
  "Salary", "Advance", "Meals", "Rent",
  "Fuel", "Transport", "Materials", "Utilities (power, water, internet)", "Tax / social security", "Other expense",
];

export const TABLES = {
  employees: {
    name: "Employees",
    singular: "employee",
    icon: "◉",
    description: "Each row opens an employee folder with 15 sub-folders on disk. Pay changes only apply to timesheet periods opened afterwards.",
    folderType: "employee",
    detail: true,
    columns: [
      { key: "code", label: "Employee Code", type: "readonly", width: 130, hint: "KDR-YEAR-SEQ — assigned automatically" },
      { key: "name", label: "Full Name", type: "text", width: 180, required: true },
      { key: "role", label: "Role", type: "text", width: 150 },
      { key: "department", label: "Department", type: "select", width: 130, options: ["Field", "Workshop", "Office", "Management", "Accounting", "Warehouse"] },
      { key: "crew", label: "Crew", type: "link", width: 170, source: "crews" },
      { key: "house", label: "House", type: "link", width: 170, source: "houses" },
      { key: "payType", label: "Pay Type", type: "select", width: 115, options: ["Monthly", "Hourly"] },
      { key: "pay", label: "Pay (monthly / hourly)", type: "money", width: 160 },
      { key: "currency", label: "Currency", type: "select", width: 105, options: CURRENCIES, default: "EUR" },
      { key: "overtimeRate", label: "Overtime Rate (hourly)", type: "money", width: 160, hint: "If empty, the timesheet period's rate for the currency is used" },
      { key: "phone", label: "Phone", type: "text", width: 130 },
      { key: "startDate", label: "Start Date", type: "date", width: 115 },
      { key: "insuranceStart", label: "Insurance Start", type: "date", width: 125 },
      { key: "workPermitExpiry", label: "Work Permit Expiry", type: "date", width: 145, warnDays: 60 },
      { key: "residencePermitExpiry", label: "Residence Permit Expiry", type: "date", width: 165, warnDays: 60 },
      { key: "passportExpiry", label: "Passport Expiry", type: "date", width: 130, warnDays: 90 },
      { key: "iban", label: "IBAN", type: "text", width: 190 },
      { key: "status", label: "Status", type: "select", width: 110, options: ["Active", "On leave", "Left"], default: "Active",
        hint: "Computed from today's date for people with employment periods" },
      // Notes live in their own panel (src/notes.js); an old "notes" field is moved there once.
    ],
  },

  contracts: {
    name: "Employment Periods",
    singular: "employment period",
    icon: "⇥",
    description: "Between which dates, on which project a person works (contract). The end date is the leaving date and can be entered in advance; " +
      "after that day the person drops out of timesheets and the forecast and their status becomes Left by itself. A leave record only sets the status to On leave.",
    columns: [
      { key: "employeeCode", label: "Employee", type: "link", width: 200, source: "employees", required: true },
      { key: "employeeName", label: "Full Name", type: "readonly", width: 160, computed: true },
      { key: "type", label: "Type", type: "select", width: 100, options: ["Work", "Leave"], default: "Work" },
      { key: "project", label: "Project", type: "link", width: 190, source: "projects" },
      { key: "start", label: "Start", type: "date", width: 120, required: true },
      { key: "end", label: "End (leaving date)", type: "date", width: 145, warnDays: 30, hint: "Leave empty for an open-ended period" },
      { key: "statusLabel", label: "Status", type: "readonly", width: 110, computed: true, badge: true },
      { key: "notes", label: "Notes", type: "text", width: 220 },
    ],
  },

  equipment: {
    name: "Equipment",
    singular: "equipment record",
    icon: "▣",
    description: "Who holds what. Equipment is issued to a crew or to a person; crew equipment shows up on the crew's project.",
    columns: [
      { key: "ownerType", label: "Owner Type", type: "select", width: 110, options: ["Person", "Crew"], default: "Person" },
      { key: "employeeCode", label: "Employee", type: "link", width: 170, source: "employees" },
      { key: "crewCode", label: "Crew", type: "link", width: 160, source: "crews" },
      { key: "ownerName", label: "Holder", type: "readonly", width: 160, computed: true },
      { key: "item", label: "Item", type: "text", width: 200, required: true },
      { key: "category", label: "Category", type: "select", width: 140, options: ["Hand tool", "Measuring device", "Computer", "Phone", "Vehicle", "PPE", "Other"] },
      { key: "serialNo", label: "Serial No", type: "text", width: 150 },
      { key: "quantity", label: "Qty", type: "number", width: 70, default: 1 },
      { key: "issuedDate", label: "Issued", type: "date", width: 125 },
      { key: "returnedDate", label: "Returned", type: "date", width: 125 },
      { key: "status", label: "Status", type: "select", width: 120, options: ["Issued", "Returned", "Damaged", "Lost"], default: "Issued" },
      { key: "notes", label: "Notes", type: "text", width: 200 },
    ],
  },

  crews: {
    name: "Crews",
    singular: "crew",
    icon: "◎",
    description: "Employees are assigned to crews, crews to projects. The meal amount is per person per day; crew totals are computed automatically.",
    detail: true,
    columns: [
      { key: "code", label: "Crew No", type: "readonly", width: 90, hint: "CRW-01 — assigned automatically" },
      { key: "name", label: "Crew Name", type: "text", width: 170, required: true },
      { key: "leader", label: "Crew Leader", type: "link", width: 180, source: "employees" },
      { key: "project", label: "Project", type: "link", width: 190, source: "projects" },
      { key: "headcount", label: "People", type: "readonly", width: 60, computed: true },
      { key: "mealDaily", label: "Meals (per person/day)", type: "money", width: 160 },
      { key: "mealCurrency", label: "Meal Currency", type: "select", width: 130, options: CURRENCIES, default: "EUR" },
      { key: "mealCrewDaily", label: "Crew Meals / Day", type: "readonly", width: 135, computed: true },
      { key: "mealCrewPeriod", label: "Crew Meals / 15 Days", type: "readonly", width: 150, computed: true },
      { key: "status", label: "Status", type: "select", width: 110, options: ["Active", "Inactive"], default: "Active" },
      { key: "notes", label: "Notes", type: "text", width: 200 },
    ],
  },

  vehicles: {
    name: "Vehicles",
    singular: "vehicle",
    icon: "▤",
    description: "Each row opens a folder named after the plate under 05 - Vehicles.",
    folderType: "vehicle",
    columns: [
      { key: "plate", label: "Plate", type: "text", width: 120, required: true },
      { key: "make", label: "Make", type: "text", width: 120 },
      { key: "model", label: "Model", type: "text", width: 120 },
      { key: "year", label: "Year", type: "number", width: 70 },
      { key: "type", label: "Type", type: "select", width: 120, options: ["Car", "Van", "Pickup", "Truck", "Machinery"] },
      { key: "inspectionExpiry", label: "Inspection Expiry", type: "date", width: 140, warnDays: 45 },
      { key: "cascoExpiry", label: "Casco Expiry", type: "date", width: 125, warnDays: 30 },
      { key: "liabilityExpiry", label: "Liability Ins. Expiry", type: "date", width: 150, warnDays: 30 },
      { key: "lastServiceKm", label: "Last Service (km)", type: "number", width: 130 },
      { key: "currentKm", label: "Current km", type: "number", width: 110 },
      { key: "driver", label: "Driver", type: "text", width: 150 },
      { key: "status", label: "Status", type: "select", width: 110, options: ["Active", "In service", "Sold"], default: "Active" },
    ],
  },

  projects: {
    name: "Projects",
    singular: "project",
    icon: "◈",
    description: "Each row opens a project folder with 8 sections under 03 - Projects. The detail page shows crews, people, equipment and houses.",
    folderType: "project",
    detail: true,
    columns: [
      { key: "code", label: "Project Code", type: "readonly", width: 130 },
      { key: "name", label: "Project Name", type: "text", width: 200, required: true },
      { key: "client", label: "Client", type: "link", width: 170, source: "clients" },
      { key: "location", label: "Location", type: "text", width: 140 },
      { key: "start", label: "Start", type: "date", width: 115 },
      { key: "end", label: "End", type: "date", width: 115, warnDays: 30 },
      { key: "contractValue", label: "Contract Value", type: "money", width: 150 },
      { key: "currency", label: "Currency", type: "select", width: 110, options: ["EUR", "RSD", "TRY", "USD"], default: "EUR" },
      { key: "siteManager", label: "Site Manager", type: "text", width: 150 },
      { key: "crewCount", label: "Crews", type: "readonly", width: 60, computed: true },
      { key: "headcount", label: "People", type: "readonly", width: 60, computed: true },
      { key: "status", label: "Status", type: "select", width: 120, options: ["Bid", "In progress", "Completed", "Archived"], default: "In progress" },
    ],
  },

  houses: {
    name: "Houses",
    singular: "house",
    icon: "⌂",
    description: "Accommodation abroad. Each house opens a folder under 09 - Accommodation. Rent is split by the number of people living in the house and charged " +
      "to each person's project; for a day a person does not come to work, their daily share of rent is deducted from their pay.",
    folderType: "house",
    detail: true,
    columns: [
      { key: "code", label: "House No", type: "readonly", width: 80, hint: "HSE-01 — assigned automatically" },
      { key: "name", label: "House Name", type: "text", width: 160, required: true },
      { key: "project", label: "Project", type: "link", width: 190, source: "projects" },
      { key: "country", label: "Country", type: "select", width: 110, options: ["Serbia", "Turkey", "Other"], default: "Serbia" },
      { key: "city", label: "City", type: "text", width: 120 },
      { key: "address", label: "Address", type: "text", width: 220 },
      { key: "beds", label: "Beds", type: "number", width: 70 },
      { key: "occupancy", label: "Occupancy", type: "readonly", width: 90, computed: true },
      { key: "rent", label: "Rent", type: "money", width: 110 },
      { key: "rentPeriod", label: "Rent Period", type: "select", width: 115, options: RENT_PERIODS, default: "Monthly" },
      { key: "currency", label: "Currency", type: "select", width: 105, options: CURRENCIES, default: "EUR" },
      { key: "rentPerPerson", label: "Rent per Person (monthly)", type: "readonly", width: 170, computed: true },
      { key: "rentPerPersonDaily", label: "Per Person per Day", type: "readonly", width: 140, computed: true },
      { key: "leaseEnd", label: "Lease End", type: "date", width: 120, warnDays: 30 },
      { key: "landlord", label: "Landlord", type: "text", width: 150 },
      { key: "landlordPhone", label: "Landlord Phone", type: "text", width: 130 },
      { key: "status", label: "Status", type: "select", width: 115, options: ["Active", "Vacated"], default: "Active" },
      { key: "notes", label: "Notes", type: "text", width: 200 },
    ],
  },

  clients: {
    name: "Clients",
    singular: "client",
    icon: "◇",
    description: "Each row opens a client folder with 4 sections under 07 - Clients.",
    folderType: "client",
    columns: [
      { key: "code", label: "Client Code", type: "readonly", width: 130 },
      { key: "name", label: "Company Name", type: "text", width: 210, required: true },
      { key: "contact", label: "Contact Person", type: "text", width: 150 },
      { key: "phone", label: "Phone", type: "text", width: 130 },
      { key: "email", label: "Email", type: "text", width: 180 },
      { key: "country", label: "Country", type: "select", width: 110, options: ["Serbia", "Turkey", "Other"], default: "Serbia" },
      { key: "taxNo", label: "Tax / PIB No", type: "text", width: 130 },
      { key: "address", label: "Address", type: "text", width: 220 },
      { key: "status", label: "Status", type: "select", width: 110, options: ["Active", "Inactive"], default: "Active" },
    ],
  },

  advances: {
    name: "Advances",
    singular: "advance",
    icon: "↧",
    description: "Advances paid out. Each one appears in the timesheet period of its date and is deducted from the month-end pay.",
    columns: [
      { key: "date", label: "Date", type: "date", width: 125, required: true },
      { key: "employeeCode", label: "Employee", type: "link", width: 200, source: "employees", required: true },
      { key: "employeeName", label: "Full Name", type: "readonly", width: 160, computed: true },
      { key: "amount", label: "Amount", type: "money", width: 120, required: true },
      { key: "currency", label: "Currency", type: "select", width: 105, options: CURRENCIES, default: "EUR" },
      { key: "period", label: "Timesheet Period", type: "readonly", width: 200, computed: true },
      { key: "description", label: "Description", type: "text", width: 240 },
    ],
  },

  cash: {
    name: "Cash",
    singular: "cash entry",
    icon: "₺",
    description: "Income and expenses. The system writes the advance, salary, meal and rent rows itself; a row corrected by hand is never overwritten again.",
    columns: [
      { key: "date", label: "Date", type: "date", width: 125, required: true },
      { key: "type", label: "Type", type: "select", width: 100, options: ["Income", "Expense"], default: "Expense", required: true },
      { key: "category", label: "Category", type: "select", width: 175, options: CASH_CATEGORIES },
      { key: "amount", label: "Amount", type: "money", width: 115, required: true },
      { key: "currency", label: "Currency", type: "select", width: 95, options: CURRENCIES, default: "EUR" },
      { key: "statusLabel", label: "Status", type: "readonly", width: 130, computed: true, badge: true },
      { key: "description", label: "Description", type: "text", width: 270 },
      { key: "project", label: "Project", type: "link", width: 180, source: "projects" },
      { key: "employeeCode", label: "Employee", type: "link", width: 170, source: "employees" },
      { key: "systemAmount", label: "System's Figure", type: "readonly", width: 130, computed: true },
      { key: "recurring", label: "Repeats Monthly", type: "select", width: 125, options: ["No", "Yes"], default: "No" },
      { key: "source", label: "Source", type: "readonly", width: 85 },
    ],
  },

  documents: {
    name: "Document Register",
    singular: "document record",
    icon: "▦",
    description: "A record of every file that entered the system. Not editable — read and export only. Deleted documents are noted in the Status column.",
    readOnly: true,
    columns: [
      { key: "date", label: "Date", type: "readonly", width: 150 },
      { key: "fileName", label: "File Name", type: "readonly", width: 240 },
      { key: "targetPath", label: "Filed Under", type: "readonly", width: 340 },
      { key: "docType", label: "Document Type", type: "readonly", width: 150 },
      { key: "related", label: "Related Person / Record", type: "readonly", width: 180 },
      { key: "method", label: "Method", type: "readonly", width: 110 },
      { key: "confidence", label: "Confidence", type: "readonly", width: 90 },
      { key: "size", label: "Size", type: "readonly", width: 90 },
      { key: "status", label: "Status", type: "readonly", width: 230 },
    ],
  },
};

/** Code generation: KDR-2026-0001, PRJ-2026-0007, CLI-2026-0003; short ones for crews and houses: CRW-01, HSE-01 */
export const CODE_PREFIX = { employees: "KDR", projects: "PRJ", clients: "CLI" };
const SHORT_PREFIX = { crews: "CRW", houses: "HSE" };

/** Tables whose code is assigned automatically. */
export const CODED = ["employees", "projects", "clients", "crews", "houses"];

export function nextCode(table, rows) {
  if (SHORT_PREFIX[table]) {
    const pattern = new RegExp(`^${SHORT_PREFIX[table]}-(\\d+)$`);
    const highest = Math.max(0, ...rows.map((r) => Number(pattern.exec(r.code || "")?.[1] || 0)));
    return `${SHORT_PREFIX[table]}-${String(highest + 1).padStart(2, "0")}`;
  }
  const prefix = CODE_PREFIX[table];
  if (!prefix) return null;
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^${prefix}-${year}-(\\d{4})$`);
  let highest = 0;
  for (const r of rows) {
    const m = pattern.exec(r.code || "");
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  }
  return `${prefix}-${year}-${String(highest + 1).padStart(4, "0")}`;
}
