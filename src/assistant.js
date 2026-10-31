/**
 * Voice commands: turns a spoken sentence into Kadro records.
 *
 *   audio → n8n /webhook/kadro/transcribe (Groq Whisper) → text
 *   text  → n8n /webhook/kadro/assist (DeepSeek, tool calling) → the tools run HERE
 *
 * Read tools (timesheet, payment, cash and advance queries) run immediately and their result goes back to the model.
 * Write tools write nothing: they validate and become a CONFIRMATION CARD. The record is written when the user presses
 * Approve on the card, through the app's normal validation; every approved action goes to the assistant log and can
 * be undone. There are no tools for deleting, resetting, changing pay or closing a period.
 *
 * The model keys (Groq, DeepSeek) never come to this computer; they stay in n8n. Only the n8n address and the
 * X-Api-Key issued to Kadro are kept here; the key never goes into backups (see db.exportData).
 *
 * Data sent to the model: employee, crew, house and project names, and the timesheet, advance, payment and cash
 * summaries the tools return. IBANs, phone numbers, passports and notes are returned by no tool.
 *
 * Server calls are kept few (the n8n guard counts 100 requests per day per key): if a command consists only of
 * valid write calls, the model is not called a second time and the reply is built here. Reads or errors go back
 * to the model.
 */
import fs from "node:fs";
import sea from "node:sea";
import * as db from "./db.js";
import * as timesheet from "./timesheet.js";
import * as payments from "./payments.js";
import * as cash from "./cash.js";
import * as employeeView from "./employee-view.js";
import * as contracts from "./contracts.js";
import * as log from "./assistant-log.js";
import { CASH_CATEGORIES } from "./tables.js";

const CURRENCIES = ["EUR", "TRY", "RSD"];
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TURNS = 4;                       // at most this many model calls per command
const CONVERSATION_TTL = 30 * 60_000;      // a follow-up ("the one called Mehmet Kılıç") is understood within this time
const CARD_TTL = 60 * 60_000;

const pad = (n) => String(n).padStart(2, "0");
const round = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayText = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${DAY_NAME[d.getUTCDay()]} ${d.getUTCDate()} ${timesheet.MONTHS[d.getUTCMonth()]}`;
};
const money = (n, cur) => `${Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${cur}`;
const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** The table operations of server.js (row preparation, cash sync, folders) are wired in here. */
let ops = null;
export function connect(tableOps) { ops = tableOps; }

/** Command log (see assistant-log.js): local archive + the n8n kadro/log endpoint. */
let version = "";
export function startLog(dataDir, appVersion) {
  version = appVersion;
  log.start(dataDir, (records) => n8n("kadro/log", { records }));
}
export const logStatus = () => log.status();
export const logSend = () => log.flush(true);
const recordBase = (kind) => ({ id: newId(), kind, time: new Date().toISOString(), version, user: db.settings().user || "" });
/** Card event: approved, cancelled, undone, expired. Linked to the command record by commandId. */
const writeEvent = (event, c, extra = {}) => log.write({ ...recordBase("event"), event, commandId: c.commandId || null,
  cardId: c.cardId || c.id || null, tool: c.tool || null, title: c.title || null, lines: c.lines || null, ...extra });

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

/** Used when the address in Settings is empty; the client only enters the key. Changes when the server moves. */
export const DEFAULT_URL = "https://n8n.example.com";

/** Key embedded in the exe by `build.mjs --assistant-key`: voice commands work without the client entering anything. */
const EMBEDDED_KEY = (() => {
  try { return sea.isSea() ? Buffer.from(sea.getAsset("assistant-key.txt")).toString("utf8").trim() : ""; } catch { return ""; }
})();
export const hasEmbeddedKey = Boolean(EMBEDDED_KEY);

export function config() {
  const s = db.settings();
  const url = String(process.env.KADRO_ASSISTANT_URL || s.assistantUrl || DEFAULT_URL).trim().replace(/\/+$/, "");
  const key = String(process.env.KADRO_ASSISTANT_KEY || s.assistantKey || EMBEDDED_KEY).trim();
  return { url, key, ready: Boolean(url && key) };
}

// The n8n guard returns a machine code; the sentence is built here.
const ERROR_CODE = {
  bad_key: () => "The assistant key was rejected. Check the key in Settings.",
  no_keys: () => "No key list is configured on the assistant server.",
  rate_min: (v) => `Too fast: at most ${v.limit} requests per minute. Wait a moment and try again.`,
  rate_day: (v) => `Today's assistant limit is used up (${v.limit} requests). It resets tomorrow.`,
  model_empty: () => "The model returned an empty answer. Try again.",
};

async function n8n(route, body) {
  const { url, key, ready } = config();
  if (!ready) throw new Error("Voice commands are not set up: enter the assistant address and key in Settings.");
  const form = body instanceof FormData;
  let res;
  try {
    res = await fetch(`${url}/webhook/${route}`, {
      method: "POST",
      headers: { "X-Api-Key": key, ...(form ? {} : { "Content-Type": "application/json" }) },
      body: form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(130_000),
    });
  } catch (e) {
    throw new Error(`Could not reach the assistant server (${e.cause?.code || e.name}). Check the internet connection.`);
  }
  const text = await res.text();
  let v = null;
  try { v = JSON.parse(text); } catch {}
  if (v?.error_code && ERROR_CODE[v.error_code]) throw new Error(ERROR_CODE[v.error_code](v));
  if (res.status === 404) throw new Error(`The assistant server has no active "${route}" endpoint.`);
  if (!res.ok) throw new Error(v?.error || v?.message || `The assistant server returned an error (${res.status}).`);
  if (!v) throw new Error("The assistant server's reply could not be read.");
  if (v.error) throw new Error(v.error);
  return v;
}

/* ------------------------------------------------------------------ */
/* Context: so the model can match names and codes                      */
/* ------------------------------------------------------------------ */

const activeEmployees = () => db.table("employees").filter((p) => p.status !== "Left");

function getPerson(code) {
  const p = db.findRow("employees", (x) => x.code === String(code || "").trim());
  if (!p) throw new Error(`No employee with code "${code}". Pick the right code from the list or ask the user.`);
  return p;
}

function getDay(d, fallback = localDay()) {
  const day = String(d || "").trim() || fallback;
  if (!DATE.test(day) || Number.isNaN(new Date(`${day}T00:00:00Z`).getTime())) throw new Error(`Invalid date: "${d}". Use YYYY-MM-DD.`);
  return day;
}

function systemPrompt() {
  const today = localDay();
  const crews = new Map(db.table("crews").map((c) => [c.code, c]));
  const people = activeEmployees().map((p) => [
    p.code, p.name,
    p.crew ? `crew ${p.crew} ${crews.get(p.crew)?.name || ""}`.trim() : "no crew",
    p.house ? `house ${p.house}` : "",
    p.payType || "", p.currency || "EUR", p.status === "On leave" ? "ON LEAVE" : "",
  ].filter(Boolean).join(" | "));
  const crewList = db.table("crews").filter((c) => c.status !== "Inactive").map((c) => `${c.code} ${c.name}${c.project ? ` (project ${c.project})` : ""}`);
  const houses = db.table("houses").filter((h) => h.status !== "Vacated").map((h) => `${h.code} ${h.name}${h.city ? `, ${h.city}` : ""}`);
  const projects = db.table("projects").filter((p) => ["In progress", "Bid"].includes(p.status)).map((p) => `${p.code} ${p.name}`);
  const periods = timesheet.allPeriods().slice(-4).map((t) => `${t.period} = ${timesheet.periodName(t.period)} (${t.status === "closed" ? "CLOSED" : "open"})`);

  return [
    "You are the assistant of ACME Engineering's personnel, timesheet and cash app. The user (a manager) speaks to you;",
    "sentences come from speech recognition, so names may be misspelled. Keep replies short, plain English, easy to read aloud.",
    "",
    `Today: ${today} ${DAY_NAME[new Date(`${today}T00:00:00Z`).getUTCDay()]}. Resolve "today", "yesterday", "Monday", "last Friday" from this.`,
    "A weekday without a date means the nearest PAST such day (today included).",
    "",
    "RULES",
    "1. When the user wants to add or change a record, call the matching WRITE tool right away. Write tools change nothing;",
    "   they show the user a CONFIRMATION CARD. Do not ask 'shall I?' first; the card is that question.",
    "   After a tool, never say 'done/added/written'; say 'it will be written once you approve'.",
    "2. Match names against the EMPLOYEES list below and pass the CODE to tools. Be lenient with speech recognition errors",
    "   (Yigit = Yiğit, Mehmed = Mehmet). If several people match, or none, DO NOT GUESS: ask, listing the candidates.",
    "   If the user names a whole crew ('crew 1', 'the installation crew'), write for everyone in that crew.",
    "3. Timesheet value: hours worked ('8', '10.5'); 'L' leave; 'S' sick; '–' absent; '' (empty) clears the cell.",
    "   'absent', 'didn't come', 'no-show' = '–'. 'on leave', 'day off' = 'L'. 'sick', 'sick note' = 'S'.",
    "   'full day', 'normal' = 8. 'worked/came' without hours = 8.",
    "   Several days of one person, or several people, go in a single timesheet_write call.",
    "4. If no currency is said: the person's currency for an advance, EUR for cash. 'dinar' = RSD, 'lira' = TRY, 'euro' = EUR.",
    "5. Before answering a question, call the matching READ tool; never make up numbers that are not in your data.",
    "6. You cannot: delete records, change pay, open/close timesheet periods, change settings, reset, handle documents.",
    "   If asked, say 'please do that on screen'. You can change an employee's crew/house/role/status.",
    "7. If one sentence holds several tasks, call a tool for each; the user approves each card separately.",
    "8. If a tool returns an ERROR, tell the user the reason briefly; if it can be fixed, fix it and try again.",
    "9. Never put anything the user did not say into description or note fields; leave them empty (except cash_add's description: keep it short).",
    "10. Use advance_add for advances, not cash_add (an advance goes to cash by itself).",
    "    For salary, meal allowance and rent payments use payment_mark (find the key with payment_list first).",
    "",
    `TIMESHEET PERIODS (most recently opened): ${periods.join("; ") || "none"}`,
    "",
    "EMPLOYEES (code | name | crew | house | pay type | currency):",
    ...(people.length ? people : ["(no records)"]),
    "",
    `CREWS: ${crewList.join("; ") || "none"}`,
    `HOUSES: ${houses.join("; ") || "none"}`,
    `PROJECTS: ${projects.join("; ") || "none"}`,
    `CASH CATEGORIES: ${CASH_CATEGORIES.join(", ")}`,
  ].join("\n");
}

/** A hint for Whisper so it spells names right. A long hint is cut (Whisper reads ~224 tokens). */
function nameHint() {
  let text = "Kadro timesheet, advance, cash.";
  for (const p of activeEmployees()) {
    if (text.length + p.name.length > 420) break;
    text += ` ${p.name},`;
  }
  return text.replace(/,$/, ".");
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const valueText = (v) => ({ "–": "absent", L: "leave", S: "sick", "": "empty" }[v] ?? `${v} h`);

const object = (props, required = []) => ({ type: "object", properties: props, required });
const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const codeField = string("Employee code from the EMPLOYEES list (e.g. KDR-2026-0001).");

const TOOLS = {
  /* ---------------- read ---------------- */

  timesheet_read: {
    description: "Reads the timesheet. With employeeCode: that person's days in the period; with day: everyone's value on that day; " +
      "with neither: everyone's hour summary for the period. Without a period, the period of day (or of today).",
    schema: object({
      employeeCode: codeField,
      day: string("YYYY-MM-DD"),
      period: string("Period id, e.g. 2026-10-2 (2 from the 16th of the month, 1 before)."),
    }),
    read({ employeeCode, day, period }) {
      const d = day ? getDay(day) : null;
      const pid = period ? timesheet.parsePeriod(period).period : timesheet.periodOfDate(d || localDay());
      const t = timesheet.find(pid);
      if (!t) return `The ${timesheet.periodName(pid)} timesheet has not been opened yet.`;
      const c = timesheet.calc(t);
      const head = `${timesheet.periodName(pid)} — ${t.status === "closed" ? "CLOSED" : "open"}`;
      if (employeeCode) {
        const i = t.rows.findIndex((r) => r.employeeCode === employeeCode);
        if (i < 0) return `${getPerson(employeeCode).name} is not in this period.`;
        const r = t.rows[i], h = c.rows[i];
        const days = timesheet.parsePeriod(pid).days.map((x) => `${x.slice(8)} ${DAY_NAME[new Date(`${x}T00:00:00Z`).getUTCDay()].slice(0, 3)}: ${r.cells[x] ? valueText(r.cells[x]) : "not entered"}`);
        return `${head}\n${r.name}: total ${h.total} h (overtime ${h.overtime}), absent ${h.absent} days, leave ${h.leave}, sick ${h.sick}.\n${days.join("\n")}`;
      }
      if (d) {
        return `${head}\n${dayText(d)}:\n${t.rows.map((r) => `${r.employeeCode} ${r.name}: ${r.cells[d] ? valueText(r.cells[d]) : "not entered"}`).join("\n")}`;
      }
      return `${head}\n${t.rows.map((r, i) => {
        const h = c.rows[i];
        const filled = Object.keys(r.cells).length;
        return `${r.employeeCode} ${r.name}: ${h.total} h, absent ${h.absent}, leave ${h.leave}, sick ${h.sick}, days filled ${filled}`;
      }).join("\n")}`;
    },
  },

  person_summary: {
    description: "An employee's recent earnings, deductions, advances, net/month-end amount and payments (paid or not).",
    schema: object({ employeeCode: codeField }, ["employeeCode"]),
    read({ employeeCode }) {
      const v = employeeView.view(getPerson(employeeCode).code);
      const m = (t) => Object.entries(t || {}).map(([cur, n]) => money(n, cur)).join(" + ") || "0";
      return JSON.stringify({
        person: `${v.person.name} · ${v.person.role || ""} · ${v.person.payType} ${v.person.pay} ${v.person.currency}`,
        crew: v.crew?.name || null, house: v.house?.name || null,
        periods: v.periods.slice(0, 2).map((p) => ({
          period: p.name, status: p.status,
          hours: p.total, overtime: p.overtime, absentDays: p.absent, leave: p.leave, sick: p.sick,
          earnings: m({ [p.currency]: p.earnings }), deductions: m({ [p.currency]: p.deduction }),
          advances: p.advances.map((a) => `${a.date} ${money(a.amount, a.currency)}`),
          net: m(p.net), monthEnd: p.monthEnd ? m(p.monthEnd) : null,
        })),
        payments: v.payments.slice(0, 6).map((o) => `${o.due} ${o.description}: ${money(o.amount, o.currency)} — ` +
          (o.paid ? `paid ${o.paidDate} (${money(o.paidAmount, o.currency)})` : "unpaid")),
      });
    },
  },

  payment_list: {
    description: "Payment items (salary, hourly wages, meal allowance, house rent): key, who, amount, due date, paid or not. " +
      "The key for payment_mark comes from here.",
    schema: object({
      month: string("Due month, YYYY-MM. This month if omitted."),
      employeeCode: codeField,
      unpaidOnly: { type: "boolean" },
    }),
    read({ month, employeeCode, unpaidOnly }) {
      const v = payments.month(month || cash.currentMonth());
      const items = v.days.flatMap((d) => d.groups.flatMap((g) => g.items))
        .filter((k) => !employeeCode || k.employeeCode === employeeCode)
        .filter((k) => !unpaidOnly || !k.paid);
      if (!items.length) return `No matching payment items for ${cash.monthName(v.month)}.`;
      return items.map((k) => `key=${k.key} | ${k.who} | ${k.description} | ${money(k.amount, k.currency)} | due ${k.due} | ` +
        (k.paid ? `paid ${k.payment.date} (${money(k.payment.amount, k.currency)})` : "unpaid")).join("\n");
    },
  },

  cash_summary: {
    description: "A month of cash: income, expense, net, balance, categories and the latest movements.",
    schema: object({ month: string("YYYY-MM. This month if omitted.") }),
    read({ month }) {
      const v = cash.month(month || cash.currentMonth());
      const m = (t) => Object.entries(t || {}).map(([cur, n]) => money(n, cur)).join(" + ") || "0";
      return JSON.stringify({
        month: v.name, income: m(v.summary.income), expense: m(v.summary.expense), net: m(v.summary.net), balance: m(v.summary.balance),
        categories: v.summary.categories.map((c) => `${c.type} ${c.category}: ${m(c.amount)}`),
        latest: v.rows.slice(-15).map((r) => `${r.date} ${r.type} ${r.category || ""} ${money(r.amount, r.currency)} ${r.description || ""}`.trim()),
      });
    },
  },

  advance_list: {
    description: "Advances paid out. Filtered by employeeCode and/or month (YYYY-MM).",
    schema: object({ employeeCode: codeField, month: string("YYYY-MM") }),
    read({ employeeCode, month }) {
      const names = new Map(db.table("employees").map((p) => [p.code, p.name]));
      const list = db.table("advances")
        .filter((a) => (!employeeCode || a.employeeCode === employeeCode) && (!month || String(a.date).startsWith(month)))
        .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-40);
      if (!list.length) return "No matching advance records.";
      return list.map((a) => `${a.date} | ${names.get(a.employeeCode) || a.employeeCode} | ${money(num(a.amount), a.currency || "EUR")} | ${a.description || ""}`).join("\n");
    },
  },

  /* ---------------- write: prepare → card, apply → record, undo ---------------- */

  timesheet_write: {
    description: "Writes timesheet cells (opens a confirmation card). Value: hours, 'L' leave, 'S' sick, '–' absent, '' clear.",
    schema: object({
      changes: {
        type: "array",
        items: object({ employeeCode: codeField, day: string("YYYY-MM-DD"), value: string("8, 10.5, L, S, – or empty") }, ["employeeCode", "day", "value"]),
      },
    }, ["changes"]),
    prepare({ changes }) {
      if (!Array.isArray(changes) || !changes.length) throw new Error("changes is empty.");
      const unique = new Map();
      for (const c of changes) {
        const p = getPerson(c.employeeCode);
        const day = getDay(c.day);
        const period = timesheet.periodOfDate(day);
        const t = timesheet.find(period);
        if (!t) throw new Error(`The ${timesheet.periodName(period)} timesheet has not been opened yet; open the period on screen first.`);
        if (t.status === "closed") throw new Error(`${timesheet.periodName(period)} is closed; it cannot be changed by voice.`);
        const r = t.rows.find((x) => x.employeeCode === p.code);
        if (!r) throw new Error(`${p.name} is not in the ${timesheet.periodName(period)} timesheet.`);
        unique.set(`${p.code}|${day}`, { period, employeeCode: p.code, name: p.name, day, value: timesheet.normalizeValue(c.value), old: r.cells[day] || "" });
      }
      const data = [...unique.values()].sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name, "tr"));
      const unchanged = data.filter((v) => v.old === v.value).length;
      return {
        title: data.length === 1 ? "Timesheet" : `Timesheet · ${data.length} cells`,
        lines: data.map((v) => `${v.name} · ${dayText(v.day)} · ${v.old && v.old !== v.value ? `${valueText(v.old)} → ` : ""}${valueText(v.value)}`),
        note: unchanged ? `${unchanged} cells already have this value.` : "",
        data,
      };
    },
    apply(data) {
      const byPeriod = Map.groupBy(data, (v) => v.period);
      const old = [];
      for (const [period, list] of byPeriod) {
        const t = timesheet.get(period);
        for (const v of list) old.push({ period, employeeCode: v.employeeCode, day: v.day, value: t.rows.find((r) => r.employeeCode === v.employeeCode).cells[v.day] || "", fresh: v.value });
      }
      for (const [period, list] of byPeriod) timesheet.writeCells(period, list.map(({ employeeCode, day, value }) => ({ employeeCode, day, value })));
      return { undo: { old } };
    },
    undo({ old }) {
      for (const [period, list] of Map.groupBy(old, (v) => v.period)) {
        const t = timesheet.get(period);
        for (const v of list) {
          const now = t.rows.find((r) => r.employeeCode === v.employeeCode)?.cells[v.day] || "";
          if (now !== v.fresh) throw new Error(`The cell on ${v.day} was changed afterwards (${valueText(now)}); fix it by hand.`);
        }
        timesheet.writeCells(period, list.map(({ employeeCode, day, value }) => ({ employeeCode, day, value })));
      }
    },
  },

  advance_add: {
    description: "Records an advance paid to an employee (opens a confirmation card). It is deducted from pay in the timesheet period of its date.",
    schema: object({
      employeeCode: codeField,
      amount: { type: "number" },
      currency: string("EUR, TRY or RSD", { enum: CURRENCIES }),
      date: string("YYYY-MM-DD; today if omitted"),
      description: string("Only if the user said a note; otherwise leave empty, do not invent one."),
    }, ["employeeCode", "amount"]),
    prepare({ employeeCode, amount, currency, date, description }) {
      const p = getPerson(employeeCode);
      const n = num(amount);
      if (!(n > 0)) throw new Error("The advance amount must be greater than zero.");
      const cur = currency || p.currency || "EUR";
      if (!CURRENCIES.includes(cur)) throw new Error(`Invalid currency: ${cur}`);
      const d = getDay(date);
      const data = { employeeCode: p.code, amount: round(n), currency: cur, date: d, description: String(description || "").trim() };
      return {
        title: "Advance",
        lines: [`${p.name} · ${money(data.amount, cur)} · ${dayText(d)}${data.description ? ` · ${data.description}` : ""}`],
        note: `Deducted from the earnings of ${timesheet.periodName(timesheet.periodOfDate(d))}.`,
        data,
      };
    },
    apply(data) {
      const { row } = ops.insert("advances", data);
      return { undo: { id: row._id } };
    },
    undo({ id }) {
      if (!db.findRow("advances", (x) => x._id === id)) throw new Error("The advance record no longer exists.");
      ops.remove("advances", id);
    },
  },

  cash_add: {
    description: "Writes manual income or an expense to cash (opens a confirmation card). For fuel, materials, bills, progress billing and similar. " +
      "Do NOT use it for advances, salary, meal allowance or rent.",
    schema: object({
      type: string("Income or Expense", { enum: ["Income", "Expense"] }),
      category: string("From the CASH CATEGORIES list", { enum: CASH_CATEGORIES }),
      amount: { type: "number" },
      currency: string("EUR, TRY or RSD", { enum: CURRENCIES }),
      date: string("YYYY-MM-DD; today if omitted"),
      description: string("What it is for"),
      project: string("Project code (if any)"),
      employeeCode: codeField,
    }, ["type", "amount", "description"]),
    prepare({ type, category, amount, currency, date, description, project, employeeCode }) {
      if (!["Income", "Expense"].includes(type)) throw new Error('Type must be "Income" or "Expense".');
      if (category && !CASH_CATEGORIES.includes(category)) throw new Error(`Category not in the list: ${category}`);
      if (["Advance", "Salary", "Meals", "Rent"].includes(category)) throw new Error(`${category} is not written to cash by hand: use advance_add for advances and payment_mark for payments.`);
      const n = num(amount);
      if (!(n > 0)) throw new Error("The amount must be greater than zero.");
      const cur = currency || "EUR";
      if (!CURRENCIES.includes(cur)) throw new Error(`Invalid currency: ${cur}`);
      const pr = project ? db.findRow("projects", (x) => x.code === project) : null;
      if (project && !pr) throw new Error(`No project with code "${project}".`);
      const p = employeeCode ? getPerson(employeeCode) : null;
      const data = {
        date: getDay(date), type, category: category || "", amount: round(n), currency: cur,
        description: String(description || "").trim(), project: pr?.code || "", employeeCode: p?.code || "", recurring: "No",
      };
      if (!data.description) throw new Error("The description cannot be empty.");
      return {
        title: `Cash · ${type}`,
        lines: [
          `${money(data.amount, cur)} · ${dayText(data.date)}${data.category ? ` · ${data.category}` : ""}`,
          data.description + (pr ? ` · ${pr.name}` : "") + (p ? ` · ${p.name}` : ""),
        ],
        data,
      };
    },
    apply(data) {
      const { row } = ops.insert("cash", data);
      return { undo: { id: row._id } };
    },
    undo({ id }) {
      if (!db.findRow("cash", (x) => x._id === id)) throw new Error("The cash row no longer exists.");
      ops.remove("cash", id);
    },
  },

  payment_mark: {
    description: "Marks a payment item (salary, hourly wages, meal allowance, rent) as 'paid' (opens a confirmation card). " +
      "Take the key from payment_list. Without an amount, the calculated amount counts as paid.",
    schema: object({
      key: string("The key from payment_list"),
      date: string("Payment date YYYY-MM-DD; today if omitted"),
      amount: { type: "number", description: "The amount actually paid (if it differs from the calculated one)" },
      note: string("Short note"),
    }, ["key"]),
    prepare({ key, date, amount, note }) {
      const existing = (db.table("payments") || []).find((r) => r.key === key);
      const k = payments.items().find((x) => x.key === key) || (existing && { ...existing, amount: existing.systemAmount });
      if (!k) throw new Error(`Payment item not found: ${key}. Call payment_list first.`);
      const d = getDay(date);
      const n = amount === undefined || amount === null || amount === "" ? k.amount : num(amount);
      if (!(n >= 0)) throw new Error("Invalid amount paid.");
      const data = { key, date: d, amount: round(n), note: String(note || "").trim() };
      const notes = [];
      if (data.amount !== k.amount) notes.push(`Calculated amount ${money(k.amount, k.currency)}; the difference shows on the Payments screen.`);
      if (existing) notes.push(`Already marked paid (${existing.date}, ${money(existing.amount, k.currency)}); it will be updated.`);
      return {
        title: "Paid mark",
        lines: [`${k.who} · ${k.description}`, `${money(data.amount, k.currency)} paid · ${dayText(d)}${data.note ? ` · ${data.note}` : ""}`],
        note: notes.join(" "),
        data,
      };
    },
    apply(data) {
      const previous = (db.table("payments") || []).find((r) => r.key === data.key);
      const undo = { key: data.key, previous: previous ? { date: previous.date, amount: previous.amount, note: previous.note } : null };
      payments.pay([data]);
      cash.sync();
      return { undo };
    },
    undo({ key, previous }) {
      if (previous) payments.pay([{ key, ...previous }]); else payments.undo(key);
      cash.sync();
    },
  },

  employee_update: {
    description: "Changes an employee's crew, house, role or status (opens a confirmation card). Pay CANNOT be changed. " +
      "An empty code ('') removes the crew or house.",
    schema: object({
      employeeCode: codeField,
      crew: string("Crew code, e.g. CRW-02; '' removes from the crew"),
      house: string("House code, e.g. HSE-01; '' removes from the house"),
      role: string("Role"),
      status: string("Active, On leave or Left", { enum: ["Active", "On leave", "Left"] }),
    }, ["employeeCode"]),
    prepare(args) {
      const p = getPerson(args.employeeCode);
      const name = (table, code) => (code ? `${code} ${db.findRow(table, (x) => x.code === code)?.name || ""}`.trim() : "none");
      const fields = {}, lines = [p.name];
      const LABEL = { crew: "Crew", house: "House", role: "Role", status: "Status" };
      for (const k of Object.keys(LABEL)) {
        if (!(k in args) || args[k] === undefined || args[k] === null) continue;
        const v = String(args[k]).trim();
        if (k === "crew" && v && !db.findRow("crews", (x) => x.code === v)) throw new Error(`No crew with number "${v}".`);
        if (k === "house" && v && !db.findRow("houses", (x) => x.code === v)) throw new Error(`No house with number "${v}".`);
        if (k === "status" && !["Active", "On leave", "Left"].includes(v)) throw new Error(`Invalid status: ${v}`);
        if (k === "status" && String(p.status || "") !== v && contracts.isStatusAutomatic(p.code)) {
          throw new Error(`${p.name}: the status is computed from employment periods and cannot be changed by voice. Edit it in the Employment Periods card on the employee page.`);
        }
        if (String(p[k] || "") === v) continue;
        fields[k] = v;
        const show = (x) => (k === "crew" ? name("crews", x) : k === "house" ? name("houses", x) : x || "none");
        lines.push(`${LABEL[k]}: ${show(p[k] || "")} → ${show(v)}`);
      }
      if (!Object.keys(fields).length) throw new Error(`Nothing changes for ${p.name}.`);
      const notes = [];
      if ("crew" in fields || "house" in fields) notes.push("Does not affect the open timesheet period; applies from newly opened periods.");
      if (fields.status === "Left") notes.push("A person marked Left is not taken into new timesheet periods.");
      return { title: "Employee", lines, note: notes.join(" "), data: { employeeCode: p.code, fields } };
    },
    apply({ employeeCode, fields }) {
      const p = getPerson(employeeCode);
      const old = Object.fromEntries(Object.keys(fields).map((k) => [k, p[k] || ""]));
      const { warning } = ops.update("employees", p._id, fields);
      return { undo: { id: p._id, old, fresh: fields }, warning };
    },
    undo({ id, old, fresh }) {
      const p = db.findRow("employees", (x) => x._id === id);
      if (!p) throw new Error("The employee record no longer exists.");
      for (const [k, v] of Object.entries(fresh)) {
        if (String(p[k] || "") !== v) throw new Error(`${p.name}: ${k} was changed afterwards; fix it by hand.`);
      }
      ops.update("employees", id, old);
    },
  },
};

const TOOL_DEFINITIONS = Object.entries(TOOLS).map(([name, t]) => ({
  type: "function",
  function: { name, description: t.description, parameters: t.schema },
}));

/* ------------------------------------------------------------------ */
/* Conversation loop                                                   */
/* ------------------------------------------------------------------ */

const conversations = new Map();   // id → { id, messages, time }
const cards = new Map();           // id → pending confirmation card

function cleanUp() {
  const now = Date.now();
  for (const [id, c] of conversations) if (now - c.time > CONVERSATION_TTL) conversations.delete(id);
  for (const [id, c] of cards) {
    if (now - c.time <= CARD_TTL) continue;
    cards.delete(id);
    writeEvent("expired", c);
  }
}

function getConversation(id) {
  let c = id ? conversations.get(id) : null;
  if (!c) { c = { id: newId(), messages: [] }; conversations.set(c.id, c); }
  c.time = Date.now();
  return c;
}

/** Keeps history short: everything before the last 6 user messages is dropped (a tool call is never split from its result). */
function trim(c) {
  const user = c.messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  if (user.length > 6) c.messages = c.messages.slice(user.at(-6));
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try { const v = JSON.parse(raw || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

const cardView = (c) => ({ id: c.id, tool: c.tool, title: c.title, lines: c.lines, note: c.note });

/**
 * Handles one command. Returns: { conversationId, text, reply, cards }
 * `trace`: for a voice command, the transcription details ({ start, audio }); added to the command log.
 */
export async function command(sentence, conversationId, trace = {}) {
  const text = String(sentence || "").trim();
  if (!text) throw new Error("The command is empty.");
  if (text.length > 2000) throw new Error("The command is too long.");
  cleanUp();
  const conv = getConversation(conversationId);
  conv.messages.push({ role: "user", content: text });
  trim(conv);

  const start = trace.start || Date.now();
  const rec = { ...recordBase("command"), source: trace.audio ? "voice" : "text", audio: trace.audio || null, conversationId: conv.id,
    priorMessages: conv.messages.length - 1, sentence: text, turns: [], cards: [], reply: "", error: null };
  const newCards = [];
  let reply = "";
  try {
    for (let turn = 0; turn < MAX_TURNS && !reply; turn += 1) {
      const d = new Date();
      const system = systemPrompt();
      const t0 = Date.now();
      const turnRec = { ms: 0, systemChars: system.length, messageCount: conv.messages.length, calls: [] };
      rec.turns.push(turnRec);
      const res = await n8n("kadro/assist", {
        system,
        now_local: `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        messages: conv.messages,
        tools: TOOL_DEFINITIONS,
      });
      turnRec.ms = Date.now() - t0;
      turnRec.usage = res.usage || null;
      const calls = Array.isArray(res.tool_calls) ? res.tool_calls : [];
      if (!calls.length) {
        turnRec.said = String(res.say || "");
        reply = String(res.say || "").trim() || "I didn't understand that; could you say it again?";
        conv.messages.push({ role: "assistant", content: reply });
        break;
      }
      conv.messages.push({
        role: "assistant", content: "",
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments || {}) } })),
      });

      let backToModel = false;
      for (const c of calls) {
        const tool = TOOLS[c.name];
        const callRec = { name: c.name, args: parseArgs(c.arguments) };
        turnRec.calls.push(callRec);
        let result;
        try {
          if (!tool) throw new Error(`No such tool: ${c.name}`);
          const args = parseArgs(c.arguments);
          if (tool.read) {
            result = tool.read(args);
            backToModel = true;
          } else {
            const h = tool.prepare(args);
            const card = { id: newId(), commandId: rec.id, conversationId: conv.id, tool: c.name, args, sentence: text, title: h.title, lines: h.lines, note: h.note || "", time: Date.now() };
            cards.set(card.id, card);
            callRec.cardId = card.id;
            newCards.push(cardView(card));
            result = `Confirmation card shown: ${h.title} — ${h.lines.join("; ")}. It will be written when the user presses Approve; NOT written yet.`;
          }
        } catch (e) {
          result = `ERROR: ${e.message}`;
          backToModel = true;
        }
        callRec.result = log.cut(result);
        conv.messages.push({ role: "tool", tool_call_id: c.id, name: c.name, content: String(result) });
      }

      // Only valid write cards: no need to go back to the model, the reply is built here.
      if (!backToModel) {
        reply = newCards.length === 1 ? "Check and approve." : `${newCards.length} actions ready; check and approve.`;
        conv.messages.push({ role: "assistant", content: reply });
      }
    }
    if (!reply) reply = "I couldn't finish this command; please say it in shorter parts.";
  } catch (e) {
    rec.error = e.message;
    throw e;
  } finally {
    rec.reply = reply;
    rec.cards = newCards.map(({ id, tool, title, lines, note }) => ({ id, tool, title, lines, note }));
    rec.ms = Date.now() - start;
    log.write(rec);
  }
  return { conversationId: conv.id, text, reply, cards: newCards };
}

// Whisper does not stay silent on silence, it makes things up: memorised subtitle phrases ("Thanks for watching!")
// or a repeat of the name hint. The transcribe workflow only looks at no_speech_prob, so they are dropped here.
const CANNED = new Set(["thank you", "thanks for watching", "thanks for watching the video", "please subscribe", "subscribe",
  "you", "music", "applause", "bye", "thank you very much"]);
const simplify = (s) => String(s).toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function isHallucination(text, hint) {
  const norm = simplify(text);
  const words = norm ? norm.split(" ") : [];
  if (!words.length) return true;
  if (words.length <= 4 && CANNED.has(norm)) return true;
  // A repeat of the hint. No fixed ratio here: most Kadro commands are mostly names
  // ("Ahet Demir and Cem Polat were absent" → 67% names). Counted as a repeat: the start of the hint ("kadro timesheet")
  // or a run of at least 4 words that contains no word outside the hint.
  const hintWords = new Set(simplify(hint).split(" "));
  return norm.startsWith("kadro timesheet") || (words.length >= 4 && words.every((w) => hintWords.has(w)));
}

/** Transcribes audio. Returns: { text, raw, dropped }; text is empty if there was no speech (or Whisper made it up). */
async function transcribe(filePath, mime) {
  const type = String(mime || "audio/webm").split(";")[0];
  const ext = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" }[type] || "webm";
  const hint = nameHint();
  const fd = new FormData();
  fd.append("audio", new Blob([fs.readFileSync(filePath)], { type }), `audio.${ext}`);
  fd.append("language", "en");
  fd.append("prompt", hint);
  const v = await n8n("kadro/transcribe", fd);
  const raw = String(v.transcript || "").trim();
  if (v.no_speech) return { text: "", raw, dropped: "whisper: no speech" };
  if (isHallucination(raw, hint)) return { text: "", raw, dropped: "canned phrase or hint repeat" };
  return { text: raw, raw, dropped: null };
}

/** Voice command: transcribes, then handles it like command(). A recording with no speech is logged too (to improve transcription). */
export async function voiceCommand(filePath, mime, conversationId) {
  const start = Date.now();
  const audio = { type: String(mime || "").split(";")[0], size: fs.statSync(filePath).size, ms: 0, raw: "", dropped: null };
  const empty = (extra) => log.write({ ...recordBase("command"), source: "voice", audio, conversationId: conversationId || null, sentence: "",
    turns: [], cards: [], reply: "", error: null, ms: audio.ms, ...extra });
  let t;
  try { t = await transcribe(filePath, mime); }
  catch (e) {
    audio.ms = Date.now() - start;
    empty({ error: e.message });
    throw e;
  }
  Object.assign(audio, { ms: Date.now() - start, raw: t.raw, dropped: t.dropped });
  if (!t.text) {
    const reply = "No speech heard; please try again.";
    empty({ reply });
    return { conversationId: conversationId || null, text: "", reply, cards: [] };
  }
  return command(t.text, conversationId, { start, audio });
}

/* ------------------------------------------------------------------ */
/* Approve, cancel, undo                                               */
/* ------------------------------------------------------------------ */

const logView = (r) => ({
  id: r._id, date: r.date, user: r.user, sentence: r.sentence, title: r.title, lines: r.lines,
  undoneAt: r.undoneAt || null,
});

export function approve(id) {
  const c = cards.get(id);
  if (!c) throw new Error("This card has expired or was already handled. Say the command again.");
  const tool = TOOLS[c.tool];
  // The data may have changed since the card opened: the same validation runs again.
  let h, result;
  try {
    h = tool.prepare(c.args);
    result = tool.apply(h.data);
  } catch (e) {
    writeEvent("approve_error", c, { error: e.message });
    throw e;
  }
  cards.delete(id);
  const row = db.insertRow("assistantLog", {
    date: new Date().toISOString(), user: db.settings().user, sentence: c.sentence,
    tool: c.tool, title: h.title, lines: h.lines, undo: result.undo, commandId: c.commandId, cardId: c.id,
  });
  // If the data changed since the card opened, the written lines differ from the card's; both are logged.
  writeEvent("approved", c, { lines: h.lines, cardLines: c.lines, warning: result.warning || null,
    seconds: Math.round((Date.now() - c.time) / 1000) });
  return { record: logView(row), warning: result.warning || null };
}

export function cancel(id) {
  const c = cards.get(id);
  cards.delete(id);
  if (c) writeEvent("cancelled", c, { seconds: Math.round((Date.now() - c.time) / 1000) });
  return { cancelled: true };
}

export function undo(id) {
  const r = db.findRow("assistantLog", (x) => x._id === id);
  if (!r) throw new Error("Action record not found.");
  if (r.undoneAt) throw new Error("This action was already undone.");
  try { TOOLS[r.tool].undo(r.undo); }
  catch (e) { writeEvent("undo_error", r, { error: e.message }); throw e; }
  const row = db.updateRow("assistantLog", id, { undoneAt: new Date().toISOString(), undoneBy: db.settings().user });
  writeEvent("undone", r, { seconds: Math.round((Date.now() - new Date(r.date).getTime()) / 1000) });
  return { record: logView(row) };
}

export function status() {
  const { url, ready } = config();
  let server = "";
  try { server = url ? new URL(url).host : ""; } catch { server = url; }
  return { ready, server, log: db.table("assistantLog").slice(-30).reverse().map(logView) };
}
