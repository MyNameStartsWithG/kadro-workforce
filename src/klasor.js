/**
 * Diskteki gerçek klasör işlemleri: yapıyı kurma, ağacı tarama, dosya yerleştirme.
 * Belge kökünün dışına hiçbir şekilde yazılmaz — her yol kök altında doğrulanır.
 */
import fs from "node:fs";
import path from "node:path";
import { duzYapi, SABLONLAR, DINAMIK_AD, dinamikKok } from "./yapi.js";
import * as db from "./db.js";

const YASAK = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Windows dosya sisteminde geçerli bir ada çevirir. */
export function guvenliAd(s) {
  const t = String(s || "").replace(YASAK, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return t.slice(0, 120) || "Adsiz";
}

/** Bir göreli yolun belge kökünün içinde kaldığını doğrular. */
export function tamYol(kok, goreli) {
  const ham = String(goreli || "").split(/[/\\]/).filter(Boolean);
  // ".." ve "." parçaları sessizce temizlenmez — açıkça reddedilir.
  if (ham.some((p) => p === "." || p === "..")) {
    throw new Error(`Geçersiz klasör yolu: "${goreli}"`);
  }
  const parcalar = ham.map(guvenliAd);
  const tam = path.resolve(kok, ...parcalar);
  const kokMutlak = path.resolve(kok);
  if (tam !== kokMutlak && !tam.startsWith(kokMutlak + path.sep)) {
    throw new Error(`Kök dışına çıkan yol reddedildi: ${goreli}`);
  }
  return tam;
}

function klasorAc(kok, goreli, rapor) {
  const t = tamYol(kok, goreli);
  if (!fs.existsSync(t)) {
    fs.mkdirSync(t, { recursive: true });
    rapor.acilan.push(goreli);
  } else {
    rapor.mevcut += 1;
  }
  return t;
}

/** Bir dinamik kayıt (personel/proje/araç/müşteri) için klasör yolunu üretir. */
export function dinamikYol(tur, satir) {
  const kok = dinamikKok(tur);
  if (!kok) return null;
  const ad = guvenliAd(DINAMIK_AD[tur](satir));
  if (!ad || ad === "Adsiz") return null;
  return `${kok}/${ad}`;
}

/** Tek bir dinamik kaydın klasörünü ve şablon alt klasörlerini açar. */
export function dinamikKlasorKur(kok, tur, satir) {
  const rapor = { acilan: [], mevcut: 0 };
  const taban = dinamikYol(tur, satir);
  if (!taban) return rapor;
  klasorAc(kok, taban, rapor);
  for (const alt of SABLONLAR[tur] || []) {
    klasorAc(kok, `${taban}/${alt.c} ${alt.n}`, rapor);
  }
  return rapor;
}

/** Statik ağacın tamamını + tablolardaki tüm dinamik kayıtları diske kurar. */
export function yapiyiKur(kok) {
  const rapor = { acilan: [], mevcut: 0, kok };
  fs.mkdirSync(kok, { recursive: true });

  for (const d of duzYapi()) klasorAc(kok, d.yol, rapor);

  const eslesme = { personel: "personel", proje: "proje", arac: "arac", musteri: "musteri", ev: "ev" };
  for (const [tur, tabloAdi] of Object.entries(eslesme)) {
    for (const satir of db.tablo(tabloAdi)) {
      const r = dinamikKlasorKur(kok, tur, satir);
      rapor.acilan.push(...r.acilan);
      rapor.mevcut += r.mevcut;
    }
  }

  // "Şablonlar" klasöründeki boş form dosyaları yoksa yer tutucu bırakılır.
  for (const d of duzYapi()) {
    if (!d.dosyalar.length) continue;
    const dizin = tamYol(kok, d.yol);
    const okuma = path.join(dizin, "_BURAYA-BOS-FORMLARI-KOYUN.txt");
    // Alt klasörler sayılmaz; yalnızca hiç DOSYA yoksa yer tutucu bırakılır.
    const dosyaVar = fs.readdirSync(dizin, { withFileTypes: true }).some((e) => e.isFile());
    if (!fs.existsSync(okuma) && !dosyaVar) {
      fs.writeFileSync(okuma,
        `Bu klasöre şu boş formlar konulmalıdır:\r\n\r\n${d.dosyalar.map((f) => "  - " + f).join("\r\n")}\r\n\r\n` +
        `Formlar yerleştirildikten sonra bu dosyayı silebilirsiniz.\r\n`, "utf8");
      rapor.acilan.push(`${d.yol}/_BURAYA-BOS-FORMLARI-KOYUN.txt`);
    }
  }
  return rapor;
}

/** Diski gezip gerçek klasör ağacını çıkarır (dosya sayıları dâhil). */
export function agacTara(kok, maxDerinlik = 5) {
  const tanimlar = new Map(duzYapi().map((d) => [d.yol, d]));

  const gez = (goreli, derinlik) => {
    const tam = tamYol(kok, goreli);
    let girisler = [];
    try { girisler = fs.readdirSync(tam, { withFileTypes: true }); } catch { return null; }

    const klasorler = girisler.filter((e) => e.isDirectory());
    const dosyalar = girisler.filter((e) => e.isFile());
    const tanim = tanimlar.get(goreli) || {};

    const dugum = {
      yol: goreli,
      ad: path.basename(tam),
      d: tanim.d || "",
      not: tanim.not || "",
      dinamik: tanim.dinamik || null,
      tanimli: tanimlar.has(goreli),
      dosyaSayisi: dosyalar.length,
      dosyalar: dosyalar.slice(0, 200).map((f) => {
        const st = fs.statSync(path.join(tam, f.name));
        return { ad: f.name, boyut: st.size, tarih: st.mtime.toISOString() };
      }),
      ch: [],
    };
    if (derinlik < maxDerinlik) {
      for (const k of klasorler) {
        const alt = gez(goreli ? `${goreli}/${k.name}` : k.name, derinlik + 1);
        if (alt) dugum.ch.push(alt);
      }
    } else if (klasorler.length) {
      dugum.dahaVar = klasorler.length;
    }
    dugum.toplamDosya = dugum.dosyaSayisi + dugum.ch.reduce((a, c) => a + (c.toplamDosya || 0), 0);
    return dugum;
  };

  if (!fs.existsSync(kok)) return { kurulmamis: true, ch: [] };
  const kokDugum = gez("", 0);
  return { kurulmamis: false, kok, ch: kokDugum ? kokDugum.ch : [], toplamDosya: kokDugum?.toplamDosya || 0 };
}

/** Çakışma olursa " (2)", " (3)" ekleyerek boş bir ad bulur. */
function bosAdBul(dizin, ad) {
  const uzanti = path.extname(ad);
  const govde = path.basename(ad, uzanti);
  let aday = ad, i = 2;
  while (fs.existsSync(path.join(dizin, aday))) {
    aday = `${govde} (${i})${uzanti}`;
    i += 1;
    if (i > 999) throw new Error("Aynı adda çok fazla dosya var.");
  }
  return aday;
}

/** Geçici yükleme dosyasını hedef klasöre taşır. Döner: { yol, ad, boyut } */
export function dosyaYerlestir(kok, geciciYol, hedefKlasor, yeniAd) {
  const dizin = tamYol(kok, hedefKlasor);
  fs.mkdirSync(dizin, { recursive: true });
  const ad = bosAdBul(dizin, guvenliAd(yeniAd));
  const hedef = path.join(dizin, ad);
  try {
    fs.renameSync(geciciYol, hedef);
  } catch {
    fs.copyFileSync(geciciYol, hedef);
    fs.unlinkSync(geciciYol);
  }
  const st = fs.statSync(hedef);
  return { yol: `${hedefKlasor}/${ad}`, ad, boyut: st.size, tamYol: hedef };
}

/** Bir kaydın adı değişince klasörünü yeniden adlandırır. */
export function klasorYenidenAdlandir(kok, tur, eskiSatir, yeniSatir) {
  const eski = dinamikYol(tur, eskiSatir);
  const yeni = dinamikYol(tur, yeniSatir);
  if (!eski || !yeni || eski === yeni) return null;
  const eskiTam = tamYol(kok, eski);
  const yeniTam = tamYol(kok, yeni);
  if (fs.existsSync(eskiTam) && !fs.existsSync(yeniTam)) {
    fs.renameSync(eskiTam, yeniTam);
    return { eski, yeni };
  }
  return null;
}

/** Belge yerleştirilebilecek tüm klasörler — yapay zekâya sunulan liste. */
export function hedefKlasorler(kok) {
  const out = [];
  for (const d of duzYapi()) {
    if (d.dinamik) continue;
    if (d.hedef) out.push({ yol: d.yol, d: d.d, anahtar: d.anahtar });
  }
  const turler = [
    ["personel", "personel", (r) => `${r.kod} — ${r.ad}`],
    ["proje", "proje", (r) => r.ad],
    ["arac", "arac", (r) => `${r.plaka} ${r.marka || ""}`.trim()],
    ["musteri", "musteri", (r) => r.ad],
    ["ev", "ev", (r) => `${r.kod} ${r.ad}`],
  ];
  for (const [tur, tabloAdi, etiket] of turler) {
    for (const satir of db.tablo(tabloAdi)) {
      const taban = dinamikYol(tur, satir);
      if (!taban) continue;
      for (const alt of SABLONLAR[tur]) {
        out.push({
          yol: `${taban}/${alt.c} ${alt.n}`,
          d: `${etiket(satir)} — ${alt.d}`,
          anahtar: alt.anahtar,
          sahip: { tur, id: satir._id, etiket: etiket(satir) },
        });
      }
    }
  }
  return out;
}

export function klasorAcExplorer(kok, goreli) {
  return tamYol(kok, goreli);
}

/* ------------------------------------------------------------------ */
/* Belge silme: dosya kalıcı silinmez, "_Silinenler" klasörüne taşınır. */
/* Asıl yeri klasör yapısında saklanır: _Silinenler/<asıl klasör>/<ad>  */
/* ------------------------------------------------------------------ */

export const SILINENLER = "_Silinenler";

const silinenlerdeMi = (goreli) => String(goreli || "").split(/[/\\]/).filter(Boolean)[0] === SILINENLER;

/** Bir klasördeki tek dosyanın tam yolu; dosya adı alt klasöre kaçamaz. */
function dosyaTamYolu(kok, klasorYolu, ad) {
  if (!ad || /[/\\]/.test(ad) || ad === "." || ad === "..") throw new Error("Geçersiz dosya adı.");
  const tam = path.join(tamYol(kok, klasorYolu), ad);
  if (!fs.existsSync(tam) || !fs.statSync(tam).isFile()) throw new Error(`Dosya bulunamadı: ${ad}`);
  return tam;
}

function tasi(kaynak, hedefDizin, ad) {
  fs.mkdirSync(hedefDizin, { recursive: true });
  const yeniAd = bosAdBul(hedefDizin, ad);
  const hedef = path.join(hedefDizin, yeniAd);
  try {
    fs.renameSync(kaynak, hedef);
  } catch (e) {
    if (["EBUSY", "EPERM"].includes(e.code)) throw new Error(`"${ad}" şu an başka bir programda açık. Dosyayı kapatıp tekrar deneyin.`);
    fs.copyFileSync(kaynak, hedef);
    fs.unlinkSync(kaynak);
  }
  return yeniAd;
}

/** Dosyayı _Silinenler altına taşır. Döner: { yol } (silinenlerdeki göreli yol). */
export function dosyaSil(kok, klasorYolu, ad) {
  if (silinenlerdeMi(klasorYolu)) throw new Error("Bu dosya zaten Silinenler'de. Kalıcı silmek için \"Kalıcı sil\" düğmesini kullanın.");
  const kaynak = dosyaTamYolu(kok, klasorYolu, ad);
  const hedefKlasor = [SILINENLER, ...String(klasorYolu).split(/[/\\]/).filter(Boolean)].join("/");
  const yeniAd = tasi(kaynak, tamYol(kok, hedefKlasor), ad);
  return { yol: `${hedefKlasor}/${yeniAd}`, klasor: hedefKlasor, ad: yeniAd };
}

/** Silinenler'deki dosyayı asıl klasörüne geri koyar. Döner: { yol, klasor, ad }. */
export function dosyaGeriYukle(kok, klasorYolu, ad) {
  if (!silinenlerdeMi(klasorYolu)) throw new Error("Sadece Silinenler klasöründeki dosyalar geri yüklenebilir.");
  const kaynak = dosyaTamYolu(kok, klasorYolu, ad);
  const asil = String(klasorYolu).split(/[/\\]/).filter(Boolean).slice(1).join("/");
  const yeniAd = tasi(kaynak, tamYol(kok, asil), ad);
  return { yol: asil ? `${asil}/${yeniAd}` : yeniAd, klasor: asil, ad: yeniAd };
}

/** Silinenler'deki dosyayı diskten tamamen siler. */
export function kaliciSil(kok, klasorYolu, ad) {
  if (!silinenlerdeMi(klasorYolu)) throw new Error("Kalıcı silme sadece Silinenler klasöründe yapılır. Önce dosyayı silin.");
  const tam = dosyaTamYolu(kok, klasorYolu, ad);
  try { fs.unlinkSync(tam); }
  catch (e) {
    if (["EBUSY", "EPERM"].includes(e.code)) throw new Error(`"${ad}" şu an başka bir programda açık. Dosyayı kapatıp tekrar deneyin.`);
    throw e;
  }
  // Boşalan klasörler (Silinenler'in içinde) toplanır.
  let dizin = path.dirname(tam);
  const sinir = tamYol(kok, SILINENLER);
  while (dizin.startsWith(sinir + path.sep) && !fs.readdirSync(dizin).length) { fs.rmdirSync(dizin); dizin = path.dirname(dizin); }
}

/**
 * Belge kökünü "<kök> (eski 2026-10-14)" adıyla kenara alır (sıfırlamada). Silmez; kullanıcı isterse elle siler.
 * Döner: yeni adı.
 */
export function kokuKenaraAl(kok) {
  if (!fs.existsSync(kok)) return null;
  const tarih = new Date().toISOString().slice(0, 10);
  const ust = path.dirname(kok), ad = path.basename(kok);
  let hedef = path.join(ust, `${ad} (eski ${tarih})`), i = 2;
  while (fs.existsSync(hedef)) hedef = path.join(ust, `${ad} (eski ${tarih} ${i++})`);
  try { fs.renameSync(kok, hedef); }
  catch (e) {
    if (["EBUSY", "EPERM", "EACCES"].includes(e.code)) {
      throw new Error("Belge klasörü kenara alınamadı: içindeki bir dosya ya da klasör açık (Excel, Gezgin penceresi…). " +
        "Açık pencereleri kapatıp tekrar deneyin. Hiçbir kayıt silinmedi.");
    }
    throw e;
  }
  return hedef;
}
