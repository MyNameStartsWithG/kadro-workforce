// Commands against the real model (through a real kadro/assist): no card is approved, it only shows what the model proposes.
//   KADRO_ASSISTANT_URL=... KADRO_ASSISTANT_KEY=... node server.js   (on port 4417, with a test folder)
//   node test/real-model-check.mjs
const API = "http://127.0.0.1:4417/api";
const j = async (route, body) => {
  const r = await fetch(API + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};
const commands = [
  ["Cem was absent today, Tolga worked 10 hours"],
  ["I gave Mehmet a 100 euro advance"],
  ["yesterday everyone in crew 1 worked 8 hours"],
  ["I bought 60 euro of fuel and gave Murat a 50 advance"],
  ["How much will Murat get this month?"],
  ["Demir is on leave today", "the one called Ahet"],
  ["Cem worked 8 hours on the 10th of September"],
  ["Move Tolga to the Novi Sad Electrical crew"],
  ["Cem's hourly wages for the 2nd half of September are paid, I gave him 300 euro"],
  ["Set Hasan's pay to 2000 euro"],
  ["Who was absent today?"],
  ["Give Emre a five thousand dinar advance"],
];
for (const chain of commands) {
  let conversationId = null;
  for (const text of chain) {
    const t0 = Date.now();
    const r = await j("/assistant/text", { text, conversationId });
    conversationId = r.conversationId;
    console.log(`\n> ${text}   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    if (r.error) { console.log(`  ERROR: ${r.error}`); continue; }
    console.log(`  reply: ${r.reply}`);
    for (const k of r.cards) console.log(`  [${k.title}] ${k.lines.join(" | ")}${k.note ? `  (note: ${k.note})` : ""}`);
  }
}
