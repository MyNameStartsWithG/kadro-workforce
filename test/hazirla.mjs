/**
 * Test klasörünü kurar: test/ornek-veri.json → <klasör>/veri/db.json, arayüz dosyaları <klasör>/public.
 * Gizlilik testleri için birkaç kişiye SAHTE IBAN, telefon ve not yazılır; testler bunların asistana,
 * kayda ve yedeğe gitmediğini kontrol eder.
 *
 *   node test/hazirla.mjs <klasör>
 *   node test/hazirla.mjs --temizle <gercek-yedek.json> test/ornek-veri.json
 *     (örnek veriyi gerçek bir yedekten yeniden üretmek için: kişisel alanlar boşaltılır)
 */
import fs from "node:fs";
import path from "node:path";

const KOK = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const KISISEL = /^(telefon|iban|eposta|email|tcKimlik|pasaportNo|adres|notlar)$|(Tel|Telefon|Iban|Eposta)$/;

if (process.argv[2] === "--temizle") {
  const [, , , giris, cikis] = process.argv;
  const g = JSON.parse(fs.readFileSync(giris, "utf8").replace(/^﻿/, ""));
  const v = g.veri || g;
  for (const tablo of Object.values(v)) {
    if (!Array.isArray(tablo)) continue;
    for (const satir of tablo) for (const k of Object.keys(satir)) if (KISISEL.test(k)) satir[k] = "";
  }
  for (const k of Object.keys(v.ayarlar || {})) if (/anahtar|key/i.test(k)) delete v.ayarlar[k];
  fs.writeFileSync(cikis, JSON.stringify(v, null, 2));
  console.log(`temizlendi → ${cikis}`);
  process.exit(0);
}

const hedef = path.resolve(process.argv[2] || path.join(KOK, "test", ".calisma"));
fs.rmSync(hedef, { recursive: true, force: true });
fs.mkdirSync(path.join(hedef, "veri"), { recursive: true });
const v = JSON.parse(fs.readFileSync(path.join(KOK, "test", "ornek-veri.json"), "utf8"));
v.personel[2].iban = "RS35105008123123123173";
v.personel[2].telefon = "+381641234567";
v.personel[3].notlar = "Yönetici notu: gizli değerlendirme";
v.personel[9].iban = "TR330006100519786457841326";
fs.writeFileSync(path.join(hedef, "veri", "db.json"), JSON.stringify(v, null, 2));
// KADRO_KLASOR ile açılan sunucu arayüzü <klasör>/public altından okur.
fs.cpSync(path.join(KOK, "public"), path.join(hedef, "public"), { recursive: true });
console.log(`test klasörü hazır: ${hedef}`);
