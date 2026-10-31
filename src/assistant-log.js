/**
 * Voice command log: what was said, what the model did, how it ended, how long it took, how many tokens it used.
 * The point is to review commands later and improve the assistant (with the client's consent, 25 October 2026).
 *
 * Every record is first written on this computer: data/assistant-log/<year-month>.jsonl (permanent archive) and
 * pending.jsonl (to be sent). Pending records are sent in batches to the n8n kadro/log endpoint, which writes them
 * to the "kadro_log" data table. Without internet, or if the server rejects them, nothing is lost: they go next time.
 *
 * At most one send every 15 minutes: the n8n guard counts 100 requests per day per workflow.
 * Audio is never stored; IBANs, phone numbers, passports and notes never reach the assistant in the first place.
 */
import fs from "node:fs";
import path from "node:path";

const INTERVAL = 15 * 60_000;     // minimum time between sends
const BATCH = 50;                 // records per request
const RESULT_LIMIT = 2000;        // tool results are cut at this many characters in the log

let dir = null;
let sender = null;                // (records) => Promise; wired up by assistant.js
let lastAttempt = 0;
let sending = false;
let timer = null;

const pendingPath = () => path.join(dir, "pending.jsonl");
const monthPath = (time) => path.join(dir, `${String(time).slice(0, 7)}.jsonl`);

/** Called by server.js at startup. Records waiting to be sent go out shortly after. */
export function start(dataDir, send) {
  dir = path.join(dataDir, "assistant-log");
  fs.mkdirSync(dir, { recursive: true });
  sender = send;
  timer ??= setInterval(() => { flush(); }, INTERVAL).unref();
  setTimeout(() => { flush(); }, 30_000).unref();
}

export const cut = (s, n = RESULT_LIMIT) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}… (+${t.length - n} chars)` : t;
};

/** Appends a record to the local archive and the send queue. A logging failure never breaks a command. */
export function write(record) {
  if (!dir) return;
  try {
    const line = `${JSON.stringify(record)}\n`;
    fs.appendFileSync(monthPath(record.time), line, "utf8");
    fs.appendFileSync(pendingPath(), line, "utf8");
  } catch (e) {
    console.error(`[assistant log] could not write: ${e.message}`);
  }
  flush();
}

/** Sends pending records to the server. `force` ignores the interval (tests and shutdown). */
export async function flush(force = false) {
  if (!dir || !sender || sending) return { sent: 0 };
  if (!force && Date.now() - lastAttempt < INTERVAL) return { sent: 0 };
  let lines;
  try { lines = fs.readFileSync(pendingPath(), "utf8").split("\n").filter(Boolean); }
  catch { return { sent: 0 }; }
  if (!lines.length) return { sent: 0 };

  sending = true;
  lastAttempt = Date.now();
  let sent = 0;
  try {
    while (sent < lines.length) {
      const chunk = lines.slice(sent, sent + BATCH);
      const records = chunk.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      if (records.length) await sender(records);
      sent += chunk.length;
    }
  } catch (e) {
    console.error(`[assistant log] could not send, will retry later: ${e.message}`);
  } finally {
    // Sent records leave the queue; records added in the meantime stay.
    if (sent) {
      try {
        const now = fs.readFileSync(pendingPath(), "utf8").split("\n").filter(Boolean);
        fs.writeFileSync(pendingPath(), now.slice(sent).map((s) => `${s}\n`).join(""), "utf8");
      } catch (e) { console.error(`[assistant log] could not update the queue: ${e.message}`); }
    }
    sending = false;
  }
  return { sent };
}

/** For settings and tests: how many records are queued, when the last attempt was. */
export function status() {
  let pending = 0;
  try { pending = fs.readFileSync(pendingPath(), "utf8").split("\n").filter(Boolean).length; } catch {}
  return { pending, lastAttempt: lastAttempt ? new Date(lastAttempt).toISOString() : null };
}
