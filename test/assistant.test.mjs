// Voice command end to end: Kadro (test copy) + fake n8n. Run by test/run.sh.
//   node test/assistant.test.mjs <kadroPort> <calls.jsonl> <db.json>
import fs from "node:fs";

const PORT = process.argv[2] || 4417;
const CALLS = process.argv[3];
const DB_PATH = process.argv[4];
const API = `http://127.0.0.1:${PORT}/api`;
let failed = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "  ✓" : "  ✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!cond) failed += 1; };
async function j(route, method = "GET", body) {
  const r = await fetch(API + route, { method, headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const v = await r.json();
  return { status: r.status, ...v };
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const period = `${today().slice(0, 7)}-${+today().slice(8) <= 15 ? 1 : 2}`;
const cell = async (code, day = today()) => (await j(`/timesheet/${period}`)).record.rows.find((r) => r.employeeCode === code)?.cells[day] || "";
const calls = () => fs.readFileSync(CALLS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const assistCount = () => calls().filter((x) => x.route === "/webhook/kadro/assist").length;

console.log("1) Status and context");
const st = await j("/status");
ok(st.assistant.ready, "assistant ready (from environment variables)");
const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
ok(st.version === VERSION, `version ${VERSION}`, st.version);

console.log("2) Timesheet: two people, one call");
let n0 = assistCount();
let r = await j("/assistant/text", "POST", { text: "Cem was absent today, Tolga worked 10 hours" });
ok(r.cards.length === 1 && r.cards[0].lines.length === 2, "one card, two lines", JSON.stringify(r.cards[0]?.lines));
ok(assistCount() - n0 === 1, "writes only: one call to n8n", `${assistCount() - n0}`);
ok(/approve/.test(r.reply), "reply built by Kadro", r.reply);
ok(await cell("KDR-2026-0010") === "", "cell empty before approval");
const first = await j("/assistant/approve", "POST", { id: r.cards[0].id });
ok(first.record?.id, "approved, added to the log");
ok(await cell("KDR-2026-0010") === "–" && await cell("KDR-2026-0015") === "10", "Cem absent, Tolga 10 hours written");
const again = await j("/assistant/approve", "POST", { id: r.cards[0].id });
ok(again.status === 400, "the same card cannot be approved twice", again.error);

console.log("3) Undo");
let u = await j("/assistant/undo", "POST", { id: first.record.id });
ok(u.record?.undoneAt, "undone");
ok(await cell("KDR-2026-0010") === "" && await cell("KDR-2026-0015") === "", "cells back to what they were");
u = await j("/assistant/undo", "POST", { id: first.record.id });
ok(u.status === 400, "a second undo is rejected", u.error);

console.log("4) Advance + cancel");
const adv0 = (await j("/table/advances")).rows.length;
r = await j("/assistant/text", "POST", { text: "I gave Mehmet a 100 euro advance" });
ok(r.cards[0]?.title === "Advance" && /Mehmet Kaya · 100 EUR/.test(r.cards[0].lines[0]), "advance card", r.cards[0]?.lines[0]);
await j("/assistant/cancel", "POST", { id: r.cards[0].id });
ok((await j("/table/advances")).rows.length === adv0, "nothing written after cancel");
const c2 = await j("/assistant/approve", "POST", { id: r.cards[0].id });
ok(c2.status === 400, "a cancelled card cannot be approved");
r = await j("/assistant/text", "POST", { text: "I gave Mehmet a 100 euro advance" });
await j("/assistant/approve", "POST", { id: r.cards[0].id });
const advances = (await j("/table/advances")).rows;
ok(advances.length === adv0 + 1 && advances.at(-1).employeeCode === "KDR-2026-0004" && Number(advances.at(-1).amount) === 100, "advance written");
const cashAdvance = (await j(`/cash/${today().slice(0, 7)}`)).rows.some((x) => x.category === "Advance" && x.employeeCode === "KDR-2026-0004" && Number(x.amount) === 100 && x.date === today());
ok(cashAdvance, "advance went to cash by itself");

console.log("5) Two tasks in one sentence: cash expense + advance, both approved");
r = await j("/assistant/text", "POST", { text: "I bought 60 euro of fuel and gave Murat a 50 advance" });
ok(r.cards.length === 2, "two cards", r.reply);
ok(/Murat Aydın · 50 EUR/.test(r.cards[1]?.lines[0] || ""), "currency from the person (EUR)", r.cards[1]?.lines[0]);
for (const c of r.cards) await j("/assistant/approve", "POST", { id: c.id });
const cashMonth = (await j(`/cash/${today().slice(0, 7)}`)).rows;
ok(cashMonth.some((x) => x.category === "Fuel" && Number(x.amount) === 60 && x.source === "Manual"), "fuel expense in cash (Manual)");

console.log("6) Read tool: two turns");
n0 = assistCount();
r = await j("/assistant/text", "POST", { text: "How much will Murat get this month?" });
ok(assistCount() - n0 === 2, "read: two calls to n8n");
ok(r.cards.length === 0 && /Info:/.test(r.reply) && /Murat Aydın/.test(r.reply), "reply from tool data", r.reply.slice(0, 120));

console.log("7) A closed period is refused, the model gives the reason");
r = await j("/assistant/text", "POST", { text: "Cem worked 8 hours on 10 September" });
ok(r.cards.length === 0 && /closed/.test(r.reply), "no card, reason given", r.reply);

console.log("8) Unknown employee code");
r = await j("/assistant/text", "POST", { text: "advance for someone made-up" });
ok(r.cards.length === 0 && /No employee/.test(r.reply), "made-up code rejected", r.reply);

console.log("9) Ambiguous name → question → follow-up in the same conversation");
r = await j("/assistant/text", "POST", { text: "Demir is on leave today" });
ok(/Which Demir/.test(r.reply) && !r.cards.length, "question asked", r.reply);
const cid = r.conversationId;
r = await j("/assistant/text", "POST", { text: "the one called Ahet", conversationId: cid });
ok(r.cards.length === 1 && /Ahet Demir/.test(r.cards[0].lines[0]) && /leave/.test(r.cards[0].lines[0]), "follow-up understood", r.cards[0]?.lines[0]);
const fresh = await j("/assistant/text", "POST", { text: "the one called Ahet" });
ok(!fresh.cards.length, "no context in a new conversation (expected)");

console.log("10) Payment: list → mark (3 turns, last turn writes)");
r = await j("/assistant/text", "POST", { text: "Cem's hourly wages were paid" });
ok(r.cards[0]?.title === "Paid mark", "payment card", JSON.stringify(r.cards[0]?.lines));
ok(/Calculated amount/.test(r.cards[0]?.note || ""), "different amount note", r.cards[0]?.note);
const pm = await j("/assistant/approve", "POST", { id: r.cards[0].id });
const key = JSON.parse(calls().filter((x) => x.answer?.tool_calls?.[0]?.name === "payment_mark").at(-1).answer.tool_calls[0].arguments).key;
let pmMonth = await j(`/payments/${today().slice(0, 7)}`);
let item = pmMonth.days.flatMap((d) => d.groups.flatMap((g) => g.items)).find((k) => k.key === key);
ok(item?.paid && item.payment.amount === 300, "paid (300)", key);
await j("/assistant/undo", "POST", { id: pm.record.id });
pmMonth = await j(`/payments/${today().slice(0, 7)}`);
item = pmMonth.days.flatMap((d) => d.groups.flatMap((g) => g.items)).find((k) => k.key === key);
ok(item && !item.paid, "unpaid after undo");

console.log("11) Employee crew change + undo");
r = await j("/assistant/text", "POST", { text: "Move Tolga to the Novi Sad Electrical crew" });
ok(/Serbia1 → CRW-02 Novi Sad Electrical/.test(r.cards[0]?.lines.join(" ") || "") && /newly opened periods/.test(r.cards[0]?.note || ""), "crew card + period note", r.cards[0]?.lines.join(" | "));
const ec = await j("/assistant/approve", "POST", { id: r.cards[0].id });
let tolga = (await j("/table/employees")).rows.find((p) => p.code === "KDR-2026-0015");
ok(tolga.crew === "CRW-02", "crew changed");
const openPeriodCrew = (await j(`/timesheet/${period}`)).record.rows.find((x) => x.employeeCode === "KDR-2026-0015").crew;
ok(openPeriodCrew === "CRW-01", "the open period's snapshot did not change", openPeriodCrew);
await j("/assistant/undo", "POST", { id: ec.record.id });
tolga = (await j("/table/employees")).rows.find((p) => p.code === "KDR-2026-0015");
ok(tolga.crew === "CRW-01", "undone");

console.log("12) Undo conflict: a cell changed by hand afterwards");
r = await j("/assistant/text", "POST", { text: "Cem was absent today, Tolga worked 10 hours" });
const c3 = await j("/assistant/approve", "POST", { id: r.cards[0].id });
await j(`/timesheet/${period}/cells`, "PUT", { employeeCode: "KDR-2026-0010", day: today(), value: "8" });
u = await j("/assistant/undo", "POST", { id: c3.record.id });
ok(u.status === 400 && /changed afterwards/.test(u.error), "undo stopped on conflict", u.error);
ok(await cell("KDR-2026-0015") === "10", "no cell was touched");

console.log("13) Voice: transcription and name hint");
const fd = new FormData();
fd.append("audio", new Blob(["I gave Mehmet a 100 euro advance"], { type: "audio/webm;codecs=opus" }), "command.webm");
r = await j("/assistant/voice", "POST", fd);
ok(r.text === "I gave Mehmet a 100 euro advance" && r.cards.length === 1, "audio → text → card", r.text);
const t = calls().filter((x) => x.route === "/webhook/kadro/transcribe").at(-1);
ok(t.language === "en" && t.file === "audio.webm" && t.type === "audio/webm", "language en, file name/type right", `${t.language} ${t.file} ${t.type}`);
ok(/Ahet Demir/.test(t.hint) && /Burak Öztürk/.test(t.hint) === false, "the hint has active names, not people who left", t.hint.slice(0, 80));
const silent = new FormData();
silent.append("audio", new Blob([""], { type: "audio/webm" }), "command.webm");
r = await j("/assistant/voice", "POST", silent);
ok(!r.cards.length && /No speech/.test(r.reply), "silent recording", r.reply);
ok(fs.readdirSync(DB_PATH.replace(/db\.json$/, "tmp")).length === 0, "temporary audio files deleted");

console.log("14) Error codes");
r = await j("/assistant/text", "POST", { text: "give an empty answer" });
ok(r.status === 400 && /empty answer/.test(r.error), "model_empty in plain words", r.error);

console.log("15) Privacy: no IBAN/phone/notes in any request to the model");
const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
const secrets = db.employees.flatMap((p) => [p.iban, p.phone, p.notes]).filter((x) => x && String(x).length > 4);
const all = calls().map((x) => x.raw || "").join("\n");
const leaked = secrets.filter((x) => all.includes(String(x)));
ok(secrets.length > 0 && leaked.length === 0, `none of ${secrets.length} secret values was sent`, leaked.join(", "));
ok(!/"payHistory"/.test(all) && !/"iban"/.test(all), "no raw employee record was sent");

console.log("16) Log and backup");
const s = await j("/assistant");
ok(s.log.length >= 6 && s.log[0].sentence, "log, latest action first", `${s.log.length} records`);
await j("/settings", "POST", { assistantKey: "secret-key-123", assistantUrl: "https://n8n.example.org" });
const backup = await (await fetch(`${API}/backup`)).text();
ok(!backup.includes("secret-key-123") && backup.includes("n8n.example.org"), "key not in the backup, address is");
const bad = await j("/settings", "POST", { assistantUrl: "http://plain.com" });
ok(bad.status === 400, "non-https address rejected", bad.error);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
