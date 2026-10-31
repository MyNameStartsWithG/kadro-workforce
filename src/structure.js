/**
 * ACME ENGINEERING — folder structure definition.
 *
 * This file is the SINGLE SOURCE for the whole app. The folder tree, the directories
 * created on disk, the targets the AI may choose and the keywords of the rule engine
 * are all read from here.
 *
 * To add a folder: add a line in the right place, restart the app and press
 * "Build Folder Structure". Nothing else needs to change.
 *
 *   c        : folder code (prefixed to the folder name)
 *   n        : folder name
 *   d        : description — used in the UI and in AI prompts
 *   ch       : sub-folders
 *   keywords : words that point to this folder when they appear in a file name
 *   dynamic  : the contents of this folder come from a table (employee/project/vehicle/client/house)
 *   target   : if false, documents cannot be filed here (container only)
 */

/** The 15 folders created for every employee. */
export const EMPLOYEE_TEMPLATE = [
  { c: "01", n: "Identity", d: "ID card copy, civil registry record, proof of address.", keywords: ["identity", "id card", "licna karta", "kimlik", "proof of address"] },
  { c: "02", n: "Passport", d: "Passport main page; the expiry date is tracked.", keywords: ["passport", "pasos", "pasaport"] },
  { c: "03", n: "Employment Contract", d: "Signed contract, addenda and pay rise letters.", keywords: ["employment contract", "ugovor o radu", "contract", "addendum", "pay rise"] },
  { c: "04", n: "Work Permit", d: "Work permit application, approval and extension correspondence.", keywords: ["work permit", "radna dozvola", "permit application"] },
  { c: "05", n: "Residence Permit", d: "Residence permit documents; reminder 60 days before expiry.", keywords: ["residence permit", "boravak", "residence"] },
  { c: "06", n: "Payslips", d: "Monthly payslips. File names start with YEAR-MONTH.", keywords: ["payslip", "payroll", "salary", "obracun", "wage"] },
  { c: "07", n: "Bank Receipts", d: "Salary transfer receipts and IBAN notification.", keywords: ["receipt", "transfer", "wire", "iban", "payment receipt", "izvod"] },
  { c: "08", n: "Timesheets", d: "Monthly attendance and time sheets.", keywords: ["timesheet", "attendance", "time sheet", "overtime sheet"] },
  { c: "09", n: "Leave", d: "Annual leave, unpaid leave, sick notes and excuse forms.", keywords: ["leave form", "annual leave", "unpaid leave", "sick note", "medical report", "excuse"] },
  { c: "10", n: "Disciplinary", d: "Requests for statements, incident reports, warning letters.", keywords: ["disciplinary", "statement", "incident report", "warning letter"] },
  { c: "11", n: "Health & Safety", d: "Training attendance records, safety pledges, pre-employment medical report.", keywords: ["hse", "safety", "medical report", "training attendance", "safety pledge", "ppe"] },
  { c: "12", n: "Equipment", d: "Hand-over forms for tools, vehicles, phones and PPE.", keywords: ["equipment", "hand-over", "handover form", "asset"] },
  { c: "13", n: "Performance", d: "Appraisal forms, objectives, promotion notes.", keywords: ["performance", "appraisal", "promotion", "objective"] },
  { c: "14", n: "Photos", d: "Passport-size and staff card photos.", keywords: ["passport photo", "photo", "picture", "profile"] },
  { c: "15", n: "Leaving", d: "Release form, termination notice, severance and notice pay calculation.", keywords: ["release form", "leaving", "termination", "severance", "notice pay"] },
];

/** Standard sections created under every project folder. */
export const PROJECT_TEMPLATE = [
  { c: "01", n: "Contract", d: "Client contract, its annexes and bank guarantees.", keywords: ["contract", "ugovor", "guarantee"] },
  { c: "02", n: "Bid and Survey", d: "Bids, survey summaries, bills of quantities.", keywords: ["bid", "quotation", "survey", "bill of quantities", "ponuda"] },
  { c: "03", n: "Drawings", d: "Electrical designs, panel diagrams, revisions.", keywords: ["drawing", "layout", "diagram", "dwg", "plan", "revision"] },
  { c: "04", n: "Progress Billing", d: "Monthly progress billing files and approved summaries.", keywords: ["progress billing", "progress payment", "situacija"] },
  { c: "05", n: "Materials", d: "Material lists, delivery notes, shipping documents.", keywords: ["material", "delivery note", "shipment", "otpremnica"] },
  { c: "06", n: "Site Photos", d: "Before/after records from the site.", keywords: ["site", "site photo", "installation photo"] },
  { c: "07", n: "Correspondence", d: "Correspondence and minutes with the client and subcontractors.", keywords: ["correspondence", "minutes", "mail", "dopis"] },
  { c: "08", n: "Handover and Acceptance", d: "Provisional/final acceptance reports, test reports.", keywords: ["acceptance", "handover", "test report", "commissioning"] },
];

/** Standard sections created under every vehicle folder. */
export const VEHICLE_TEMPLATE = [
  { c: "01", n: "Registration", d: "Vehicle registration certificate and changes.", keywords: ["registration", "saobracajna"] },
  { c: "02", n: "Insurance", d: "Casco and third-party liability policies.", keywords: ["casco", "liability insurance", "policy", "polisa"] },
  { c: "03", n: "Inspection", d: "Periodic vehicle inspection reports.", keywords: ["inspection", "roadworthiness", "tehnicki pregled"] },
  { c: "04", n: "Service and Repair", d: "Service forms, maintenance invoices, tyre changes.", keywords: ["service", "maintenance", "repair", "tyre", "tire"] },
  { c: "05", n: "Fuel", d: "Fuel receipts and monthly consumption reports.", keywords: ["fuel", "diesel", "petrol", "gasoline"] },
  { c: "06", n: "Accidents and Damage", d: "Accident reports, damage files, assessments.", keywords: ["accident", "damage", "assessment", "claim"] },
];

/** Standard sections created under every client folder. */
export const CLIENT_TEMPLATE = [
  { c: "01", n: "Bids", d: "All bids given to the client.", keywords: ["bid", "ponuda", "price"] },
  { c: "02", n: "Contracts", d: "Signed client contracts.", keywords: ["contract", "ugovor"] },
  { c: "03", n: "Correspondence", d: "Correspondence, meeting notes, requests.", keywords: ["correspondence", "mail", "meeting"] },
  { c: "04", n: "Account", d: "Account reconciliations and balance statements.", keywords: ["account", "reconciliation", "balance", "statement"] },
];

/** Standard sections created under every house (accommodation abroad) folder. */
export const HOUSE_TEMPLATE = [
  { c: "01", n: "Lease", d: "Lease agreement, annexes and deposit receipt.", keywords: ["lease", "rental agreement", "ugovor o zakupu", "deposit"] },
  { c: "02", n: "Utility Bills", d: "Electricity, water, gas, internet and building fee bills.", keywords: ["electricity", "water bill", "gas", "internet", "building fee", "struja", "infostan"] },
  { c: "03", n: "Handover Report", d: "Reports made when taking over and returning the house, inventory list.", keywords: ["handover report", "house handover", "inventory list"] },
  { c: "04", n: "Photos", d: "Condition photos at move-in and move-out.", keywords: ["house photo", "apartment photo"] },
];

export const TREE = [
  {
    c: "00", n: "Company Records",
    d: "The official documents that make up the company. Originals in the safe, scans here.",
    note: "Nothing in this section is ever deleted. Expired documents move to 08 - Archive in a year folder.",
    target: false,
    ch: [
      { n: "Tax Records", d: "Tax certificate, registration letters, sample returns.", keywords: ["tax certificate", "tax registration", "tax letter"] },
      { n: "Trade Register", d: "Founding gazette, register certificate, signature circular, activity certificate.", keywords: ["trade register", "register gazette", "signature circular", "activity certificate", "apr"] },
      { n: "Licences", d: "Business and operating licences, building permits, authorisation certificates.", keywords: ["business licence", "operating licence", "building permit", "authorisation"] },
      { n: "Insurance Policies", d: "Premises, professional liability and cargo policies.", keywords: ["premises insurance", "liability insurance", "cargo", "policy"] },
      { n: "Agreements", d: "Signed copies of lease, subcontracting, supplier and partnership agreements.", keywords: ["lease agreement", "subcontract", "supplier agreement", "partnership"] },
    ],
  },
  {
    c: "01", n: "Human Resources (HR)",
    d: "The single place for employee files. The same 15-folder template is built for every employee.",
    note: "Onboarding order: copy the form from Templates → open the employee folder → put the completed document in the numbered folder.",
    target: false,
    ch: [
      {
        n: "Templates",
        d: "Blank forms. Never written over; copied and used.",
        note: "When a form is updated, the old version goes to Templates / Old.",
        keywords: ["template", "blank form"],
        files: [
          "Employment Contract.docx", "Employee Information Form.docx", "Pay Notification Form.docx",
          "Equipment Hand-over Form.docx", "Health and Safety Pledge.docx", "Confidentiality Pledge.docx",
          "Timesheet.xlsx", "Leave Form.docx", "Overtime Form.docx",
        ],
        ch: [{ n: "Old", d: "Retired form versions.", keywords: ["old form"] }],
      },
      {
        n: "Employees",
        d: "One folder per employee, named with the KDR-YEAR-SEQ code. Filled from the Employees table.",
        note: "The 15 sub-folders inside an employee folder are identical for everyone.",
        target: false,
        dynamic: "employee",
      },
      { n: "Archive", d: "Complete files of employees who left. Kept for 10 years from the leaving date.", keywords: ["employee archive", "former employee"] },
    ],
  },
  {
    c: "02", n: "Accounting",
    d: "All money movements. Every sub-folder is split by year and month.",
    note: "In accounting folders file names always start with YEAR-MONTH.",
    target: false,
    ch: [
      {
        n: "Payroll", d: "Monthly payroll summaries, payment lists and social security service records.", keywords: ["payroll summary", "salary list", "social security", "service record"],
        ch: [{ n: "Timesheets", d: "Excel files of closed 15-day timesheet periods. Written by the system when a period is closed.", keywords: ["timesheet summary", "period timesheet"] }],
      },
      { n: "Cash", d: "Monthly cash files (income, expense, carry-over, balance). Updated by the system on every cash change.", keywords: ["cash book", "cash report"] },
      { n: "Invoices", d: "Purchase and sales invoices; split into year → month folders.", keywords: ["invoice", "e-invoice", "faktura", "racun"] },
      { n: "Bank", d: "Account statements, loan files, letters of guarantee.", keywords: ["statement", "account summary", "loan", "letter of guarantee", "izvod"] },
      { n: "Tax", d: "VAT, withholding and provisional tax returns with assessment slips.", keywords: ["vat", "withholding", "tax return", "assessment", "provisional tax", "pdv"] },
      { n: "Accounts", d: "Client and supplier account reconciliations.", keywords: ["current account", "reconciliation", "balance"] },
    ],
  },
  {
    c: "03", n: "Projects",
    d: "One folder per job on site. Filled from the Projects table.",
    note: "When a project closes, its folder moves unchanged to 08 - Archive, into the end-year folder.",
    target: false,
    dynamic: "project",
  },
  {
    c: "04", n: "Warehouse",
    d: "Stock lists, material in/out slips, stock-count reports, critical stock tracking.",
    note: "A stock count is taken once a month and saved as YEAR-MONTH Count.",
    keywords: ["stock", "stock count", "warehouse", "material in", "material out", "delivery note"],
  },
  {
    c: "05", n: "Vehicles",
    d: "Company vehicle files. Filled from the Vehicles table; one folder per vehicle, named by plate.",
    note: "A sub-folder named after the plate is opened for every vehicle.",
    target: false,
    dynamic: "vehicle",
  },
  {
    c: "06", n: "Health & Safety",
    d: "Risk assessment, emergency plan, training records, PPE issues, work accident reports.",
    note: "A copy of a person's safety document also goes into that person's 11 Health & Safety folder.",
    target: false,
    ch: [
      { n: "Risk Assessment", d: "Site and workshop risk analyses and revisions.", keywords: ["risk assessment", "risk analysis"] },
      { n: "Emergency", d: "Emergency plan, drill records, evacuation plans.", keywords: ["emergency", "drill", "fire", "evacuation plan"] },
      { n: "Training Records", d: "Group safety training attendance lists and certificates.", keywords: ["safety training", "training attendance", "certificate"] },
      { n: "PPE", d: "Personal protective equipment purchase and issue records.", keywords: ["ppe", "helmet", "gloves", "protective equipment"] },
      { n: "Work Accidents", d: "Accident notification forms, reports, social security notifications.", keywords: ["work accident", "accident notification", "near miss"] },
    ],
  },
  {
    c: "07", n: "Clients",
    d: "Bid, contract and correspondence files per client. Filled from the Clients table.",
    note: "If a client has several jobs, the project files stay under 03 - Projects.",
    target: false,
    dynamic: "client",
  },
  {
    c: "08", n: "Archive",
    d: "All documents of closed years. Kept under a year folder, with the name of the section they came from.",
    note: "The archive is read-only. A folder moved here is never changed again.",
    keywords: ["archive", "closed", "old year"],
  },
  {
    c: "09", n: "Accommodation",
    d: "Houses rented on projects abroad. Filled from the Houses table; one folder per house, named by code and name.",
    note: "When a house is vacated, the handover report goes into 03 Handover Report; the folder stays in place.",
    target: false,
    dynamic: "house",
  },
];

export const TEMPLATES = {
  employee: EMPLOYEE_TEMPLATE,
  project: PROJECT_TEMPLATE,
  vehicle: VEHICLE_TEMPLATE,
  client: CLIENT_TEMPLATE,
  house: HOUSE_TEMPLATE,
};

/** How the name of a dynamic folder is built. */
export const DYNAMIC_NAME = {
  employee: (r) => `${r.code} ${r.name}`.trim(),
  project: (r) => r.name,
  vehicle: (r) => `${r.plate} ${r.make || ""}`.trim(),
  client: (r) => r.name,
  house: (r) => `${r.code} ${r.name}`.trim(),
};

const label = (d) => (d.c ? `${d.c} - ${d.n}` : d.n);

/**
 * Turns the static tree into a flat list of paths.
 * Returns: [{ path, name, code, title, description, note, target, keywords, dynamic, files, depth }]
 */
export function flatTree() {
  const out = [];
  const walk = (list, prefix, depth) => {
    for (const d of list) {
      const name = label(d);
      const p = prefix ? `${prefix}/${name}` : name;
      out.push({
        path: p, name, code: d.c || null, title: d.n,
        description: d.d || "", note: d.note || "",
        target: d.target !== false && !d.dynamic,
        keywords: d.keywords || [],
        dynamic: d.dynamic || null,
        files: d.files || [],
        depth,
      });
      if (d.ch) walk(d.ch, p, depth + 1);
    }
  };
  walk(TREE, "", 0);
  return out;
}

/** Finds the root path of a dynamic type in the tree. */
export function dynamicRoot(type) {
  const found = flatTree().find((x) => x.dynamic === type);
  return found ? found.path : null;
}
