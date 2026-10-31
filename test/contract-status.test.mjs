// A person with employment periods cannot have their status changed by voice; a person without can.
const API = "http://127.0.0.1:4417/api";
const j = async (route, body, method = "POST") => {
  const r = await fetch(API + route, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};
let failed = 0;
const ok = (c, name, extra = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!c) failed++; };
const person = (await j("/table/employees", null, "GET")).rows.find((p) => p.name === "Tolga Er");
console.log("person:", person?.code, person?.status);
const before = await j("/assistant/text", { text: "Tolga is on leave" });
ok(before.cards?.length === 1 && before.cards[0].lines.join(" ").includes("On leave"), "no contract: status card opens", before.cards?.[0]?.lines.join(" | "));
if (before.cards?.[0]) await j("/assistant/cancel", { id: before.cards[0].id });
const c = await j("/table/contracts", { employeeCode: person.code, type: "Work", start: "2026-09-01", end: "" });
ok(c.status === 200, "contract added", c.error || "");
const after = await j("/assistant/text", { text: "Tolga is on leave" });
ok(!after.cards?.length, "with a contract: no card", after.reply);
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
