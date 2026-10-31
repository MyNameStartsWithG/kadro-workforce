// Sesli komut uçtan uca testi: KADRO (test kopyası) + sahte n8n. test/calistir.sh çalıştırır.
//   node test-asistan.mjs <kadroPort> <gunluk.jsonl> <db.json>
import fs from "node:fs";

const PORT = process.argv[2] || 4417;
const GUNLUK = process.argv[3];
const DBYOL = process.argv[4];
const API = `http://127.0.0.1:${PORT}/api`;
let hata = 0;
const ok = (kosul, ad, ek = "") => { console.log(`${kosul ? "  ✓" : "  ✗"} ${ad}${ek ? ` — ${ek}` : ""}`); if (!kosul) hata += 1; };
async function j(yol, method = "GET", govde) {
  const r = await fetch(API + yol, { method, headers: govde instanceof FormData ? undefined : { "Content-Type": "application/json" }, body: govde instanceof FormData ? govde : govde ? JSON.stringify(govde) : undefined });
  const v = await r.json();
  return { durum: r.status, ...v };
}
const bugun = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const donem = `${bugun().slice(0, 7)}-${+bugun().slice(8) <= 15 ? 1 : 2}`;
const hucre = async (kod, gun = bugun()) => (await j(`/puantaj/${donem}`)).kayit.satirlar.find((s) => s.personelKod === kod)?.hucre[gun] || "";
const gunlukSatirlari = () => fs.readFileSync(GUNLUK, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const assistSayisi = () => gunlukSatirlari().filter((x) => x.yol === "/webhook/kadro/assist").length;

console.log("1) Durum ve bağlam");
const d = await j("/durum");
ok(d.asistan.hazir, "asistan hazır (ortam değişkeniyle)");
const SURUM = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
ok(d.surum === SURUM, `sürüm ${SURUM}`, d.surum);

console.log("2) Puantaj: iki kişi, tek çağrı");
let n0 = assistSayisi();
let r = await j("/asistan/metin", "POST", { metin: "Cem bugün gelmedi, Tolga 10 saat çalıştı" });
ok(r.kartlar.length === 1 && r.kartlar[0].satirlar.length === 2, "tek kart, iki satır", JSON.stringify(r.kartlar[0]?.satirlar));
ok(assistSayisi() - n0 === 1, "sadece yazma: n8n'e tek çağrı", `${assistSayisi() - n0}`);
ok(/onaylayın/.test(r.cevap), "cevabı KADRO kurdu", r.cevap);
ok(await hucre("KDR-2026-0010") === "", "onaydan önce hücre boş");
const ilk = await j("/asistan/onayla", "POST", { id: r.kartlar[0].id });
ok(ilk.kayit?.id, "onaylandı, günlüğe düştü");
ok(await hucre("KDR-2026-0010") === "–" && await hucre("KDR-2026-0015") === "10", "Cem gelmedi, Tolga 10 saat yazıldı");
const tekrar = await j("/asistan/onayla", "POST", { id: r.kartlar[0].id });
ok(tekrar.durum === 400, "aynı kart ikinci kez onaylanamaz", tekrar.hata);

console.log("3) Geri al");
let g = await j("/asistan/geri-al", "POST", { id: ilk.kayit.id });
ok(g.kayit?.geriAlindi, "geri alındı");
ok(await hucre("KDR-2026-0010") === "" && await hucre("KDR-2026-0015") === "", "hücreler eski hâline döndü");
g = await j("/asistan/geri-al", "POST", { id: ilk.kayit.id });
ok(g.durum === 400, "ikinci geri alma reddedildi", g.hata);

console.log("4) Avans + vazgeç");
const avans0 = (await j("/tablo/avans")).satirlar.length;
r = await j("/asistan/metin", "POST", { metin: "Mehmet'e 100 euro avans verdim" });
ok(r.kartlar[0]?.baslik === "Avans" && /Mehmet Kaya · 100 EUR/.test(r.kartlar[0].satirlar[0]), "avans kartı", r.kartlar[0]?.satirlar[0]);
await j("/asistan/vazgec", "POST", { id: r.kartlar[0].id });
ok((await j("/tablo/avans")).satirlar.length === avans0, "vazgeçilince yazılmadı");
const v2 = await j("/asistan/onayla", "POST", { id: r.kartlar[0].id });
ok(v2.durum === 400, "vazgeçilen kart onaylanamaz");
r = await j("/asistan/metin", "POST", { metin: "Mehmet'e 100 euro avans verdim" });
const av = await j("/asistan/onayla", "POST", { id: r.kartlar[0].id });
const avanslar = (await j("/tablo/avans")).satirlar;
ok(avanslar.length === avans0 + 1 && avanslar.at(-1).personelKod === "KDR-2026-0004" && Number(avanslar.at(-1).tutar) === 100, "avans yazıldı");
const kasaAvans = (await j(`/kasa/${bugun().slice(0, 7)}`)).satirlar.some((s) => s.kategori === "Avans" && s.personelKod === "KDR-2026-0004" && Number(s.tutar) === 100 && s.tarih === bugun());
ok(kasaAvans, "avans kasaya kendiliğinden düştü");

console.log("5) Bir cümlede iki iş: kasa gideri + avans, hepsi onay");
r = await j("/asistan/metin", "POST", { metin: "60 euro yakıt aldım ve Murat'a 50 avans verdim" });
ok(r.kartlar.length === 2, "iki kart", r.cevap);
ok(/Murat Aydın · 50 EUR/.test(r.kartlar[1]?.satirlar[0] || ""), "para birimi kişiden (EUR)", r.kartlar[1]?.satirlar[0]);
for (const k of r.kartlar) await j("/asistan/onayla", "POST", { id: k.id });
const kasaAy = (await j(`/kasa/${bugun().slice(0, 7)}`)).satirlar;
ok(kasaAy.some((s) => s.kategori === "Yakıt" && Number(s.tutar) === 60 && s.kaynak === "Elle"), "yakıt gideri kasada (Elle)");

console.log("6) Okuma aracı: iki tur");
n0 = assistSayisi();
r = await j("/asistan/metin", "POST", { metin: "Murat bu ay ne alacak?" });
ok(assistSayisi() - n0 === 2, "okuma: n8n'e iki çağrı");
ok(r.kartlar.length === 0 && /Bilgi:/.test(r.cevap) && /Murat Aydın/.test(r.cevap), "cevap araç verisiyle", r.cevap.slice(0, 120));

console.log("7) Kapalı dönem reddedilir, model sebebi söyler");
r = await j("/asistan/metin", "POST", { metin: "Cem eylülün 10'unda 8 saat çalıştı" });
ok(r.kartlar.length === 0 && /kapalı/.test(r.cevap), "kart yok, sebep söylendi", r.cevap);

console.log("8) Olmayan personel kodu");
r = await j("/asistan/metin", "POST", { metin: "uydurma birine avans" });
ok(r.kartlar.length === 0 && /personel yok/.test(r.cevap), "uydurma kod reddedildi", r.cevap);

console.log("9) Belirsiz isim → soru → takip cevabı aynı konuşmada");
r = await j("/asistan/metin", "POST", { metin: "Demir bugün izinli" });
ok(/Hangi Demir/.test(r.cevap) && !r.kartlar.length, "soru soruldu", r.cevap);
const kid = r.konusmaId;
r = await j("/asistan/metin", "POST", { metin: "Ahet olan", konusmaId: kid });
ok(r.kartlar.length === 1 && /Ahet Demir/.test(r.kartlar[0].satirlar[0]) && /izin/.test(r.kartlar[0].satirlar[0]), "takip cevabı anlaşıldı", r.kartlar[0]?.satirlar[0]);
const yeni = await j("/asistan/metin", "POST", { metin: "Ahet olan" });
ok(!yeni.kartlar.length, "yeni konuşmada bağlam yok (beklenen)");

console.log("10) Ödeme: liste → işaretle (3 tur, son tur yazma)");
r = await j("/asistan/metin", "POST", { metin: "Cem'in saatlik ücreti ödendi" });
ok(r.kartlar[0]?.baslik === "Ödendi işareti", "ödeme kartı", JSON.stringify(r.kartlar[0]?.satirlar));
ok(/Hesaplanan tutar/.test(r.kartlar[0]?.not || ""), "farklı tutar notu", r.kartlar[0]?.not);
const od = await j("/asistan/onayla", "POST", { id: r.kartlar[0].id });
const anahtar = JSON.parse(gunlukSatirlari().filter((x) => x.cevap?.tool_calls?.[0]?.name === "odeme_isaretle").at(-1).cevap.tool_calls[0].arguments).anahtar;
let odAy = await j(`/odeme/${bugun().slice(0, 7)}`);
let kalem = odAy.gunler.flatMap((x) => x.gruplar.flatMap((y) => y.kalemler)).find((k) => k.anahtar === anahtar);
ok(kalem?.odendi && kalem.odeme.tutar === 300, "ödendi (300)", anahtar);
await j("/asistan/geri-al", "POST", { id: od.kayit.id });
odAy = await j(`/odeme/${bugun().slice(0, 7)}`);
kalem = odAy.gunler.flatMap((x) => x.gruplar.flatMap((y) => y.kalemler)).find((k) => k.anahtar === anahtar);
ok(kalem && !kalem.odendi, "geri alınca ödenmemiş");

console.log("11) Personel ekip değişikliği + geri al");
r = await j("/asistan/metin", "POST", { metin: "Tolga'yı Novi Sad Elektrik ekibine al" });
ok(/Sirbistan1 → EKP-02 Novi Sad Elektrik/.test(r.kartlar[0]?.satirlar.join(" ") || "") && /yeni açılan dönemlerden/.test(r.kartlar[0]?.not || ""), "ekip kartı + dönem notu", r.kartlar[0]?.satirlar.join(" | "));
const pk = await j("/asistan/onayla", "POST", { id: r.kartlar[0].id });
let tolga = (await j("/tablo/personel")).satirlar.find((p) => p.kod === "KDR-2026-0015");
ok(tolga.ekip === "EKP-02", "ekip değişti");
const acikDonemEkip = (await j(`/puantaj/${donem}`)).kayit.satirlar.find((s) => s.personelKod === "KDR-2026-0015").ekip;
ok(acikDonemEkip === "EKP-01", "açık dönemdeki anlık görüntü değişmedi", acikDonemEkip);
await j("/asistan/geri-al", "POST", { id: pk.kayit.id });
tolga = (await j("/tablo/personel")).satirlar.find((p) => p.kod === "KDR-2026-0015");
ok(tolga.ekip === "EKP-01", "geri alındı");

console.log("12) Geri alma çakışması: hücre sonradan elle değişirse");
r = await j("/asistan/metin", "POST", { metin: "Cem bugün gelmedi, Tolga 10 saat çalıştı" });
const c2 = await j("/asistan/onayla", "POST", { id: r.kartlar[0].id });
await j(`/puantaj/${donem}/hucre`, "PUT", { personelKod: "KDR-2026-0010", gun: bugun(), deger: "8" });
g = await j("/asistan/geri-al", "POST", { id: c2.kayit.id });
ok(g.durum === 400 && /sonradan değişmiş/.test(g.hata), "çakışmada geri alma durdu", g.hata);
ok(await hucre("KDR-2026-0015") === "10", "hiçbir hücreye dokunulmadı");

console.log("13) Ses: yazıya dökme ve isim ipucu");
const fd = new FormData();
fd.append("ses", new Blob(["Mehmet'e 100 euro avans verdim"], { type: "audio/webm;codecs=opus" }), "komut.webm");
r = await j("/asistan/ses", "POST", fd);
ok(r.metin === "Mehmet'e 100 euro avans verdim" && r.kartlar.length === 1, "ses → metin → kart", r.metin);
const t = gunlukSatirlari().filter((x) => x.yol === "/webhook/kadro/transcribe").at(-1);
ok(t.dil === "tr" && t.dosya === "ses.webm" && t.tur === "audio/webm", "dil tr, dosya adı/türü doğru", `${t.dil} ${t.dosya} ${t.tur}`);
ok(/Ahet Demir/.test(t.ipucu) && /Burak Öztürk/.test(t.ipucu) === false, "ipucunda aktif isimler var, ayrılan yok", t.ipucu.slice(0, 80));
const bos = new FormData();
bos.append("ses", new Blob([""], { type: "audio/webm" }), "komut.webm");
r = await j("/asistan/ses", "POST", bos);
ok(!r.kartlar.length && /duyulmadı/.test(r.cevap), "sessiz kayıt", r.cevap);
ok(fs.readdirSync(DBYOL.replace(/db\.json$/, "gecici")).length === 0, "geçici ses dosyaları silindi");

console.log("14) Hata kodları");
r = await j("/asistan/metin", "POST", { metin: "boş yanıt ver" });
ok(r.durum === 400 && /boş yanıt/.test(r.hata), "model_empty Türkçe", r.hata);

console.log("15) Gizlilik: modele giden hiçbir istekte IBAN/telefon/not yok");
const db = JSON.parse(fs.readFileSync(DBYOL, "utf8"));
const gizli = db.personel.flatMap((p) => [p.iban, p.telefon, p.notlar]).filter((x) => x && String(x).length > 4);
const hepsi = gunlukSatirlari().map((x) => x.ham || "").join("\n");
const sizan = gizli.filter((x) => hepsi.includes(String(x)));
ok(gizli.length > 0 && sizan.length === 0, `${gizli.length} gizli değerden hiçbiri gitmedi`, sizan.join(", "));
ok(!hepsi.includes("ucret\"") && !/"maasGecmisi"/.test(hepsi), "ham personel kaydı gitmedi");

console.log("16) Günlük ve yedek");
const dur = await j("/asistan");
ok(dur.gunluk.length >= 6 && dur.gunluk[0].cumle, "günlük son işlem başta", `${dur.gunluk.length} kayıt`);
await j("/ayarlar", "POST", { asistanAnahtari: "gizli-anahtar-123", asistanAdres: "https://n8n.ornek.com" });
const yedek = await (await fetch(`${API}/yedek`)).text();
ok(!yedek.includes("gizli-anahtar-123") && yedek.includes("n8n.ornek.com"), "anahtar yedeğe girmedi, adres girdi");
const kotu = await j("/ayarlar", "POST", { asistanAdres: "http://acik.com" });
ok(kotu.durum === 400, "https olmayan adres reddedildi", kotu.hata);

console.log(hata ? `\n${hata} HATA` : "\nHEPSİ GEÇTİ");
process.exit(hata ? 1 : 0);
