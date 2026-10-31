// Gerçek DeepSeek ile Türkçe komutlar: hiçbir kart onaylanmaz (sadece ne önerdiğine bakılır).
const API = "http://127.0.0.1:4417/api";
const j = async (yol, govde) => {
  const r = await fetch(API + yol, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(govde) });
  return { durum: r.status, ...(await r.json()) };
};
const komutlar = [
  ["Cem bugün gelmedi, Tolga 10 saat çalıştı"],
  ["Mehmet'e 100 euro avans verdim"],
  ["dün 1. ekipten herkes 8 saat çalıştı"],
  ["60 euro yakıt aldım, Murat'a da 50 avans verdim"],
  ["Murat bu ay ne kadar alacak?"],
  ["Demir bugün izinli", "Ahet olan"],
  ["Cem eylülün 10'unda 8 saat çalıştı"],
  ["Tolga'yı Novi Sad Elektrik ekibine al"],
  ["Cem'in eylül ikinci yarı saatlik ücreti ödendi, 300 euro verdim"],
  ["Hasan'ın maaşını 2000 euro yap"],
  ["Bugün kimler gelmedi?"],
  ["Emre'ye beş bin dinar avans"],
];
for (const zincir of komutlar) {
  let kid = null;
  for (const metin of zincir) {
    const t0 = Date.now();
    const r = await j("/asistan/metin", { metin, konusmaId: kid });
    kid = r.konusmaId;
    console.log(`\n> ${metin}   (${((Date.now() - t0) / 1000).toFixed(1)} sn)`);
    if (r.hata) { console.log(`  HATA: ${r.hata}`); continue; }
    console.log(`  cevap: ${r.cevap}`);
    for (const k of r.kartlar) console.log(`  [${k.baslik}] ${k.satirlar.join(" | ")}${k.not ? `  (not: ${k.not})` : ""}`);
  }
}
