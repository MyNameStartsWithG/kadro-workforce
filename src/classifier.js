/**
 * LAYER 2 — reads an incoming document and decides which folder it belongs in.
 *
 * Two stages:
 *   1) Rule engine — keywords in the file name + names/plates/codes from the tables.
 *      Instant, free, offline.
 *   2) Claude      — when the rules are not confident enough, reads the INSIDE of the document
 *      (PDFs and images included) and picks the section itself.
 *
 * Claude gets a fixed "section catalogue" rather than the full folder list; matching the
 * person/project/vehicle is done in code. The prompt stays constant (so it is cached) and the
 * cost does not grow with the number of employees.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { flatTree, TEMPLATES } from "./structure.js";
import { dynamicPath } from "./folders.js";
import * as db from "./db.js";

const MODEL = "claude-opus-5";

/* ------------------------------------------------------------------ */
/* Normalisation (Turkish and Serbian letters in names)                 */
/* ------------------------------------------------------------------ */

const LETTER = { ç: "c", ğ: "g", ı: "i", i̇: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u", č: "c", ć: "c", đ: "d", š: "s", ž: "z" };

export function normalize(s) {
  return String(s || "")
    .replace(/İ/g, "i").replace(/I/g, "i")
    .toLocaleLowerCase("tr")
    .replace(/[çğıiöşüâîûčćđšž]/g, (c) => LETTER[c] || c)
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Date extraction                                                     */
/* ------------------------------------------------------------------ */

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Extracts a date from a file name. Returns: { year, month, day } or null */
export function findDate(raw) {
  const s = normalize(raw);
  let m;
  if ((m = /\b(20\d{2})[ ]?(0[1-9]|1[0-2])[ ]?(0[1-9]|[12]\d|3[01])\b/.exec(s)))
    return { year: +m[1], month: +m[2], day: +m[3] };
  if ((m = /\b(0[1-9]|[12]\d|3[01])[ ](0[1-9]|1[0-2])[ ](20\d{2})\b/.exec(s)))
    return { year: +m[3], month: +m[2], day: +m[1] };
  if ((m = /\b(20\d{2})[ ](0[1-9]|1[0-2])\b/.exec(s))) return { year: +m[1], month: +m[2], day: null };
  if ((m = /\b(0[1-9]|1[0-2])[ ](20\d{2})\b/.exec(s))) return { year: +m[2], month: +m[1], day: null };
  for (const [name, no] of Object.entries(MONTHS)) {
    const re = new RegExp(`\\b${name}\\b[ ]?(20\\d{2})?`);
    if ((m = re.exec(s))) return { year: m[1] ? +m[1] : new Date().getFullYear(), month: no, day: null };
  }
  if ((m = /\b(20\d{2})\b/.exec(s))) return { year: +m[1], month: null, day: null };
  return null;
}

export function dateText(d) {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, "0");
  if (d.day) return `${d.year}-${p(d.month)}-${p(d.day)}`;
  if (d.month) return `${d.year}-${p(d.month)}`;
  return `${d.year}`;
}

/* ------------------------------------------------------------------ */
/* Record matching (person / vehicle / project / client)                */
/* ------------------------------------------------------------------ */

const DISTINCTIVE_MIN = 4; // shorter words never count as a match on their own

function matchRecord(nName) {
  const candidates = [];

  for (const p of db.table("employees")) {
    let score = 0;
    if (p.code && nName.includes(normalize(p.code))) score = 1;
    else {
      const parts = normalize(p.name).split(" ").filter((w) => w.length >= DISTINCTIVE_MIN);
      const hits = parts.filter((w) => nName.includes(w));
      if (parts.length && hits.length === parts.length) score = 0.95;
      else if (hits.length >= 2) score = 0.85;
      else if (hits.length === 1 && parts.length === 1) score = 0.6;
      else if (hits.length === 1) score = 0.45;
    }
    if (score > 0) candidates.push({ type: "employee", row: p, score, label: `${p.code} ${p.name}` });
  }

  for (const v of db.table("vehicles")) {
    const np = normalize(v.plate);
    if (np && np.length >= 4 && nName.includes(np)) {
      candidates.push({ type: "vehicle", row: v, score: 1, label: `${v.plate} ${v.make || ""}`.trim() });
    }
  }

  for (const pr of db.table("projects")) {
    if (pr.code && nName.includes(normalize(pr.code))) {
      candidates.push({ type: "project", row: pr, score: 1, label: pr.name });
      continue;
    }
    const parts = normalize(pr.name).split(" ").filter((w) => w.length >= DISTINCTIVE_MIN);
    const hits = parts.filter((w) => nName.includes(w));
    if (parts.length && hits.length === parts.length) candidates.push({ type: "project", row: pr, score: 0.9, label: pr.name });
    else if (hits.length >= 1 && parts.length > 1) candidates.push({ type: "project", row: pr, score: 0.55, label: pr.name });
  }

  for (const c of db.table("clients")) {
    if (c.code && nName.includes(normalize(c.code))) {
      candidates.push({ type: "client", row: c, score: 1, label: c.name });
      continue;
    }
    const parts = normalize(c.name).split(" ").filter((w) => w.length >= DISTINCTIVE_MIN);
    const hits = parts.filter((w) => nName.includes(w));
    if (parts.length && hits.length === parts.length) candidates.push({ type: "client", row: c, score: 0.9, label: c.name });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

/* ------------------------------------------------------------------ */
/* Rule engine                                                         */
/* ------------------------------------------------------------------ */

function keywordScore(nName, keywords) {
  let best = 0, found = null, count = 0;
  for (const k of keywords || []) {
    const nk = normalize(k);
    if (!nk || !nName.includes(nk)) continue;
    count += 1;
    const w = Math.min(0.92, 0.42 + nk.replace(/ /g, "").length * 0.035);
    if (w > best) { best = w; found = k; }
  }
  return { score: best, keyword: found, count };
}

/**
 * Rule-based classification.
 * Returns: { targetPath, confidence, reason, docType, related, date, method: "rules" }
 */
export function byRules(fileName) {
  const nName = normalize(path.basename(fileName, path.extname(fileName)));
  const record = matchRecord(nName);
  const date = findDate(fileName);
  const fixed = flatTree().filter((d) => d.target && d.keywords.length);

  const candidates = [];

  // 1) If a record matches, look at its template folders first.
  if (record) {
    const base = dynamicPath(record.type, record.row);
    for (const sub of TEMPLATES[record.type] || []) {
      const { score, keyword, count } = keywordScore(nName, sub.keywords);
      if (score > 0) {
        candidates.push({
          targetPath: `${base}/${sub.c} ${sub.n}`,
          score: Math.min(0.97, score + record.score * 0.28 + (count > 1 ? 0.05 : 0)),
          docType: sub.n,
          keyword,
          record,
        });
      }
    }
  }

  // 2) Static folders.
  for (const d of fixed) {
    const { score, keyword, count } = keywordScore(nName, d.keywords);
    if (score > 0) {
      candidates.push({
        targetPath: d.path,
        score: Math.min(0.94, score + (count > 1 ? 0.06 : 0)),
        docType: d.title,
        keyword,
        record: null,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];

  if (!top) {
    return {
      targetPath: null, confidence: 0, method: "rules",
      reason: record
        ? `The record "${record.label}" was recognised, but not the document type.`
        : "No known keyword in the file name.",
      docType: null,
      related: record ? record.label : null,
      date: dateText(date),
      alternatives: [],
    };
  }

  const reasons = [`the word "${top.keyword}" points to the ${top.docType} folder`];
  if (top.record) reasons.push(`the file name contains "${top.record.label}"`);
  if (date) reasons.push(`date: ${dateText(date)}`);

  return {
    targetPath: top.targetPath,
    confidence: Math.round(top.score * 100) / 100,
    method: "rules",
    reason: reasons.join(", ") + ".",
    docType: top.docType,
    related: top.record ? top.record.label : null,
    relatedType: top.record ? top.record.type : null,
    date: dateText(date),
    alternatives: candidates.slice(1, 4).map((a) => ({ targetPath: a.targetPath, confidence: Math.round(a.score * 100) / 100 })),
  };
}

/* ------------------------------------------------------------------ */
/* Claude layer                                                        */
/* ------------------------------------------------------------------ */

/** Fixed section catalogue — its order never changes, so the prompt can be cached. */
function sectionCatalog() {
  const lines = [];
  for (const d of flatTree()) {
    if (d.dynamic || !d.target) continue;
    lines.push(`  ${d.path}\n      ${d.description}`);
  }
  const dynamics = [
    ["employee", "A document belonging to an EMPLOYEE"],
    ["project", "A document belonging to a PROJECT"],
    ["vehicle", "A document belonging to a VEHICLE"],
    ["client", "A document belonging to a CLIENT"],
  ];
  for (const [type, heading] of dynamics) {
    lines.push(`\n  --- ${heading} (always fill relatedName) ---`);
    for (const sub of TEMPLATES[type]) {
      lines.push(`  ${type}:${sub.c}\n      ${sub.n} — ${sub.d}`);
    }
  }
  return lines.join("\n");
}

const SYSTEM_PREFIX =
  `You are the document routing specialist of ACME Engineering. The company does electrical and ` +
  `engineering contracting in Serbia; part of the staff is Turkish, and documents may be in English, Serbian or Turkish.\n\n` +
  `You are given one document. Your task: decide WHICH SECTION of the filing structure below ` +
  `it belongs to.\n\n` +
  `RULES:\n` +
  `- Always give your decision by calling the "classify_document" tool. Do not answer in plain text.\n` +
  `- Put ONE of the values from the list below, exactly, in "section".\n` +
  `- If the document belongs to an employee/project/vehicle/client, use the short form such as "employee:06" ` +
  `and put the person's/project's/vehicle's name in "relatedName" as written in the document.\n` +
  `- If you are not sure, give a low confidence; do not guess. If no section fits, leave section empty.\n\n` +
  `SECTION LIST:\n`;

const TOOL = {
  name: "classify_document",
  description: "Reports the section the document belongs to and the identifying details read from it.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      section: { type: "string", description: "One of the values in the section list, exactly. Empty string if none fits." },
      relatedName: { type: "string", description: "The person/project/vehicle/client name in the document. Empty string if none." },
      docType: { type: "string", description: "Short English name of the document. E.g. Payslip, Casco policy, Sales invoice." },
      date: { type: "string", description: "Date of the document: YYYY-MM-DD or YYYY-MM. Empty string if none." },
      confidence: { type: "number", description: "Reliability of the decision, between 0 and 1." },
      reason: { type: "string", description: "One-sentence reason in English." },
    },
    required: ["section", "relatedName", "docType", "date", "confidence", "reason"],
    additionalProperties: false,
  },
};

const IMAGE = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
const PLAIN_TEXT = new Set([".txt", ".csv", ".md", ".log", ".json", ".xml", ".htm", ".html"]);
const MAX_PDF = 30 * 1024 * 1024;

function contentBlocks(tempPath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const blocks = [];
  let read = "none";

  try {
    const size = fs.statSync(tempPath).size;
    if (ext === ".pdf" && size <= MAX_PDF) {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: fs.readFileSync(tempPath).toString("base64") },
      });
      read = "pdf";
    } else if (IMAGE[ext] && size <= 8 * 1024 * 1024) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: IMAGE[ext], data: fs.readFileSync(tempPath).toString("base64") },
      });
      read = "image";
    } else if (PLAIN_TEXT.has(ext) && size <= 2 * 1024 * 1024) {
      const text = fs.readFileSync(tempPath, "utf8").slice(0, 8000);
      blocks.push({ type: "text", text: `File content:\n\n${text}` });
      read = "text";
    }
  } catch (e) {
    console.error("[ai] content could not be read:", e.message);
  }
  return { blocks, read };
}

let clientCache = { key: null, client: null };

function getClient(apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY || "";
  if (!key) return null;
  if (clientCache.key !== key) {
    clientCache = { key, client: new Anthropic({ apiKey: key }) };
  }
  return clientCache.client;
}

/** Turns the short section code returned by Claude into a real folder path. */
function resolveSection(section, relatedName, ruleRecord) {
  if (!section) return { targetPath: null, related: null, relatedType: null };

  const dynamic = /^(employee|project|vehicle|client):(\d{2})$/.exec(section.trim());
  if (!dynamic) {
    const exists = flatTree().find((d) => d.path === section.trim() && d.target);
    return { targetPath: exists ? exists.path : null, related: null, relatedType: null };
  }

  const [, type, code] = dynamic;
  const sub = (TEMPLATES[type] || []).find((a) => a.c === code);
  if (!sub) return { targetPath: null, related: null, relatedType: null };

  // Resolve the record from what the rule engine found first, otherwise from the name Claude read.
  let record = ruleRecord && ruleRecord.type === type ? ruleRecord : null;
  if (!record && relatedName) record = matchRecord(normalize(relatedName));
  if (!record || record.type !== type) {
    return { targetPath: null, related: relatedName || null, relatedType: type, missingRecord: { type, name: relatedName, subCode: code } };
  }

  const base = dynamicPath(type, record.row);
  return { targetPath: `${base}/${sub.c} ${sub.n}`, related: record.label, relatedType: type };
}

/** Asks Claude. On error returns { error } — the caller falls back to the rule result. */
export async function byClaude(tempPath, fileName, apiKey, ruleResult) {
  const client = getClient(apiKey);
  if (!client) return { error: "No API key configured." };

  const { blocks, read } = contentBlocks(tempPath, fileName);
  const nName = normalize(path.basename(fileName, path.extname(fileName)));
  const ruleRecord = matchRecord(nName);

  const hints = [];
  if (ruleRecord) hints.push(`The file name matches the record "${ruleRecord.label}" in the system.`);
  if (ruleResult?.date) hints.push(`Date in the file name: ${ruleResult.date}`);
  if (read === "none") hints.push("The content of this file type could not be read; decide from the file name only.");

  const content = [
    ...blocks,
    {
      type: "text",
      text:
        `File name: ${fileName}\n` +
        (hints.length ? `\nHints from the system:\n- ${hints.join("\n- ")}\n` : "") +
        `\nClassify this document.`,
    },
  ];

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM_PREFIX + sectionCatalog(), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      tools: [TOOL],
    });

    if (response.stop_reason === "refusal") {
      return { error: "The model declined to assess this document; the rule result is used." };
    }

    const call = response.content.find((b) => b.type === "tool_use" && b.name === "classify_document");
    if (!call) return { error: "The model did not return a classification." };

    const g = call.input;
    const res = resolveSection(g.section, g.relatedName, ruleRecord);

    return {
      targetPath: res.targetPath,
      confidence: res.targetPath ? Math.max(0, Math.min(1, Number(g.confidence) || 0)) : 0,
      method: "claude",
      reason: g.reason || "",
      docType: g.docType || null,
      related: res.related,
      relatedType: res.relatedType,
      missingRecord: res.missingRecord || null,
      date: g.date || ruleResult?.date || null,
      read,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens || 0,
      },
    };
  } catch (e) {
    console.error("[ai] Claude error:", e.message);
    return { error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/* Suggested file name                                                 */
/* ------------------------------------------------------------------ */

const DATED_FOLDER = /(Payslip|Payroll|Timesheet|Receipt|Invoice|Bank|Tax|Account|Progress Billing|Fuel)/i;

export function suggestedName(fileName, result) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext).replace(/\s+/g, " ").trim();

  // Already starts with a date: leave it alone.
  if (/^\d{4}[-_. ]\d{2}/.test(stem)) return stem + ext;
  if (!result.date) return stem + ext;

  const monthOnly = result.targetPath && DATED_FOLDER.test(result.targetPath);
  const prefix = monthOnly ? result.date.slice(0, 7) : result.date;
  if (!/^\d{4}/.test(prefix)) return stem + ext;
  return `${prefix} ${stem}${ext}`;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Classifies a file. Rules and/or Claude run depending on the mode in Settings.
 * Returns: the rule result + the AI result (if any) + the chosen final suggestion.
 */
export async function classify(tempPath, fileName) {
  const { aiMode, apiKey, threshold } = db.settings();
  const rules = byRules(fileName);

  const aiAvailable = Boolean(apiKey || process.env.ANTHROPIC_API_KEY);
  const aiNeeded =
    aiMode === "aiOnly" ||
    (aiMode === "hybrid" && (rules.confidence < (threshold ?? 0.72) || !rules.targetPath));

  let ai = null;
  if (aiAvailable && aiMode !== "rulesOnly" && aiNeeded) {
    ai = await byClaude(tempPath, fileName, apiKey, rules);
  }

  let chosen = rules;
  if (ai && !ai.error && ai.targetPath && ai.confidence >= rules.confidence) chosen = ai;
  else if (ai && !ai.error && ai.targetPath && !rules.targetPath) chosen = ai;

  const notes = [];
  if (!aiAvailable && aiMode !== "rulesOnly") notes.push("No API key entered, so only the rules ran.");
  if (ai?.error) notes.push(`The AI layer was skipped: ${ai.error}`);
  if (ai?.missingRecord) {
    notes.push(
      `The document seems to belong to "${ai.missingRecord.name}", but that name is not in the ${ai.missingRecord.type} records. ` +
      `Add the record first, then upload again.`
    );
  }
  if (chosen.confidence < 0.5) notes.push("Low confidence — check the target and change it by hand if needed.");

  return {
    fileName,
    rules,
    ai,
    targetPath: chosen.targetPath,
    confidence: chosen.confidence,
    method: chosen.targetPath ? chosen.method : "none",
    reason: chosen.reason,
    docType: chosen.docType,
    related: chosen.related || null,
    date: chosen.date || null,
    suggestedName: suggestedName(fileName, chosen),
    alternatives: rules.alternatives || [],
    notes,
  };
}
