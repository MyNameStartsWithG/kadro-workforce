/**
 * Exports tables to .xlsx and reads them back.
 * An exported file can be edited in Excel and imported again:
 * the header row carries the column labels, select columns have a drop-down list.
 */
import ExcelJS from "exceljs";
import { TABLES } from "./tables.js";

const ORANGE = "FFE85D04";
const BLACK = "FF141210";
const LIGHT = "FFF6F3F0";
const COMPANY = "ACME ENGINEERING";

function cellValue(value, type) {
  if (value === undefined || value === null || value === "") return null;
  if (type === "number" || type === "money") {
    const n = Number(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : String(value);
  }
  return String(value);
}

function toDateText(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  return s;
}

export async function writeTable(tableName, rows) {
  const def = TABLES[tableName];
  if (!def) throw new Error(`Unknown table: ${tableName}`);

  const book = new ExcelJS.Workbook();
  book.creator = "Kadro";
  book.created = new Date();
  const sheet = book.addWorksheet(def.name, {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // Row 1: title band
  sheet.mergeCells(1, 1, 1, def.columns.length);
  const band = sheet.getCell(1, 1);
  band.value = `${COMPANY} — ${def.name}   ·   ${new Date().toLocaleDateString("en-GB")}   ·   ${rows.length} records`;
  band.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLACK } };
  band.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 26;

  // Row 2: column headers
  const headers = sheet.getRow(2);
  def.columns.forEach((c, i) => {
    const h = headers.getCell(i + 1);
    h.value = c.label;
    h.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
    h.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
    h.border = { bottom: { style: "thin", color: { argb: BLACK } } };
    sheet.getColumn(i + 1).width = Math.max(10, Math.round((c.width || 120) / 8));
  });
  headers.height = 22;

  // Data rows
  rows.forEach((row, ri) => {
    const r = sheet.getRow(ri + 3);
    def.columns.forEach((c, ci) => {
      const h = r.getCell(ci + 1);
      h.value = cellValue(row[c.key], c.type);
      h.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      if (c.type === "date") h.numFmt = "yyyy-mm-dd";
      if (c.type === "money") h.numFmt = "#,##0.00";
      if (ri % 2 === 1) h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      if (c.type === "readonly") h.font = { color: { argb: "FF8A8078" } };
    });
    r.height = 18;
  });

  // Drop-down lists on select columns
  def.columns.forEach((c, ci) => {
    if (c.type !== "select" || !c.options?.length) return;
    for (let r = 3; r <= Math.max(rows.length + 2, 500); r += 1) {
      sheet.getCell(r, ci + 1).dataValidation = {
        type: "list", allowBlank: true,
        formulae: [`"${c.options.join(",")}"`],
      };
    }
  });

  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: def.columns.length } };
  return book.xlsx.writeBuffer();
}

/** Reads an uploaded .xlsx file into row objects. */
export async function readTable(tableName, buffer) {
  const def = TABLES[tableName];
  if (!def) throw new Error(`Unknown table: ${tableName}`);

  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const sheet = book.worksheets[0];
  if (!sheet) throw new Error("The file has no readable sheet.");

  // Find the header row: the row among the first 6 that matches the most column labels.
  const labels = new Map(def.columns.map((c) => [c.label.toLowerCase(), c]));
  let headerRow = 0, mapping = null, best = 0;

  for (let r = 1; r <= Math.min(6, sheet.rowCount); r += 1) {
    const map = new Map();
    let hits = 0;
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, ci) => {
      const text = String(cell.text || "").trim().toLowerCase();
      const c = labels.get(text);
      if (c) { map.set(ci, c); hits += 1; }
    });
    if (hits > best) { best = hits; headerRow = r; mapping = map; }
  }
  if (!mapping || best === 0) {
    throw new Error("Header row not found. Please use the template downloaded from the system.");
  }

  const rows = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
    const src = sheet.getRow(r);
    const obj = {};
    let filled = false;
    for (const [ci, c] of mapping) {
      const cell = src.getCell(ci);
      let v = cell.value;
      if (v && typeof v === "object" && "result" in v) v = v.result;
      if (v && typeof v === "object" && "text" in v) v = v.text;
      if (v === null || v === undefined || v === "") { obj[c.key] = ""; continue; }
      obj[c.key] = c.type === "date" ? toDateText(v) : String(v).trim();
      if (obj[c.key]) filled = true;
    }
    if (filled) rows.push(obj);
  }
  return { rows, headerRow, recognisedColumns: best };
}

/* ------------------------------------------------------------------ */
/* Timesheet                                                           */
/* ------------------------------------------------------------------ */

const TYPE_COLOR = { overtime: "FFFCEADD", holiday: "FFE7E0D9" };
const CURRENCY_ORDER = ["EUR", "TRY", "RSD"];
const currencyText = (t) => CURRENCY_ORDER.concat(Object.keys(t || {}).filter((k) => !CURRENCY_ORDER.includes(k)))
  .filter((k) => t?.[k]).map((k) => `${t[k].toLocaleString("en-GB")} ${k}`).join("  ·  ") || "—";

/**
 * Writes a period as .xlsx. Hour cells are numbers, totals are Excel formulas.
 * The file can be edited in Excel and read back with "Import from Excel" (only the day cells are read).
 */
export async function writeTimesheet(t, calc, days, title) {
  const book = new ExcelJS.Workbook();
  book.creator = "Kadro";
  book.created = new Date();
  const sheet = book.addWorksheet("Timesheet", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const fixed = ["Employee Code", "Full Name", "Crew"];
  const right = ["Total", "Normal", "Overtime", "Short", "Pay Type", "Pay", "Earnings", "Deduction", "Advance", "Net", "Currency"];
  const firstDay = fixed.length + 1;
  const lastDay = fixed.length + days.length;
  const columnCount = lastDay + right.length;

  sheet.mergeCells(1, 1, 1, columnCount);
  const band = sheet.getCell(1, 1);
  band.value = `${COMPANY} — Timesheet · ${title}   ·   multiplier ${t.settings.overtimeMultiplier}   ·   normal day ${t.settings.normalHours} h` +
    (t.status === "closed" ? "   ·   CLOSED" : "");
  band.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLACK } };
  band.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(1).height = 26;

  // Row 2: day name, row 3: day number (the column key when reading back).
  const headStyle = (h, color = ORANGE) => {
    h.font = { name: "Calibri", size: 10, bold: true, color: { argb: color === ORANGE ? "FFFFFFFF" : BLACK } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    h.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  };
  fixed.forEach((b, i) => { sheet.mergeCells(2, i + 1, 3, i + 1); const h = sheet.getCell(2, i + 1); h.value = b; headStyle(h); });
  days.forEach((d, i) => {
    const color = TYPE_COLOR[t.days[d.day]] || ORANGE;
    const h1 = sheet.getCell(2, firstDay + i), h2 = sheet.getCell(3, firstDay + i);
    h1.value = d.short; h2.value = d.no;
    headStyle(h1, color); headStyle(h2, color);
    sheet.getColumn(firstDay + i).width = 5.2;
  });
  right.forEach((b, i) => { const c = lastDay + 1 + i; sheet.mergeCells(2, c, 3, c); const h = sheet.getCell(2, c); h.value = b; headStyle(h); });
  sheet.getColumn(1).width = 16; sheet.getColumn(2).width = 24; sheet.getColumn(3).width = 10;
  right.forEach((_, i) => { sheet.getColumn(lastDay + 1 + i).width = 11; });

  const letter = (c) => sheet.getColumn(c).letter;
  const firstData = 4;
  t.rows.forEach((r, ri) => {
    const h = calc.rows[ri];
    const row = sheet.getRow(firstData + ri);
    row.getCell(1).value = r.employeeCode;
    row.getCell(2).value = r.name;
    row.getCell(3).value = r.crew || "—";
    days.forEach((d, i) => {
      const cell = row.getCell(firstDay + i);
      const v = r.cells[d.day] || "";
      cell.value = /^\d/.test(v) ? Number(v) : (v || null);
      cell.alignment = { horizontal: "center" };
      const color = TYPE_COLOR[t.days[d.day]];
      if (color) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      if (r.crewDays[d.day]) cell.note = `Crew on this day: ${r.crewDays[d.day]}`;
    });
    const n = firstData + ri;
    const c0 = lastDay + 1;
    row.getCell(c0).value = { formula: `SUM(${letter(firstDay)}${n}:${letter(lastDay)}${n})`, result: h.total };
    row.getCell(c0 + 1).value = h.normal;
    row.getCell(c0 + 2).value = h.overtime;
    row.getCell(c0 + 3).value = h.short;
    row.getCell(c0 + 4).value = r.payType || "—";
    row.getCell(c0 + 5).value = Number(r.pay) || null;
    row.getCell(c0 + 6).value = h.earnings;
    row.getCell(c0 + 7).value = h.deduction || null;
    if (h.deductionItems?.length) row.getCell(c0 + 7).note = h.deductionItems.map((k) => `${k.name}: ${k.formula} = ${k.amount} ${k.currency}${k.notDeducted ? " (not deducted)" : ""}`).join("\n");
    row.getCell(c0 + 8).value = (h.advanceDeducted ?? h.advance[h.currency]) || null;
    row.getCell(c0 + 9).value = h.net[h.currency];
    row.getCell(c0 + 10).value = h.currency;
    for (let c = c0 + 5; c <= c0 + 9; c += 1) row.getCell(c).numFmt = "#,##0.00";
    if (ri % 2 === 1) [1, 2, 3].forEach((c) => { row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } }; });
  });

  // Total row: formulas in the hour columns.
  if (t.rows.length) {
    const last = firstData + t.rows.length - 1;
    const tr = sheet.getRow(last + 2);
    tr.getCell(2).value = "TOTAL";
    tr.font = { bold: true };
    for (let c = firstDay; c <= lastDay + 4; c += 1) {
      tr.getCell(c).value = { formula: `SUM(${letter(c)}${firstData}:${letter(c)}${last})` };
      tr.getCell(c).alignment = { horizontal: "center" };
    }
  }

  const o = book.addWorksheet("Summary");
  o.getColumn(1).width = 30; o.getColumn(2).width = 48;
  const z = calc.summary;
  [
    ["Period", title],
    ["Status", t.status === "closed" ? "Closed" : "Open"],
    ["People", z.people],
    ["Crews", z.crews],
    ["Total hours worked", z.totalHours],
    ["Normal hours", z.normal],
    ["Overtime hours", z.overtime],
    ["Short hours", z.short],
    ["Leave / sick / absent (days)", `${z.leave} / ${z.sick} / ${z.absent}`],
    ["Earnings", currencyText(z.earnings)],
    ["Deductions", currencyText(z.deduction)],
    ["Advances", currencyText(z.advance)],
    ["Net", currencyText(z.net)],
    ...(Object.keys(z.monthEnd).length ? [["Month-end pay (both halves)", currencyText(z.monthEnd)]] : []),
    ["Meals", currencyText(z.meals)],
    ["Rent share", currencyText(z.rent)],
    ["Overtime multiplier", t.settings.overtimeMultiplier],
    ["Normal day hours", t.settings.normalHours],
    ["Weekday excess counts as overtime", t.settings.weekdayExcess ? "Yes" : "No"],
    ["Work on holidays counts as overtime", t.settings.holidayAsOvertime ? "Yes" : "No"],
    ...(t.settings.rates && (t.rule || 1) >= 3
      ? [["Rates", Object.entries(t.settings.rates.rate || {}).map(([c, v]) => `1 ${t.settings.rates.base} = ${v} ${c}`).join(" · ") || "not entered"]] : []),
  ].forEach(([a, b], i) => {
    const r = o.getRow(i + 1);
    r.getCell(1).value = a; r.getCell(2).value = b;
    r.getCell(1).font = { bold: true };
  });

  return book.xlsx.writeBuffer();
}

/** Reads the day cells from Excel. Returns: { changes: [{ employeeCode, day, value }], unknown } */
export async function readTimesheet(buffer, t, days) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const sheet = book.getWorksheet("Timesheet") || book.worksheets[0];
  if (!sheet) throw new Error("The file has no readable sheet.");

  let headerRow = 0, codeColumn = 0;
  for (let r = 1; r <= Math.min(8, sheet.rowCount) && !codeColumn; r += 1) {
    sheet.getRow(r).eachCell({ includeEmpty: false }, (h, c) => {
      if (String(h.text).trim().toLowerCase() === "employee code") { codeColumn = c; headerRow = r; }
    });
  }
  if (!codeColumn) throw new Error("\"Employee Code\" column not found. Use the timesheet file downloaded from the system.");

  // The day number can be in the header row or right below it.
  const byNumber = new Map(days.map((d) => [d.no, d.day]));
  const columnDay = new Map();
  let dataStart = headerRow + 1;
  for (let r = headerRow; r <= headerRow + 1; r += 1) {
    let found = false;
    sheet.getRow(r).eachCell({ includeEmpty: false }, (h, c) => {
      const n = Number(h.value);
      if (c > codeColumn && Number.isInteger(n) && byNumber.has(n) && !columnDay.has(c)) { columnDay.set(c, byNumber.get(n)); found = true; }
    });
    if (found) dataStart = r + 1;
  }
  if (!columnDay.size) throw new Error("Day columns not found. The file may belong to another period.");

  const codes = new Set(t.rows.map((r) => r.employeeCode));
  const changes = [], unknown = [];
  for (let r = dataStart; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const code = String(row.getCell(codeColumn).text || "").trim();
    if (!code || code === "TOTAL") continue;
    if (!codes.has(code)) { if (/^[A-Z]{2,4}-/.test(code)) unknown.push(code); continue; }
    for (const [c, day] of columnDay) {
      let v = row.getCell(c).value;
      if (v && typeof v === "object" && "result" in v) v = v.result;
      changes.push({ employeeCode: code, day, value: v === null || v === undefined ? "" : String(v) });
    }
  }
  return { changes, unknown };
}

/* ------------------------------------------------------------------ */
/* Cash                                                                */
/* ------------------------------------------------------------------ */

const orderedCurrencies = (...totals) => {
  const present = new Set(totals.flatMap((t) => Object.keys(t || {})));
  return CURRENCY_ORDER.filter((k) => present.has(k)).concat([...present].filter((k) => !CURRENCY_ORDER.includes(k)));
};

function writeBand(sheet, columns, text) {
  sheet.mergeCells(1, 1, 1, columns);
  const band = sheet.getCell(1, 1);
  band.value = text;
  band.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLACK } };
  band.alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(1).height = 26;
}

function writeHeader(row, headers) {
  headers.forEach((b, i) => {
    const h = row.getCell(i + 1);
    h.value = b;
    h.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
    h.alignment = { vertical: "middle", indent: 1 };
  });
  row.height = 20;
}

/** Monthly cash file: movements + summary (carry-over, income, expense, balance, category breakdown). */
export async function writeCash(v) {
  const book = new ExcelJS.Workbook();
  book.creator = "Kadro";
  book.created = new Date();

  const s = book.addWorksheet("Cash", { views: [{ state: "frozen", ySplit: 2 }] });
  const columns = [["Date", 12], ["Type", 9], ["Category", 22], ["Description", 46], ["Project", 24], ["Employee", 22],
    ["Income", 13], ["Expense", 13], ["Currency", 10], ["Source", 10], ["Status", 17]];
  writeBand(s, columns.length, `${COMPANY} — Cash · ${v.name}   ·   ${v.rows.length} movements   ·   ${new Date().toLocaleString("en-GB")}`);
  writeHeader(s.getRow(2), columns.map(([b]) => b));
  columns.forEach(([, w], i) => { s.getColumn(i + 1).width = w; });

  v.rows.forEach((r, i) => {
    const row = s.getRow(i + 3);
    const amount = Number(String(r.amount).replace(",", ".")) || 0;
    row.values = [
      cellValue(r.date, "date"), r.type, r.category || "", r.description || "",
      r.projectName || "", r.employeeName || "",
      r.type === "Income" ? amount : null, r.type === "Income" ? null : amount,
      r.currency || "EUR", r.source || "Manual", r.statusLabel || "",
    ];
    row.getCell(1).numFmt = "yyyy-mm-dd";
    row.getCell(7).numFmt = "#,##0.00"; row.getCell(8).numFmt = "#,##0.00";
    if (i % 2 === 1) row.eachCell((h) => { h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } }; });
  });
  if (v.rows.length) s.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };

  const o = book.addWorksheet("Summary");
  const z = v.summary;
  const curs = orderedCurrencies(z.carry, z.income, z.expense, z.balance);
  writeBand(o, 1 + Math.max(1, curs.length), `Cash summary · ${v.name}`);
  o.getColumn(1).width = 34;
  curs.forEach((_, i) => { o.getColumn(i + 2).width = 16; });
  writeHeader(o.getRow(3), ["", ...curs]);
  const put = (no, label, t, bold) => {
    const row = o.getRow(no);
    row.getCell(1).value = label;
    curs.forEach((cur, i) => { const h = row.getCell(i + 2); h.value = t?.[cur] || 0; h.numFmt = "#,##0.00"; });
    if (bold) row.font = { bold: true };
  };
  put(4, "Carried over (previous months)", z.carry);
  put(5, "Income", z.income);
  put(6, "Expense", z.expense);
  put(7, "Balance (month end)", z.balance, true);

  let n = 9;
  writeHeader(o.getRow(n), ["By category", ...curs]);
  for (const c of z.categories) put(++n, `${c.type} · ${c.category}`, c.amount);
  n += 2;
  writeHeader(o.getRow(n), ["Project (income − expense)", ...curs]);
  for (const p of z.projects) put(++n, p.name, p.net);
  if (v.deleted?.length) {
    n += 2;
    o.getRow(n).getCell(1).value = `Note: ${v.deleted.length} automatic rows were deleted by hand this month; they are not in this file.`;
  }
  return book.xlsx.writeBuffer();
}

/** Cash report: one row per bucket, carry-over / income / expense / balance per currency. */
export async function writeCashReport(r, title) {
  const book = new ExcelJS.Workbook();
  book.creator = "Kadro";
  book.created = new Date();
  const curs = orderedCurrencies(r.total.carry, r.total.income, r.total.expense, r.total.balance,
    ...r.buckets.flatMap((b) => [b.carry, b.income, b.expense]));
  const fields = [["carry", "Carry-over"], ["income", "Income"], ["expense", "Expense"], ["net", "Net"], ["balance", "Balance"]];

  const s = book.addWorksheet("Report", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  const width = 1 + curs.length * fields.length;
  writeBand(s, Math.max(2, width), `${COMPANY} — ${title}`);
  s.getColumn(1).width = 30;
  // Row 2: currency, row 3: field
  curs.forEach((cur, i) => {
    const c = 2 + i * fields.length;
    s.mergeCells(2, c, 2, c + fields.length - 1);
    const h = s.getCell(2, c);
    h.value = cur;
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLACK } };
    h.alignment = { horizontal: "center" };
  });
  writeHeader(s.getRow(3), [r.type === "project" ? "Project" : "Period", ...curs.flatMap(() => fields.map(([, b]) => b))]);
  for (let c = 2; c <= width; c += 1) s.getColumn(c).width = 13;

  const writeRow = (no, label, b, bold) => {
    const row = s.getRow(no);
    row.getCell(1).value = label;
    curs.forEach((cur, i) => fields.forEach(([f], j) => {
      const h = row.getCell(2 + i * fields.length + j);
      h.value = b[f]?.[cur] || 0;
      h.numFmt = "#,##0.00";
    }));
    if (bold) row.font = { bold: true };
  };
  r.buckets.forEach((b, i) => writeRow(4 + i, b.name, b));
  writeRow(5 + r.buckets.length, "TOTAL", r.total, true);

  const ct = book.addWorksheet("Categories");
  ct.getColumn(1).width = 34;
  writeHeader(ct.getRow(1), ["Category", ...curs]);
  r.total.categories.forEach((c, i) => {
    const row = ct.getRow(2 + i);
    row.getCell(1).value = `${c.type} · ${c.category}`;
    curs.forEach((cur, j) => { row.getCell(2 + j).value = c.amount[cur] || 0; row.getCell(2 + j).numFmt = "#,##0.00"; });
  });

  const pr = book.addWorksheet("Projects");
  pr.getColumn(1).width = 34;
  writeHeader(pr.getRow(1), ["Project", ...curs.flatMap((cur) => [`Income ${cur}`, `Expense ${cur}`, `Net ${cur}`])]);
  r.total.projects.forEach((p, i) => {
    const row = pr.getRow(2 + i);
    row.getCell(1).value = p.name;
    curs.forEach((cur, j) => ["income", "expense", "net"].forEach((f, m) => {
      const h = row.getCell(2 + j * 3 + m); h.value = p[f][cur] || 0; h.numFmt = "#,##0.00";
    }));
  });
  return book.xlsx.writeBuffer();
}

/* ------------------------------------------------------------------ */
/* Forecast                                                            */
/* ------------------------------------------------------------------ */

/** Forecast table: one sheet per currency, columns are periods. Actual columns grey, hand-corrected cells yellow. */
export async function writeForecast(v) {
  const book = new ExcelJS.Workbook();
  book.creator = "Kadro";
  book.created = new Date();
  const GREY = "FFE7E0D9", YELLOW = "FFFCEEDC";

  for (const cur of v.currencies) {
    const s = book.addWorksheet(`Forecast ${cur}`, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    const width = 1 + v.columns.length;
    writeBand(s, width, `${COMPANY} — Forecast · ${cur} · ${v.projectName}   ·   ${new Date().toLocaleDateString("en-GB")}`);
    s.getColumn(1).width = 26;
    v.columns.forEach((c, i) => {
      const n = i + 2;
      s.getColumn(n).width = 13;
      const month = s.getCell(2, n), half = s.getCell(3, n), state = s.getCell(4, n);
      month.value = c.month; half.value = `${c.half === 1 ? "1st" : "2nd"} half (${c.range})`; state.value = c.state === "actual" ? "actual" : "estimate";
      for (const h of [month, half, state]) {
        h.font = { bold: h !== state, size: 10, color: { argb: c.state === "actual" ? BLACK : "FFFFFFFF" } };
        h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.state === "actual" ? GREY : ORANGE } };
        h.alignment = { horizontal: "center" };
      }
    });
    s.getCell(4, 1).value = "Item"; s.getCell(4, 1).font = { bold: true };

    let r = 5;
    const put = (label, cell, bold) => {
      const row = s.getRow(r++);
      row.getCell(1).value = label;
      if (bold) row.font = { bold: true };
      v.columns.forEach((c, i) => {
        const h = row.getCell(i + 2);
        const x = cell(c);
        h.value = x?.value ?? x ?? 0;
        h.numFmt = "#,##0.00";
        if (c.state === "actual") h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
        if (x?.manual) { h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } }; h.note = `Corrected by hand. System's figure: ${x.system}`; }
      });
    };
    for (const k of v.rows.filter((x) => x.kind === "expense")) put(k.name, (c) => v.values[k.key][c.period]?.[cur]);
    put("Total expense", (c) => v.totals.expense[c.period][cur], true);
    put("Income", (c) => v.values.income[c.period]?.[cur]);
    put("Net (income − expense)", (c) => v.totals.net[c.period][cur], true);
    put("Cash balance", (c) => v.totals.balance[c.period][cur], true);
  }

  const k = book.addWorksheet("Sources");
  k.getColumn(1).width = 18; k.getColumn(2).width = 60; k.getColumn(3).width = 80;
  writeHeader(k.getRow(1), ["Item", "Actual", "Estimate"]);
  v.rows.forEach((x, i) => { k.getRow(i + 2).values = [x.name, x.actual, x.estimate]; });
  k.getRow(v.rows.length + 3).values = ["Cash balance", "The real balance in cash (end of period)", "Previous period's balance + estimated net"];
  return book.xlsx.writeBuffer();
}
