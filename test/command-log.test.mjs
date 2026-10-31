// Voice command log: every command and card event is archived locally and sent to the server (kadro/log) in batches.
//   node test/command-log.test.mjs <kadroPort> <test folder> <fake n8n calls.jsonl>
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = process.argv[2] || 4417;
const FOLDER = process.argv[3];
const CALLS = process.argv[4];
const RECEIVED = CALLS.replace(/\.jsonl$/, "-received.jsonl");
const API = `http://127.0.0.1:${PORT}/api`;
const LOG_DIR = path.join(FOLDER, "data", "assistant-log");
let failed = 0;
const ok = (c, name, extra = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!c) failed += 1; };
const j = async (route, body) => {
  const r = await fetch(API + route, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};
const voice = async (text) => {
  const fd = new FormData();
  fd.append("audio", new Blob([text], { type: "audio/webm" }), "rec.webm");
  const r = await fetch(`${API}/assistant/voice`, { method: "POST", body: fd });
  return { status: r.status, ...(await r.json()) };
};
const lines = (f) => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((s) => JSON.parse(s)); } catch { return []; } };
const month = new Date().toISOString().slice(0, 7);
const archive = () => lines(path.join(LOG_DIR, `${month}.jsonl`));

console.log("1) Commands");
const adv = await j("/assistant/text", { text: "I gave Mehmet a 100 euro advance" });
ok(adv.cards?.length === 1, "advance card opened");
const appr = await j("/assistant/approve", { id: adv.cards[0].id });
ok(appr.record?.id, "approved");
await j("/assistant/undo", { id: appr.record.id });
const question = await j("/assistant/text", { text: "How much will Murat get this month?" });
ok(question.reply?.startsWith("Info:"), "read question (two turns)");
const crew = await j("/assistant/text", { text: "Move Tolga to the Novi Sad crew" });
await j("/assistant/cancel", { id: crew.cards[0].id });
const spoken = await voice("I gave Mehmet a 100 euro advance");
ok(spoken.cards?.length === 1, "voice command card opened");
const silent = await voice("");
ok(silent.reply?.includes("No speech"), "silent recording");
const empty = await j("/assistant/text", { text: "give an empty answer" });
ok(empty.status >= 400, "model error returned to the user", empty.error);

console.log("2) Local archive");
const a = archive();
const commands = a.filter((k) => k.kind === "command"), events = a.filter((k) => k.kind === "event");
ok(commands.length === 6, "6 command records", String(commands.length));
ok(events.map((e) => e.event).join(",") === "approved,undone,cancelled", "events: approved, undone, cancelled", events.map((e) => e.event).join(","));
const k1 = commands.find((k) => k.sentence === "I gave Mehmet a 100 euro advance" && k.source === "text");
ok(k1 && k1.version && k1.time && k1.ms >= 0 && k1.conversationId, "common fields (version, time, duration, conversation)", k1 && `${k1.version} ${k1.ms} ms`);
ok(k1?.turns?.length === 1 && k1.turns[0].usage?.prompt_tokens === 3000 && k1.turns[0].systemChars > 500,
  "turn: tokens and context size", k1 && JSON.stringify({ usage: k1.turns[0].usage, system: k1.turns[0].systemChars }));
const c1 = k1?.turns[0].calls[0];
ok(c1?.name === "advance_add" && c1.args?.amount === 100 && c1.cardId === k1.cards[0].id, "tool call: name, arguments, card link");
ok(events[0].commandId === k1.id && events[0].cardId === k1.cards[0].id, "approval event linked to the command");
ok(events[1].commandId === k1.id, "the undo event is linked to the same command");
const k2 = commands.find((k) => k.sentence === "How much will Murat get this month?");
ok(k2?.turns?.length === 2 && k2.turns[0].calls[0].name === "person_summary" && k2.turns[0].calls[0].result.length > 50 && k2.turns[1].said,
  "two-turn question: read result and the model's answer", k2 && `${k2.turns.length} turns`);
const k3 = commands.find((k) => k.source === "voice" && k.sentence);
ok(k3?.audio?.size > 0 && k3.audio.raw === k3.sentence && k3.audio.ms >= 0 && k3.audio.type === "audio/webm", "audio: size, raw text, transcription time", k3 && JSON.stringify(k3.audio));
const k4 = commands.find((k) => k.source === "voice" && !k.sentence);
ok(k4?.audio?.dropped && k4.reply.includes("No speech"), "silent audio is logged too", k4?.audio?.dropped);
const k5 = commands.find((k) => k.error);
ok(k5?.error?.includes("empty") && k5.sentence === "give an empty answer", "model error in the log", k5?.error);

console.log("3) Privacy");
const text = fs.readFileSync(path.join(LOG_DIR, `${month}.jsonl`), "utf8");
const secrets = ["RS35105008123123123173", "+381641234567", "Manager note", "TR330006100519786457841326", "test-key"];
ok(secrets.every((s) => !text.includes(s)), "no IBAN, phone, note or key in the log");

console.log("4) Sending to the server");
const before = await j("/assistant/log");
ok(before.pending >= 1, "the first record went at once, the rest are queued (15-minute limit)", `pending ${before.pending}`);
const sent = await j("/assistant/log/send", {});
ok(sent.pending === 0 && sent.sent === before.pending, "a forced send emptied the queue", JSON.stringify(sent));
const received = lines(RECEIVED);
ok(received.length === a.length && received.map((x) => x.id).join() === a.map((x) => x.id).join(), "sent = archive, same order", `${received.length}/${a.length}`);
const requests = lines(CALLS).filter((x) => x.route === "/webhook/kadro/log");
ok(requests.length === 2 && requests.every((x) => x.keyOk), "two requests (first record + batch), with the key", requests.map((x) => x.count).join("+"));

console.log("5) Nothing lost while the server is down");
process.env.KILL?.split(",").forEach((pid) => { try { process.kill(Number(pid)); } catch {} });
await new Promise((r) => setTimeout(r, 500));
const offline = await j("/assistant/text", { text: "I gave Mehmet a 100 euro advance" });
ok(offline.status >= 400 && /Could not reach/.test(offline.error), "connection error shown to the user", offline.error);
const s2 = await j("/assistant/log/send", {});
ok(s2.pending === 1 && s2.sent === 0, "not sent, still queued", JSON.stringify(s2));
const second = CALLS.replace(/\.jsonl$/, "2.jsonl");
const mock = spawn(process.execPath, [process.env.MOCK, "4499", second], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const s3 = await j("/assistant/log/send", {});
ok(s3.pending === 0 && s3.sent === 1, "sent once the server is back", JSON.stringify(s3));
const last = lines(second.replace(/\.jsonl$/, "-received.jsonl"));
ok(last[0]?.error && /Could not reach/.test(last[0].error), "the connection error record reached the server too");
mock.kill();

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
