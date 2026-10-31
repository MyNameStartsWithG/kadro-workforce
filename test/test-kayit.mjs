// Sesli komut kaydı: her komut ve kart olayı yerelde arşivlenir, sunucuya (kadro/log) toplu gider.
//   node test-kayit.mjs <kadroPort> <test klasörü> <sahte n8n gunluk.jsonl>
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = process.argv[2] || 4417;
const KLASOR = process.argv[3];
const GUNLUK = process.argv[4];
const ALINAN = GUNLUK.replace(/\.jsonl$/, "-kayit.jsonl");
const API = `http://127.0.0.1:${PORT}/api`;
const KAYIT_DIZINI = path.join(KLASOR, "veri", "asistan-kayit");
let hata = 0;
const ok = (k, ad, ek = "") => { console.log(`${k ? "  ✓" : "  ✗"} ${ad}${ek ? ` — ${ek}` : ""}`); if (!k) hata += 1; };
const j = async (yol, govde) => {
  const r = await fetch(API + yol, govde === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde) });
  return { durum: r.status, ...(await r.json()) };
};
const ses = async (metin) => {
  const fd = new FormData();
  fd.append("ses", new Blob([metin], { type: "audio/webm" }), "kayit.webm");
  const r = await fetch(`${API}/asistan/ses`, { method: "POST", body: fd });
  return { durum: r.status, ...(await r.json()) };
};
const satirlar = (f) => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((s) => JSON.parse(s)); } catch { return []; } };
const ay = new Date().toISOString().slice(0, 7);
const arsiv = () => satirlar(path.join(KAYIT_DIZINI, `${ay}.jsonl`));

console.log("1) Komutlar");
const avans = await j("/asistan/metin", { metin: "Mehmet'e 100 euro avans verdim" });
ok(avans.kartlar?.length === 1, "avans kartı açıldı");
const onay = await j("/asistan/onayla", { id: avans.kartlar[0].id });
ok(onay.kayit?.id, "onaylandı");
await j("/asistan/geri-al", { id: onay.kayit.id });
const soru = await j("/asistan/metin", { metin: "Murat bu ay ne alacak?" });
ok(soru.cevap?.startsWith("Bilgi:"), "okuma sorusu (iki tur)");
const ekip = await j("/asistan/metin", { metin: "Tolga'yı Novi Sad ekibine al" });
await j("/asistan/vazgec", { id: ekip.kartlar[0].id });
const sesli = await ses("Mehmet'e 100 euro avans verdim");
ok(sesli.kartlar?.length === 1, "sesli komut kartı açıldı");
const sessiz = await ses("");
ok(sessiz.cevap?.includes("duyulmadı"), "sessiz kayıt");
const bos = await j("/asistan/metin", { metin: "boş cevap ver" });
ok(bos.durum >= 400, "model hatası kullanıcıya döndü", bos.hata);

console.log("2) Yerel arşiv");
const a = arsiv();
const komutlar = a.filter((k) => k.tip === "komut"), olaylar = a.filter((k) => k.tip === "olay");
ok(komutlar.length === 6, "6 komut kaydı", String(komutlar.length));
ok(olaylar.map((o) => o.olay).join(",") === "onay,geri_al,vazgec", "olaylar: onay, geri al, vazgeç", olaylar.map((o) => o.olay).join(","));
const k1 = komutlar.find((k) => k.cumle === "Mehmet'e 100 euro avans verdim" && k.kaynak === "metin");
ok(k1 && k1.surum && k1.zaman && k1.sureMs >= 0 && k1.konusmaId, "ortak alanlar (sürüm, zaman, süre, konuşma)", k1 && `${k1.surum} ${k1.sureMs} ms`);
ok(k1?.turlar?.length === 1 && k1.turlar[0].token?.prompt_tokens === 3000 && k1.turlar[0].sistemKarakter > 500,
  "tur: token ve bağlam büyüklüğü", k1 && JSON.stringify({ token: k1.turlar[0].token, sistem: k1.turlar[0].sistemKarakter }));
const c1 = k1?.turlar[0].cagrilar[0];
ok(c1?.ad === "avans_ekle" && c1.arguman?.tutar === 100 && c1.kartId === k1.kartlar[0].id, "araç çağrısı: ad, argüman, kart bağı");
ok(olaylar[0].komutId === k1.id && olaylar[0].kartId === k1.kartlar[0].id, "onay olayı komuta bağlı");
ok(olaylar[1].komutId === k1.id, "geri alma olayı da aynı komuta bağlı");
const k2 = komutlar.find((k) => k.cumle === "Murat bu ay ne alacak?");
ok(k2?.turlar?.length === 2 && k2.turlar[0].cagrilar[0].ad === "kisi_ozeti" && k2.turlar[0].cagrilar[0].sonuc.length > 50 && k2.turlar[1].soyledi,
  "iki turlu soru: okuma sonucu ve modelin cevabı", k2 && `${k2.turlar.length} tur`);
const k3 = komutlar.find((k) => k.kaynak === "ses" && k.cumle);
ok(k3?.ses?.boyut > 0 && k3.ses.ham === k3.cumle && k3.ses.sureMs >= 0 && k3.ses.tur === "audio/webm", "ses: boyut, ham metin, yazıya dökme süresi", k3 && JSON.stringify(k3.ses));
const k4 = komutlar.find((k) => k.kaynak === "ses" && !k.cumle);
ok(k4?.ses?.elendi && k4.cevap.includes("duyulmadı"), "duyulmayan ses de kayıtta", k4?.ses?.elendi);
const k5 = komutlar.find((k) => k.hata);
ok(k5?.hata?.includes("boş") && k5.cumle === "boş cevap ver", "model hatası kayıtta", k5?.hata);

console.log("3) Gizlilik");
const metin = fs.readFileSync(path.join(KAYIT_DIZINI, `${ay}.jsonl`), "utf8");
const gizli = ["RS35105008123123123173", "+381641234567", "Yönetici notu", "TR330006100519786457841326", "test-anahtar"];
ok(gizli.every((g) => !metin.includes(g)), "IBAN, telefon, not ve anahtar kayıtta yok");

console.log("4) Sunucuya gönderim");
const once = await j("/asistan/kayit");
ok(once.bekleyen >= 1, "ilk kayıt hemen gitti, gerisi kuyrukta (15 dk sınırı)", `bekleyen ${once.bekleyen}`);
const g = await j("/asistan/kayit/gonder", {});
ok(g.bekleyen === 0 && g.gonderilen === once.bekleyen, "zorla gönderim kuyruğu boşalttı", JSON.stringify(g));
const alinan = satirlar(ALINAN);
ok(alinan.length === a.length && alinan.map((x) => x.id).join() === a.map((x) => x.id).join(), "sunucuya giden = arşiv, aynı sıra", `${alinan.length}/${a.length}`);
const istekler = satirlar(GUNLUK).filter((x) => x.yol === "/webhook/kadro/log");
ok(istekler.length === 2 && istekler.every((x) => x.anahtar), "iki istek (ilk kayıt + toplu), anahtarla", istekler.map((x) => x.adet).join("+"));

console.log("5) Sunucu kapalıyken kayıp yok");
process.env.KAPAT?.split(",").forEach((pid) => { try { process.kill(Number(pid)); } catch {} });
await new Promise((r) => setTimeout(r, 500));
const kopuk = await j("/asistan/metin", { metin: "Mehmet'e 100 euro avans verdim" });
ok(kopuk.durum >= 400 && /ulaşılamadı/.test(kopuk.hata), "bağlantı hatası kullanıcıya", kopuk.hata);
const g2 = await j("/asistan/kayit/gonder", {});
ok(g2.bekleyen === 1 && g2.gonderilen === 0, "gönderilemedi, kuyrukta duruyor", JSON.stringify(g2));
const yeni = spawn(process.execPath, [process.env.MOCK, "4499", GUNLUK.replace(/\.jsonl$/, "2.jsonl")], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const g3 = await j("/asistan/kayit/gonder", {});
ok(g3.bekleyen === 0 && g3.gonderilen === 1, "sunucu dönünce gitti", JSON.stringify(g3));
const son = satirlar(GUNLUK.replace(/\.jsonl$/, "2-kayit.jsonl"));
ok(son[0]?.hata && /ulaşılamadı/.test(son[0].hata), "bağlantı hatası kaydı da sunucuda");
yeni.kill();

console.log(hata ? `\n${hata} HATA` : "\nHEPSİ GEÇTİ");
