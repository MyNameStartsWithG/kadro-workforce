// Fake n8n: speaks the same contract as /webhook/kadro/transcribe, /webhook/kadro/assist and /webhook/kadro/log.
// The "model" is rule-based: it calls tools based on keywords in the sentence. Every request is written to calls.jsonl.
//   node test/mock-n8n.mjs <port> <calls.jsonl>
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.argv[2] || 4499);
const CALLS = process.argv[3] || "calls.jsonl";
const KEY = "test-key";
fs.writeFileSync(CALLS, "");

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
let counter = 0;
const call = (name, args) => ({ id: `call_${++counter}`, name, arguments: JSON.stringify(args) });

function model(body) {
  const sys = body.system || "";
  const code = (name) => sys.split("\n").find((l) => l.includes(name))?.split(" | ")[0];
  const m = body.messages;
  const last = m.at(-1);
  if (last.role === "tool") {
    const results = [];
    for (let i = m.length - 1; i >= 0 && m[i].role === "tool"; i -= 1) results.unshift(m[i]);
    const error = results.find((t) => t.content.startsWith("ERROR"));
    if (error) return { say: `Couldn't do it: ${error.content.slice(7)}` };
    const list = results.find((t) => t.name === "payment_list");
    if (list) {
      const line = list.content.split("\n").find((l) => l.includes("Hourly wages") && l.includes("unpaid"));
      if (!line) return { say: "No unpaid hourly wages." };
      return { tool_calls: [call("payment_mark", { key: /key=(\S+)/.exec(line)[1], amount: 300 })] };
    }
    return { say: `Info: ${results.map((t) => t.content).join(" ").slice(0, 300)}` };
  }
  const u = last.content.toLowerCase();
  const earlier = m.filter((x) => x.role === "assistant" && x.content).map((x) => x.content).join(" ");
  if (u.includes("ahet") && earlier.includes("Which Demir")) return { tool_calls: [call("timesheet_write", { changes: [{ employeeCode: code("Ahet Demir"), day: today(), value: "L" }] })] };
  if (u.includes("demir")) return { say: "Which Demir? Ahet Demir or Volkan Demir?" };
  if (u.includes("absent") && u.includes("worked")) {
    return { tool_calls: [call("timesheet_write", { changes: [
      { employeeCode: code("Cem Polat"), day: today(), value: "–" },
      { employeeCode: code("Tolga Er"), day: today(), value: "10" },
    ] })] };
  }
  if (u.includes("made-up")) return { tool_calls: [call("advance_add", { employeeCode: "KDR-1999-9999", amount: 10 })] };
  if (u.includes("september")) return { tool_calls: [call("timesheet_write", { changes: [{ employeeCode: code("Cem Polat"), day: "2026-09-10", value: "8" }] })] };
  if (u.includes("fuel") && u.includes(" and ")) {
    return { tool_calls: [
      call("cash_add", { type: "Expense", category: "Fuel", amount: 60, description: "Van fuel" }),
      call("advance_add", { employeeCode: code("Murat Aydın"), amount: 50 }),
    ] };
  }
  if (u.includes("advance")) return { tool_calls: [call("advance_add", { employeeCode: code("Mehmet Kaya"), amount: 100, currency: "EUR" })] };
  if (u.includes("how much")) return { tool_calls: [call("person_summary", { employeeCode: code("Murat Aydın") })] };
  if (u.includes("paid")) return { tool_calls: [call("payment_list", { employeeCode: code("Cem Polat"), month: "2026-10" })] };
  if (u.includes("on leave")) return { tool_calls: [call("employee_update", { employeeCode: code("Tolga Er"), status: "On leave" })] };
  if (u.includes("crew")) return { tool_calls: [call("employee_update", { employeeCode: code("Tolga Er"), crew: "CRW-02" })] };
  if (u.includes("empty")) return { error_code: "model_empty", error: "The model returned an empty answer." };
  return { say: "Please do that on screen." };
}

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const send = (status, v) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(v)); };
  const rec = { route: req.url, keyOk: req.headers["x-api-key"] === KEY, size: body.length };
  try {
    if (req.headers["x-api-key"] !== KEY) { fs.appendFileSync(CALLS, JSON.stringify(rec) + "\n"); return send(403, { error: "The API key was rejected.", error_code: "bad_key" }); }
    if (req.url === "/webhook/kadro/transcribe") {
      const fd = await new Response(body, { headers: { "content-type": req.headers["content-type"] } }).formData();
      const audio = fd.get("audio");
      const raw = (await audio.text()).trim();
      // Real audio (the browser's fake microphone): binary data, return a fixed sentence.
      const text = raw.includes("�") ? "How much will Murat get this month?" : raw;
      rec.audioSize = audio.size;
      Object.assign(rec, { file: audio.name, type: audio.type, language: fd.get("language"), hint: fd.get("prompt"), text });
      fs.appendFileSync(CALLS, JSON.stringify(rec) + "\n");
      return send(200, text ? { no_speech: false, transcript: text, language: "english" } : { no_speech: true, transcript: "" });
    }
    if (req.url === "/webhook/kadro/assist") {
      const b = JSON.parse(body.toString("utf8"));
      const answer = model(b);
      if (!answer.error_code) answer.usage = { prompt_tokens: 3000, completion_tokens: 40, prompt_cache_hit_tokens: 2800 };
      Object.assign(rec, { raw: body.toString("utf8"), answer });
      fs.appendFileSync(CALLS, JSON.stringify(rec) + "\n");
      return send(200, answer);
    }
    if (req.url === "/webhook/kadro/log") {
      // Like the real workflow: wants a records array, returns the row count. Received records go to a separate file.
      const b = JSON.parse(body.toString("utf8"));
      if (!Array.isArray(b.records) || !b.records.length) return send(400, { error: "records empty" });
      for (const r of b.records) fs.appendFileSync(CALLS.replace(/\.jsonl$/, "-received.jsonl"), JSON.stringify(r) + "\n");
      Object.assign(rec, { count: b.records.length });
      fs.appendFileSync(CALLS, JSON.stringify(rec) + "\n");
      return send(200, { ok: true, count: b.records.length });
    }
    send(404, { code: 404, message: "The requested webhook is not registered." });
  } catch (e) { send(500, { message: e.message }); }
}).listen(PORT, "127.0.0.1", () => console.log(`fake n8n ${PORT}`));
