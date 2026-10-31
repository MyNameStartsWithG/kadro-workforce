/**
 * Sets up a test folder: test/sample-data.json → <folder>/data/db.json, UI files in <folder>/public.
 * For the privacy tests a few people get a FAKE IBAN, phone number and note; the tests check that these
 * never reach the assistant, the log or a backup.
 *
 *   node test/prepare.mjs <folder>
 *   node test/prepare.mjs --clean <real-backup.json> test/sample-data.json
 *     (to rebuild the sample data from a real backup: personal fields are emptied)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const PERSONAL = /^(phone|iban|email|taxId|passportNo|address|notes)$|(Phone|Iban|Email)$/;

if (process.argv[2] === "--clean") {
  const [, , , input, output] = process.argv;
  const g = JSON.parse(fs.readFileSync(input, "utf8").replace(/^﻿/, ""));
  const d = g.data || g;
  for (const table of Object.values(d)) {
    if (!Array.isArray(table)) continue;
    for (const row of table) for (const k of Object.keys(row)) if (PERSONAL.test(k)) row[k] = "";
  }
  for (const k of Object.keys(d.settings || {})) if (/key/i.test(k)) delete d.settings[k];
  fs.writeFileSync(output, JSON.stringify(d, null, 2));
  console.log(`cleaned → ${output}`);
  process.exit(0);
}

const target = path.resolve(process.argv[2] || path.join(ROOT, "test", ".work"));
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, "data"), { recursive: true });
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "sample-data.json"), "utf8"));
d.employees[2].iban = "RS35105008123123123173";
d.employees[2].phone = "+381641234567";
d.employees[3].notes = "Manager note: confidential appraisal";
d.employees[9].iban = "TR330006100519786457841326";
fs.writeFileSync(path.join(target, "data", "db.json"), JSON.stringify(d, null, 2));
// A server started with KADRO_FOLDER reads the UI from <folder>/public.
fs.cpSync(path.join(ROOT, "public"), path.join(target, "public"), { recursive: true });
console.log(`test folder ready: ${target}`);
