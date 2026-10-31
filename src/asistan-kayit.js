/**
 * Sesli komut kaydı: ne söylendi, model ne yaptı, sonuç ne oldu, ne kadar sürdü, kaç token harcandı.
 * Amaç komutları sonradan inceleyip asistanı iyileştirmek (müşteri onayıyla, 25 Ekim 2026).
 *
 * Her kayıt önce bu bilgisayara yazılır: veri/asistan-kayit/<yıl-ay>.jsonl (kalıcı arşiv) ve bekleyen.jsonl
 * (sunucuya gidecekler). Bekleyenler n8n'deki kadro/log ucuna toplu gönderilir; uç onları "kadro_kayit"
 * veri tablosuna yazar. İnternet yoksa ya da sunucu reddederse kayıt kaybolmaz, sonraki denemede gider.
 *
 * Gönderim en fazla 15 dakikada bir: n8n kapısı (Guard) akış başına günde 100 istek sayar.
 * Ses dosyası kaydedilmez; IBAN, telefon, pasaport ve notlar zaten asistana hiç gitmez.
 */
import fs from "node:fs";
import path from "node:path";

const ARALIK = 15 * 60_000;       // iki gönderim arası en az
const PAKET = 50;                 // bir istekte en fazla kayıt
const SONUC_SINIRI = 2000;        // araç sonucu kaydı bu kadar karakterde kesilir

let dizin = null;
let gonderici = null;             // (kayitlar) => Promise; asistan.js bağlar
let sonDeneme = 0;
let gonderiliyor = false;
let zamanlayici = null;

const bekleyenYolu = () => path.join(dizin, "bekleyen.jsonl");
const ayYolu = (zaman) => path.join(dizin, `${String(zaman).slice(0, 7)}.jsonl`);

/** server.js açılışta çağırır. Sunucuya gitmeyi bekleyen kayıt varsa kısa süre sonra gönderilir. */
export function baslat(veriDizini, gonderen) {
  dizin = path.join(veriDizini, "asistan-kayit");
  fs.mkdirSync(dizin, { recursive: true });
  gonderici = gonderen;
  zamanlayici ??= setInterval(() => { gonder(); }, ARALIK).unref();
  setTimeout(() => { gonder(); }, 30_000).unref();
}

export const kes = (s, n = SONUC_SINIRI) => {
  const m = String(s ?? "");
  return m.length > n ? `${m.slice(0, n)}… (+${m.length - n} karakter)` : m;
};

/** Kaydı yerel arşive ve gönderim kuyruğuna ekler. Kayıt hatası komutu asla bozmaz. */
export function yaz(kayit) {
  if (!dizin) return;
  try {
    const satir = `${JSON.stringify(kayit)}\n`;
    fs.appendFileSync(ayYolu(kayit.zaman), satir, "utf8");
    fs.appendFileSync(bekleyenYolu(), satir, "utf8");
  } catch (e) {
    console.error(`[asistan kaydı] yazılamadı: ${e.message}`);
  }
  gonder();
}

/** Bekleyenleri sunucuya gönderir. `zorla` aralığı yok sayar (test ve kapanış için). */
export async function gonder(zorla = false) {
  if (!dizin || !gonderici || gonderiliyor) return { gonderilen: 0 };
  if (!zorla && Date.now() - sonDeneme < ARALIK) return { gonderilen: 0 };
  let satirlar;
  try { satirlar = fs.readFileSync(bekleyenYolu(), "utf8").split("\n").filter(Boolean); }
  catch { return { gonderilen: 0 }; }
  if (!satirlar.length) return { gonderilen: 0 };

  gonderiliyor = true;
  sonDeneme = Date.now();
  let gonderilen = 0;
  try {
    while (gonderilen < satirlar.length) {
      const parca = satirlar.slice(gonderilen, gonderilen + PAKET);
      const kayitlar = parca.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      if (kayitlar.length) await gonderici(kayitlar);
      gonderilen += parca.length;
    }
  } catch (e) {
    console.error(`[asistan kaydı] sunucuya gönderilemedi, sonra denenecek: ${e.message}`);
  } finally {
    // Gönderilenler kuyruktan çıkar; bu arada eklenenler kalır.
    if (gonderilen) {
      try {
        const simdi = fs.readFileSync(bekleyenYolu(), "utf8").split("\n").filter(Boolean);
        fs.writeFileSync(bekleyenYolu(), simdi.slice(gonderilen).map((s) => `${s}\n`).join(""), "utf8");
      } catch (e) { console.error(`[asistan kaydı] kuyruk güncellenemedi: ${e.message}`); }
    }
    gonderiliyor = false;
  }
  return { gonderilen };
}

/** Ayarlar ve test için: kuyrukta kaç kayıt var, son deneme ne zaman. */
export function durum() {
  let bekleyen = 0;
  try { bekleyen = fs.readFileSync(bekleyenYolu(), "utf8").split("\n").filter(Boolean).length; } catch {}
  return { bekleyen, sonDeneme: sonDeneme ? new Date(sonDeneme).toISOString() : null };
}
