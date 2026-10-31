/**
 * Fixed exchange rates: entered by hand (no online rates).
 *
 * Setting: { base: "EUR", rate: { RSD: 117, TRY: 45 } } → 1 EUR = 117 RSD, 1 EUR = 45 TRY.
 * The base currency is used for "≈ total" in summaries. When a timesheet period is opened the rates are copied into it;
 * payments and deductions are converted with the period's rates, so a later change does not affect opened periods.
 */
import * as db from "./db.js";

export const CURRENCIES = ["EUR", "TRY", "RSD"];
export const DEFAULT_RATES = { base: "EUR", rate: { RSD: 117 } };

const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const fmt = (n, digits = 4) => Number(n).toLocaleString("en-GB", { maximumFractionDigits: digits });

/** Validates incoming rate settings; invalid rates are rejected. */
export function validate(r) {
  const base = CURRENCIES.includes(r?.base) ? r.base : "EUR";
  const rate = {};
  for (const cur of CURRENCIES) {
    if (cur === base) continue;
    const v = r?.rate?.[cur];
    if (v === undefined || v === null || v === "") continue;
    const n = num(v);
    if (!(n > 0) || n > 1e9) throw new Error(`Invalid rate: 1 ${base} = ${v} ${cur}. Enter a number greater than zero.`);
    rate[cur] = Number(n.toPrecision(10));   // keeps small rates such as 1 RSD = 0.008547008547 EUR
  }
  return { base, rate };
}

/** Current rates from settings. */
export function rateSettings() {
  try { return validate(db.settings().rates || DEFAULT_RATES); } catch { return { ...DEFAULT_RATES }; }
}

const table = (rates) => ({ ...(rates?.rate || {}), [rates?.base || "EUR"]: 1 });

/** 1 from = x to. null if there is no rate. */
export function factor(from, to, rates) {
  if (from === to) return 1;
  const t = table(rates);
  return t[from] && t[to] ? t[to] / t[from] : null;
}

/** Converts an amount; null if there is no rate. */
export function convert(amount, from, to, rates) {
  const f = factor(from, to, rates);
  return f === null ? null : amount * f;
}

/** Readable form of the conversion: "÷ 117", "× 117"; via the base when neither side is the base: "÷ 117 × 45". */
export function conversionText(from, to, rates) {
  const f = factor(from, to, rates);
  if (f === null || f === 1) return "";
  const base = rates?.base || "EUR", t = table(rates);
  if (from !== base && to !== base) return `÷ ${fmt(t[from])} × ${fmt(t[to])}`;
  return f < 1 ? `÷ ${fmt(1 / f)}` : `× ${fmt(f)}`;
}

/** { EUR: 10, RSD: 1170 } → total in the base currency; currencies without a rate go to `missing`. */
export function baseTotal(totals, rates) {
  const base = rates?.base || "EUR";
  let amount = 0;
  const missing = [];
  for (const [cur, v] of Object.entries(totals || {})) {
    if (!v) continue;
    const c = convert(v, cur, base, rates);
    if (c === null) missing.push(cur); else amount += c;
  }
  return { currency: base, amount: Math.round(amount * 100) / 100, missing };
}
