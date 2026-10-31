// Çalışma dönemi olan kişinin durumu sesli komutla değiştirilemez; olmayanınki değiştirilebilir.
const API = "http://127.0.0.1:4417/api";
const j = async (yol, govde, yontem = "POST") => {
  const r = await fetch(API + yol, { method: yontem, headers: { "Content-Type": "application/json" }, body: govde && JSON.stringify(govde) });
  return { durum: r.status, ...(await r.json()) };
};
let hata = 0;
const ok = (k, ad, ek = "") => { console.log(`${k ? "  ✓" : "  ✗"} ${ad}${ek ? ` — ${ek}` : ""}`); if (!k) hata++; };
const kisi = (await j("/tablo/personel", null, "GET")).satirlar?.find((p) => p.ad === "Tolga Er")
  ?? (await (await fetch(API + "/tablo/personel")).json()).find?.((p) => p.ad === "Tolga Er");
console.log("kişi:", kisi?.kod, kisi?.durum);
const once = await j("/asistan/metin", { metin: "Tolga izinli" });
ok(once.kartlar?.length === 1 && once.kartlar[0].satirlar.join(" ").includes("İzinli"), "kontratsız: durum kartı açılır", once.kartlar?.[0]?.satirlar.join(" | "));
if (once.kartlar?.[0]) await j("/asistan/vazgec", { id: once.kartlar[0].id });
const k = await j("/tablo/kontrat", { personelKod: kisi.kod, tur: "Çalışma", baslangic: "2026-09-01", bitis: "" });
ok(k.durum === 200, "kontrat eklendi", k.hata || "");
const sonra = await j("/asistan/metin", { metin: "Tolga izinli" });
ok(!sonra.kartlar?.length, "kontratlı: kart açılmaz", sonra.cevap);
console.log(hata ? `\n${hata} HATA` : "\nHEPSİ GEÇTİ");
