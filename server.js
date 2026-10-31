/**
 * ACME MÜHENDİSLİK — Belge Yönetim Sistemi
 * Lokal sunucu. Çift tıkla baslat.bat ile açılır, tarayıcıda çalışır.
 */
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { exec, execSync } from "node:child_process";
import sea from "node:sea";

import * as db from "./src/db.js";
import * as klasor from "./src/klasor.js";
import * as excel from "./src/excel.js";
import { siniflandir, kuralIle, onerilenAd } from "./src/siniflandirici.js";
import { TABLOLAR, sonrakiKod, KODLU } from "./src/tablolar.js";
import * as iliski from "./src/iliskiler.js";
import * as puantaj from "./src/puantaj.js";
import * as kasa from "./src/kasa.js";
import * as ongoru from "./src/ongoru.js";
import * as odeme from "./src/odeme.js";
import * as kurlar from "./src/kur.js";
import * as calisan from "./src/calisan.js";
import * as asistan from "./src/asistan.js";
import * as kontrat from "./src/kontrat.js";
import * as notlar from "./src/notlar.js";
import { duzYapi, SABLONLAR } from "./src/yapi.js";

// KADRO.exe olarak paketlendiğinde (bkz. paketle.mjs) arayüz exe'nin içinden okunur,
// veriler exe nerede olursa olsun Belgeler\KADRO altında tutulur.
const PAKETLI = sea.isSea();

function belgelerKlasoru() {
  try {
    const yol = execSync(`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`,
      { encoding: "utf8", windowsHide: true }).trim();
    if (yol && fs.existsSync(yol)) return yol;
  } catch {}
  return path.join(os.homedir(), "Documents");
}

// KADRO_KLASOR: test için veriyi başka bir klasörde tutar (gerçek Belgeler\KADRO verisine dokunmadan).
const BURASI = process.env.KADRO_KLASOR
  ? path.resolve(process.env.KADRO_KLASOR)
  : PAKETLI
    ? path.join(belgelerKlasoru(), "KADRO")
    : path.dirname(fileURLToPath(import.meta.url));
const VERI_DIZINI = path.join(BURASI, "veri");
const GECICI_DIZIN = path.join(VERI_DIZINI, "gecici");
const PORT = Number(process.env.PORT) || 4360;
const SURUM = "2.5.2";

fs.mkdirSync(GECICI_DIZIN, { recursive: true });
db.baslat(VERI_DIZINI);

// Güncelleme: yeni sürüm ilk açıldığında, veriyi kendi biçimine çevirmeden önce yedek alınır (veri/yedekler).
// Müşteri sadece exe'yi değiştirir; kayıtlar Belgeler\KADRO'da kalır, bir sorun olursa bu yedekten dönülür.
const oncekiSurum = db.ayarlar().surum || null;
if (oncekiSurum !== SURUM && db.tablo("personel").length) {
  try { console.log(`  Güncelleme yedeği: ${db.yedekAl(`guncellemeden-once-${oncekiSurum || "eski"}`)}`); }
  catch (e) { console.error(`[güncelleme yedeği] alınamadı: ${e.message}`); }
}

/** Açılışta ve yedekten yüklemede çalışır: eski sürüm verisini günceller, kasayı kaynaklarıyla eşitler. */
function veriyiHazirla() {
  // v1 → v2: eski zimmet kayıtları kişisel zimmet olarak kalır.
  let degisti = false;
  for (const z of db.tablo("zimmet")) {
    if (!z.sahipTuru) { z.sahipTuru = "Kişi"; z.ekipKod = z.ekipKod || ""; degisti = true; }
  }
  if (degisti) db.yaz();
  // v2.5: personelin tek satırlık notu, Notlar paneline "Genel not" olarak taşınır.
  try { notlar.eskiNotlariTasi(); } catch (e) { console.error(`[notlar] taşınamadı: ${e.message}`); }
  // Çalışma dönemi olan kişilerin durumu ve açık puantajlardaki aralık kopyaları.
  try { kontrat.esitle(); } catch (e) { console.error(`[kontrat] eşitlenemedi: ${e.message}`); }
  // Kasanın otomatik satırlarını (avans, maaş, yemek, kira) kaynaklarıyla eşitle.
  try { return kasa.esitle(); } catch (e) { console.error(`[kasa] eşitlenemedi: ${e.message}`); return null; }
}
veriyiHazirla();
if (oncekiSurum !== SURUM) db.ayarKaydet({ surum: SURUM });

// Belge kökü ilk açılışta uygulama klasörünün yanına kurulur.
if (!db.ayarlar().belgeKoku) {
  db.ayarKaydet({ belgeKoku: path.join(BURASI, "ACME MUHENDISLIK") });
}
const kok = () => db.ayarlar().belgeKoku;

const app = express();
app.use(express.json({ limit: "5mb" }));
// Veriyi değiştiren her istekten sonra aylık kasa dosyaları tazelenir (sadece değişen aylar yazılır).
app.use((req, res, next) => {
  if (req.method !== "GET" && req.path.startsWith("/api/")) res.on("finish", kasaDosyalariniZamanla);
  next();
});
if (PAKETLI) {
  app.use((req, res, next) => {
    const ad = req.path === "/" ? "index.html" : req.path.slice(1);
    if (!["index.html", "app.js", "style.css"].includes(ad)) return next();
    res.type(path.extname(ad)).send(Buffer.from(sea.getAsset(ad)));
  });
} else {
  app.use(express.static(path.join(BURASI, "public")));
}

const yukleyici = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, GECICI_DIZIN),
    filename: (_r, _f, cb) => cb(null, `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 30 },
});

/** Yüklenip henüz yerleştirilmemiş dosyalar. */
const bekleyen = new Map();

// Not: fn senkron da throw edebilir; async sarmalayıcı ikisini de yakalar.
// (Promise.resolve(fn(...)) senkron hatayı kaçırır ve Express HTML 500 döndürür.)
const sar = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(`[hata] ${req.method} ${req.path} — ${e.message}`);
    if (!res.headersSent) res.status(400).json({ hata: e.message });
  }
};

/* ------------------------------------------------------------------ */
/* Durum ve ayarlar                                                    */
/* ------------------------------------------------------------------ */

app.get("/api/durum", sar((_req, res) => {
  const a = db.ayarlar();
  const kurulu = fs.existsSync(kok());
  res.json({
    belgeKoku: kok(),
    kurulu,
    aiModu: a.aiModu,
    esik: a.esik,
    kullanici: a.kullanici,
    kur: kurlar.kurAyari(),
    apiAnahtariVar: Boolean(a.apiAnahtari || process.env.ANTHROPIC_API_KEY),
    apiKaynagi: a.apiAnahtari ? "ayarlar" : (process.env.ANTHROPIC_API_KEY ? "ortam degiskeni" : null),
    asistan: { hazir: asistan.ayar().hazir, adres: a.asistanAdres || "", varsayilanAdres: asistan.VARSAYILAN_ADRES, anahtarVar: Boolean(a.asistanAnahtari), gomulu: asistan.gomuluAnahtarVar },
    sayilar: {
      personel: db.tablo("personel").length,
      zimmet: db.tablo("zimmet").filter((z) => z.durum === "Zimmetli").length,
      ekip: db.tablo("ekip").filter((e) => e.durum !== "Pasif").length,
      arac: db.tablo("arac").length,
      proje: db.tablo("proje").filter((p) => p.durum === "Devam Ediyor").length,
      ev: db.tablo("ev").filter((e) => e.durum !== "Boşaltıldı").length,
      avans: db.tablo("avans").length,
      kontrat: db.tablo("kontrat").filter((r) => ["Sürüyor", "İzinde", "Başlamadı"].includes(kontrat.kayitDurumu(r))).length,
      kasa: db.tablo("kasa").length,
      odemeBekleyen: bekleyenOdeme(),
      musteri: db.tablo("musteri").length,
      belge: db.tablo("belge").length,
    },
    surum: SURUM,
    port: PORT,
  });
}));

app.post("/api/ayarlar", sar((req, res) => {
  const izinli = ["belgeKoku", "apiAnahtari", "aiModu", "kullanici", "esik", "asistanAdres", "asistanAnahtari"];
  const yeni = {};
  for (const k of izinli) if (k in req.body) yeni[k] = req.body[k];
  if (yeni.belgeKoku) yeni.belgeKoku = path.resolve(String(yeni.belgeKoku));
  if ("asistanAdres" in yeni) {
    const adres = String(yeni.asistanAdres || "").trim().replace(/\/+$/, "");
    if (adres && !/^https:\/\/[^\s/]+/.test(adres)) throw new Error("Asistan adresi https:// ile başlamalı (ör. https://n8n.ornek.com).");
    yeni.asistanAdres = adres;
  }
  if ("asistanAnahtari" in yeni) yeni.asistanAnahtari = String(yeni.asistanAnahtari || "").trim();
  if (yeni.esik !== undefined) yeni.esik = Math.max(0, Math.min(1, Number(yeni.esik) || 0.72));
  // Kur: 1 ana para birimi = x diğer. Açılmış puantaj dönemleri kendi kurunu korur.
  if ("kur" in req.body) yeni.kur = kurlar.dogrula(req.body.kur);
  res.json(db.ayarKaydet(yeni));
}));

app.post("/api/kur", sar((_req, res) => res.json(klasor.yapiyiKur(kok()))));

/* Yedek: tüm kayıtlar tek .json dosyası. Belgeler (klasörler) yedeğe girmez. */

app.get("/api/yedek", sar((_req, res) => {
  const tarih = new Date().toISOString().slice(0, 10);
  const icerik = JSON.stringify({ uygulama: "KADRO DMS", surum: SURUM, tarih: new Date().toISOString(), veri: db.disaAktar() }, null, 2);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`KADRO yedek ${tarih}.json`)}`);
  res.end(icerik);
}));

app.post("/api/yedek", yukleyici.single("dosya"), sar((req, res) => {
  if (!req.file) throw new Error("Dosya gelmedi.");
  let gelen;
  try { gelen = JSON.parse(fs.readFileSync(req.file.path, "utf8").replace(/^﻿/, "")); }
  catch { throw new Error("Dosya okunamadı. Sistemden indirilen bir KADRO yedeği (.json) seçin."); }
  finally { try { fs.unlinkSync(req.file.path); } catch {} }
  // Hem sistemin indirdiği paket hem de düz db.json kabul edilir.
  const eskiYedek = db.iceAktar(gelen?.uygulama === "KADRO DMS" ? gelen.veri : gelen);
  const kasaRaporu = veriyiHazirla();
  const sayilar = Object.fromEntries(["personel", "ekip", "zimmet", "proje", "ev", "arac", "musteri", "avans", "kasa", "puantaj", "belge"]
    .map((k) => [k, db.tablo(k).length]));
  res.json({ sayilar, eskiYedek: path.relative(BURASI, eskiYedek), kasa: kasaRaporu });
}));

/**
 * Tüm kayıtları sıfırlar. Önce veri/yedekler'e yedek alınır; ayarlar kalır.
 * belgeler: true ise belge klasörü silinmez, "(eski tarih)" adıyla kenara alınır ve boş yapı yeniden kurulur.
 */
app.post("/api/sifirla", sar((req, res) => {
  if (req.body?.onay !== "SİL") throw new Error('Onay için "SİL" yazılmalı.');
  // Önce belge klasörü: açık bir dosya yüzünden kenara alınamazsa hiçbir kayıt silinmez.
  const eskiKok = req.body.belgeler ? klasor.kokuKenaraAl(kok()) : null;
  const yedek = db.sifirla();
  for (const k of bekleyen.values()) { try { fs.unlinkSync(k.yol); } catch {} }
  bekleyen.clear();
  kasaImza.clear(); kasaDosyaHatasi.clear();
  if (eskiKok) klasor.yapiyiKur(kok());
  res.json({ yedek: path.relative(BURASI, yedek), eskiKok });
}));

/* ------------------------------------------------------------------ */
/* Klasör ağacı                                                        */
/* ------------------------------------------------------------------ */

app.get("/api/agac", sar((_req, res) => res.json(klasor.agacTara(kok()))));

app.get("/api/yapi", sar((_req, res) => res.json({ duz: duzYapi(), sablon: SABLONLAR })));

app.get("/api/hedefler", sar((_req, res) => res.json(klasor.hedefKlasorler(kok()))));

app.post("/api/klasor-ac", sar((req, res) => {
  const tam = klasor.klasorAcExplorer(kok(), req.body.yol || "");
  if (!fs.existsSync(tam)) return res.status(404).json({ hata: "Klasör diskte yok. Önce Yapıyı Kur deyin." });
  if (process.platform === "win32") exec(`explorer "${tam}"`);
  else if (process.platform === "darwin") exec(`open "${tam}"`);
  else exec(`xdg-open "${tam}"`);
  res.json({ acildi: tam });
}));

/* Belge silme: dosya "_Silinenler"e taşınır, Belge Defteri'ne not düşülür. Geri yüklenebilir. */

const simdi = () => new Date().toLocaleString("tr-TR");

app.post("/api/belge/sil", sar((req, res) => {
  const { klasor: yol, ad } = req.body || {};
  const sonuc = klasor.dosyaSil(kok(), yol, ad);
  const durum = `Silindi ${simdi()} · ${db.ayarlar().kullanici} · Silinenler'de`;
  // Defterdeki en son kaydı işaretle; defterde yoksa (elle konmuş dosya) silme kaydı açılır.
  const kayit = db.tablo("belge").filter((b) => b.hedefYol === yol && b.dosyaAdi === ad && !b.silinenYol).at(-1);
  if (kayit) db.satirGuncelle("belge", kayit._id, { durum, silinenYol: sonuc.yol });
  else {
    db.satirEkle("belge", {
      tarih: simdi(), dosyaAdi: ad, hedefYol: yol, belgeTuru: "", ilgili: "", yontem: "Elle", guven: "—", boyut: "",
      kullanici: db.ayarlar().kullanici, durum, silinenYol: sonuc.yol,
    });
  }
  res.json(sonuc);
}));

app.post("/api/belge/geri", sar((req, res) => {
  const { klasor: yol, ad } = req.body || {};
  const sonuc = klasor.dosyaGeriYukle(kok(), yol, ad);
  const kayit = db.tablo("belge").find((b) => b.silinenYol === `${yol}/${ad}`);
  if (kayit) {
    db.satirGuncelle("belge", kayit._id, {
      durum: `Geri yüklendi ${simdi()} · ${db.ayarlar().kullanici}`, dosyaAdi: sonuc.ad, hedefYol: sonuc.klasor, silinenYol: "",
    });
  }
  res.json(sonuc);
}));

app.post("/api/belge/kalici-sil", sar((req, res) => {
  const { klasor: yol, ad } = req.body || {};
  klasor.kaliciSil(kok(), yol, ad);
  const kayit = db.tablo("belge").find((b) => b.silinenYol === `${yol}/${ad}`);
  if (kayit) db.satirGuncelle("belge", kayit._id, { durum: `Kalıcı silindi ${simdi()} · ${db.ayarlar().kullanici}`, silinenYol: "" });
  res.json({ silindi: true });
}));

/* ------------------------------------------------------------------ */
/* Tablolar                                                            */
/* ------------------------------------------------------------------ */

function tanimAl(ad) {
  const t = TABLOLAR[ad];
  if (!t) throw new Error(`Bilinmeyen tablo: ${ad}`);
  return t;
}

/** Satır kaydedilirken çalışan yan etkiler: kod üretimi, klasör açma, alan doldurma. */
function satirHazirla(tabloAdi, gelen, mevcut) {
  const tanim = tanimAl(tabloAdi);
  const satir = { ...(mevcut || {}) };

  for (const k of tanim.kolon) {
    if (k.hesap || (k.tur === "salt" && k.k !== "kod")) continue;
    if (k.k in gelen) satir[k.k] = gelen[k.k];
    else if (satir[k.k] === undefined) satir[k.k] = k.varsayilan ?? "";
  }
  // Hesaplanan sütunlar diske yazılmaz.
  for (const k of tanim.kolon) if (k.hesap) delete satir[k.k];

  for (const k of tanim.kolon) {
    if (k.zorunlu && !String(satir[k.k] || "").trim()) {
      throw new Error(`"${k.b}" alanı boş bırakılamaz.`);
    }
  }

  if (KODLU.includes(tabloAdi) && !satir.kod) {
    satir.kod = sonrakiKod(tabloAdi, db.tablo(tabloAdi));
  }
  if (tabloAdi === "zimmet") {
    if (satir.sahipTuru === "Ekip") {
      if (!db.satirBul("ekip", (x) => x.kod === satir.ekipKod)) {
        throw new Error(satir.ekipKod ? `"${satir.ekipKod}" numaralı ekip bulunamadı.` : "Ekip zimmeti için bir ekip seçin.");
      }
      satir.personelKod = "";
    } else {
      satir.sahipTuru = "Kişi";
      if (!db.satirBul("personel", (x) => x.kod === satir.personelKod)) {
        throw new Error(satir.personelKod ? `"${satir.personelKod}" kodlu personel bulunamadı.` : "Kişisel zimmet için bir personel seçin.");
      }
      satir.ekipKod = "";
    }
  }
  if (tabloAdi === "avans" && !db.satirBul("personel", (x) => x.kod === satir.personelKod)) {
    throw new Error(`"${satir.personelKod}" kodlu personel bulunamadı.`);
  }
  if (tabloAdi === "kontrat") kontrat.dogrula(satir);
  if (tabloAdi === "personel") maasGecmisiIsle(satir, mevcut);
  if (tabloAdi === "kasa") kasaSatiriHazirla(satir, mevcut);
  return satir;
}

/**
 * Maaş bölümü değiştiyse tarihli olarak geçmişe yazılır. Puantaj dönemleri açılırken
 * maaşı o anki hâlinden kopyaladığı için değişiklik sadece yeni dönemlere yansır.
 */
function maasGecmisiIsle(satir, mevcut) {
  const alanlar = ["odemeTuru", "ucret", "paraBirimi", "mesaiUcreti"];
  const degisti = alanlar.some((k) => String(mevcut?.[k] ?? "") !== String(satir[k] ?? ""));
  if (!degisti || !(String(satir.ucret || "").trim() || mevcut?.ucret)) return;
  satir.maasGecmisi = [
    ...(mevcut?.maasGecmisi || []),
    {
      tarih: new Date().toISOString().slice(0, 10),
      odemeTuru: satir.odemeTuru || "", ucret: satir.ucret || "", paraBirimi: satir.paraBirimi || "",
      mesaiUcreti: satir.mesaiUcreti || "",
      kullanici: db.ayarlar().kullanici,
    },
  ];
}

/** Kasa satırı: elle girilen satır "Elle" kaynaklıdır; otomatik satır elle değişirse bir daha ezilmez. */
function kasaSatiriHazirla(satir, mevcut) {
  if (!["Gelir", "Gider"].includes(satir.tur)) throw new Error('Tür "Gelir" ya da "Gider" olmalı.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(satir.tarih || ""))) throw new Error("Tarih geçersiz.");
  if (!(iliski.sayi(satir.tutar) > 0)) throw new Error("Tutar sıfırdan büyük bir sayı olmalı.");
  if (!mevcut) satir.kaynak = "Elle";
  else if (mevcut.anahtar && !mevcut.elleDuzeltildi && kasa.elleDegistiMi(mevcut, satir)) satir.elleDuzeltildi = true;
}

/** Kayıt değişince kullanıcıya gösterilecek uyarı (ör. ev kapasitesi aşıldı). */
function kayitUyarisi(tabloAdi, satir, eski) {
  if (tabloAdi === "personel" && satir.ev && satir.ev !== eski?.ev) {
    const ev = db.satirBul("ev", (x) => x.kod === satir.ev);
    const h = ev && iliski.evHesap(ev);
    if (h?.asim) return `${ev.kod} ${ev.ad}: ${h.kisiSayisi} kişi kalıyor, yatak sayısı ${h.yatak}. Kapasite aşıldı.`;
  }
  if (tabloAdi === "personel" && eski && kontrat.durumOtomatikMi(satir.kod) && satir.durum !== eski.durum) {
    return "Bu kişinin durumu çalışma dönemlerinden hesaplanıyor; elle değiştirilemez. Kişi sayfasındaki Çalışma Dönemleri kartından düzenleyin.";
  }
  return null;
}

/** Çalışma dönemi ya da personel değişince durumlar ve açık puantajlar tazelenir. */
const kontratEsitle = (tabloAdi) => { if (tabloAdi === "kontrat" || tabloAdi === "personel") kontrat.esitle(); };

app.get("/api/tablo/:ad", sar((req, res) => {
  const tanim = tanimAl(req.params.ad);
  res.json({ tanim, satirlar: db.tablo(req.params.ad).map((s) => iliski.zenginlestir(req.params.ad, s)) });
}));

app.get("/api/detay/:ad/:id", sar((req, res) => {
  const tanim = tanimAl(req.params.ad);
  if (!tanim.detay) throw new Error(`${tanim.ad} için ayrıntı sayfası yok.`);
  const d = iliski.detay(req.params.ad, req.params.id);
  const klasorYolu = tanim.klasorTuru ? klasor.dinamikYol(tanim.klasorTuru, d.satir) : null;
  res.json({ tanim, klasorYolu, ...d });
}));

/* Ekle / güncelle / sil: tablo ekranı ve sesli komut aynı yoldan geçer. */

function tabloEkle(tabloAdi, gelen) {
  const tanim = tanimAl(tabloAdi);
  if (tanim.saltOkunur) throw new Error(`${tanim.ad} düzenlenemez.`);

  const satir = db.satirEkle(tabloAdi, satirHazirla(tabloAdi, gelen || {}, null));
  if (tabloAdi === "avans") kasa.esitle();
  kontratEsitle(tabloAdi);
  let klasorRaporu = null;
  if (tanim.klasorTuru) klasorRaporu = klasor.dinamikKlasorKur(kok(), tanim.klasorTuru, satir);
  return {
    satir: iliski.zenginlestir(tabloAdi, satir),
    klasorRaporu,
    klasorYolu: tanim.klasorTuru ? klasor.dinamikYol(tanim.klasorTuru, satir) : null,
    uyari: kayitUyarisi(tabloAdi, satir, null),
  };
}

function tabloGuncelle(tabloAdi, id, gelen) {
  const tanim = tanimAl(tabloAdi);
  if (tanim.saltOkunur) throw new Error(`${tanim.ad} düzenlenemez.`);

  const eski = db.satirBul(tabloAdi, (x) => x._id === id);
  if (!eski) throw new Error("Kayıt bulunamadı.");

  const oncekiKopya = { ...eski };
  const hazir = satirHazirla(tabloAdi, gelen || {}, eski);
  const durumIstek = hazir.durum;
  const satir = db.satirGuncelle(tabloAdi, id, hazir);
  if (tabloAdi === "avans") kasa.esitle();
  kontratEsitle(tabloAdi);

  let adDegisikligi = null;
  if (tanim.klasorTuru) {
    adDegisikligi = klasor.klasorYenidenAdlandir(kok(), tanim.klasorTuru, oncekiKopya, satir);
    klasor.dinamikKlasorKur(kok(), tanim.klasorTuru, satir);
  }
  return { satir: iliski.zenginlestir(tabloAdi, satir), adDegisikligi, uyari: kayitUyarisi(tabloAdi, { ...satir, durum: durumIstek }, oncekiKopya) };
}

app.post("/api/tablo/:ad", sar((req, res) => res.json(tabloEkle(req.params.ad, req.body))));

app.put("/api/tablo/:ad/:id", sar((req, res) => res.json(tabloGuncelle(req.params.ad, req.params.id, req.body))));

/**
 * Silinen kayda bağlı alanları boşaltır. Açık ekip zimmeti varken ekip silinemez.
 * Döner: kullanıcıya gösterilecek not (varsa).
 */
function silmeOncesi(tabloAdi, satir) {
  const bosalt = (tablo, alan) => {
    for (const r of db.tablo(tablo)) if (r[alan] === satir.kod) db.satirGuncelle(tablo, r._id, { [alan]: "" });
  };
  if (tabloAdi === "ekip") {
    const acik = iliski.ekipZimmetleri(satir.kod);
    if (acik.length) {
      throw new Error(`${satir.kod} ${satir.ad} üzerinde ${acik.length} açık zimmet var. ` +
        "Önce zimmetleri iade alın ya da başka bir ekibe/kişiye aktarın.");
    }
    bosalt("personel", "ekip");
  }
  if (tabloAdi === "ev") bosalt("personel", "ev");
  if (tabloAdi === "personel") {
    db.tum().kontrat = db.tablo("kontrat").filter((r) => r.personelKod !== satir.kod);
    notlar.kisininNotlariniSil(satir.kod);
  }
  if (tabloAdi === "proje") { bosalt("ekip", "proje"); bosalt("ev", "proje"); }
  if (tabloAdi === "kasa") return kasa.silinirken(satir);
  return null;
}

function tabloSil(tabloAdi, id) {
  const tanim = tanimAl(tabloAdi);
  if (tanim.saltOkunur) throw new Error(`${tanim.ad} düzenlenemez.`);
  const hedef = db.satirBul(tabloAdi, (x) => x._id === id);
  const not = hedef ? silmeOncesi(tabloAdi, hedef) : null;
  const silindi = db.satirSil(tabloAdi, id);
  if (tabloAdi === "avans") kasa.esitle();
  kontratEsitle(tabloAdi);
  // Klasör kasten silinmez — belgeler durur. Kullanıcı isterse elle siler.
  return { silindi, uyari: not || (tanim.klasorTuru ? "Kayıt silindi. Diskteki klasör ve belgeler olduğu gibi duruyor." : null) };
}

app.delete("/api/tablo/:ad/:id", sar((req, res) => res.json(tabloSil(req.params.ad, req.params.id))));

asistan.baglan({ ekle: tabloEkle, guncelle: tabloGuncelle, sil: tabloSil });
asistan.kayitBaslat(VERI_DIZINI, SURUM);

/* Kişi notları (personel sayfasındaki Notlar paneli) */

app.get("/api/notlar/:kod", sar((req, res) => res.json(notlar.liste(req.params.kod))));
app.post("/api/notlar", sar((req, res) => res.json(notlar.ekle(req.body?.personelKod, req.body || {}))));
app.put("/api/notlar/:id", sar((req, res) => res.json(notlar.guncelle(req.params.id, req.body || {}))));
app.delete("/api/notlar/:id", sar((req, res) => { notlar.sil(req.params.id); res.json({ silindi: true }); }));

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

app.get("/api/tablo/:ad/excel", sar(async (req, res) => {
  const tanim = tanimAl(req.params.ad);
  const tampon = await excel.tabloyuYaz(req.params.ad, db.tablo(req.params.ad).map((s) => iliski.zenginlestir(req.params.ad, s)));
  const dosyaAdi = `KADRO ${tanim.ad} ${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(dosyaAdi)}`);
  res.end(Buffer.from(tampon));
}));

app.post("/api/tablo/:ad/excel", yukleyici.single("dosya"), sar(async (req, res) => {
  const tabloAdi = req.params.ad;
  const tanim = tanimAl(tabloAdi);
  if (tanim.saltOkunur) throw new Error(`${tanim.ad} içe aktarılamaz.`);
  if (!req.file) throw new Error("Dosya gelmedi.");

  const { satirlar, taninanSutun } = await excel.tabloyuOku(tabloAdi, fs.readFileSync(req.file.path));
  fs.unlinkSync(req.file.path);

  const anahtar = { personel: "kod", proje: "kod", musteri: "kod", ekip: "kod", ev: "kod", arac: "plaka", zimmet: null, avans: null, kasa: null, kontrat: null }[tabloAdi];
  const rapor = { eklenen: 0, guncellenen: 0, atlanan: [], klasor: 0 };

  for (const [i, ham] of satirlar.entries()) {
    try {
      const mevcut = anahtar && ham[anahtar]
        ? db.satirBul(tabloAdi, (x) => String(x[anahtar]).trim() === String(ham[anahtar]).trim())
        : null;
      if (mevcut) {
        const satir = db.satirGuncelle(tabloAdi, mevcut._id, satirHazirla(tabloAdi, ham, mevcut));
        if (tanim.klasorTuru) { klasor.dinamikKlasorKur(kok(), tanim.klasorTuru, satir); rapor.klasor += 1; }
        rapor.guncellenen += 1;
      } else {
        const satir = db.satirEkle(tabloAdi, satirHazirla(tabloAdi, ham, null));
        if (tanim.klasorTuru) { klasor.dinamikKlasorKur(kok(), tanim.klasorTuru, satir); rapor.klasor += 1; }
        rapor.eklenen += 1;
      }
    } catch (e) {
      rapor.atlanan.push({ satir: i + 1, sebep: e.message });
    }
  }
  if (tabloAdi === "avans") kasa.esitle();
  kontratEsitle(tabloAdi);
  res.json({ ...rapor, taninanSutun, okunan: satirlar.length });
}));

/* ------------------------------------------------------------------ */
/* Belge yükleme ve otomatik yönlendirme                               */
/* ------------------------------------------------------------------ */

app.post("/api/yukle", yukleyici.array("dosyalar", 30), sar(async (req, res) => {
  if (!req.files?.length) throw new Error("Dosya gelmedi.");
  const sonuclar = [];

  for (const f of req.files) {
    const orijinal = Buffer.from(f.originalname, "latin1").toString("utf8");
    const ad = /[À-ÿ]/.test(f.originalname) && !/[ğüşıöçİĞÜŞÖÇ]/.test(f.originalname)
      ? orijinal : f.originalname;
    try {
      const sonuc = await siniflandir(f.path, ad);
      const fis = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      bekleyen.set(fis, { yol: f.path, ad, boyut: f.size, zaman: Date.now() });
      sonuclar.push({ fis, boyut: f.size, ...sonuc });
    } catch (e) {
      try { fs.unlinkSync(f.path); } catch {}
      sonuclar.push({ dosyaAdi: ad, hata: e.message });
    }
  }
  res.json({ sonuclar });
}));

app.post("/api/yerlestir", sar((req, res) => {
  const { fis, hedefYol, dosyaAdi, belgeTuru, ilgili, yontem, guven } = req.body || {};
  const kayit = bekleyen.get(fis);
  if (!kayit) throw new Error("Dosya süresi doldu veya zaten yerleştirildi. Lütfen yeniden yükleyin.");
  if (!hedefYol) throw new Error("Hedef klasör seçilmedi.");

  const yerlesen = klasor.dosyaYerlestir(kok(), kayit.yol, hedefYol, dosyaAdi || kayit.ad);
  bekleyen.delete(fis);

  const defterKaydi = db.satirEkle("belge", {
    tarih: new Date().toLocaleString("tr-TR"),
    dosyaAdi: yerlesen.ad,
    hedefYol,
    belgeTuru: belgeTuru || "",
    ilgili: ilgili || "",
    yontem: yontem === "claude" ? "Yapay zekâ" : yontem === "kural" ? "Kural" : "Elle",
    guven: guven ? `%${Math.round(guven * 100)}` : "—",
    boyut: `${(yerlesen.boyut / 1024).toFixed(0)} KB`,
    kullanici: db.ayarlar().kullanici,
  });
  res.json({ yerlesen, defterKaydi });
}));

app.post("/api/iptal", sar((req, res) => {
  const kayit = bekleyen.get(req.body.fis);
  if (kayit) { try { fs.unlinkSync(kayit.yol); } catch {} bekleyen.delete(req.body.fis); }
  res.json({ iptal: true });
}));

/** Hedef elle değiştirilince dosya adı önerisini tazeler. */
app.post("/api/ad-oner", sar((req, res) => {
  const { dosyaAdi, hedefYol } = req.body || {};
  const kural = kuralIle(dosyaAdi || "");
  res.json({ ad: onerilenAd(dosyaAdi || "", { ...kural, hedefYol }) });
}));

/* ------------------------------------------------------------------ */
/* Puantaj                                                             */
/* ------------------------------------------------------------------ */

/** Ekrana giden dönem paketi: kayıt + hesap + gün başlıkları + komşu dönemler. */
function puantajPaketi(donem) {
  const d = puantaj.donemCoz(donem).donem;
  const p = puantaj.bul(d);
  const ortak = {
    donem: d, ad: puantaj.donemAdi(d),
    onceki: puantaj.komsuDonem(d, -1), sonraki: puantaj.komsuDonem(d, 1),
    buDonem: puantaj.buDonem(),
    gunler: puantaj.gunBilgisi(d),
  };
  if (!p) return { ...ortak, yok: true, onizleme: puantaj.onizleme(d) };
  return { ...ortak, kayit: p, hesap: puantaj.hesapla(p) };
}

const puantajDosyaYolu = (donem) => {
  const d = puantaj.donemCoz(donem);
  return `02 - Muhasebe/Maaşlar/Puantaj/${d.yil}-${String(d.ay).padStart(2, "0")} ${d.yari}. Yarı.xlsx`;
};

app.get("/api/puantaj", sar((_req, res) => {
  res.json(puantaj.tumDonemler().map((p) => ({ donem: p.donem, ad: puantaj.donemAdi(p.donem), durum: p.durum, kisi: p.satirlar.length })));
}));

app.get("/api/puantaj/:donem", sar((req, res) => res.json(puantajPaketi(req.params.donem))));

app.post("/api/puantaj/:donem", sar((req, res) => {
  puantaj.olustur(req.params.donem);
  res.json(puantajPaketi(req.params.donem));
}));

app.put("/api/puantaj/:donem/hucre", sar((req, res) => {
  const liste = Array.isArray(req.body?.degisiklikler) ? req.body.degisiklikler : [req.body];
  puantaj.hucreYaz(req.params.donem, liste);
  res.json(puantajPaketi(req.params.donem));
}));

app.put("/api/puantaj/:donem/ekip-gun", sar((req, res) => {
  const { personelKod, gunler, ekip } = req.body || {};
  puantaj.ekipGunYaz(req.params.donem, personelKod, gunler || [], ekip || "");
  res.json(puantajPaketi(req.params.donem));
}));

app.put("/api/puantaj/:donem/ayar", sar((req, res) => {
  puantaj.ayarYaz(req.params.donem, req.body || {});
  res.json(puantajPaketi(req.params.donem));
}));

app.post("/api/puantaj/:donem/satir", sar((req, res) => {
  puantaj.satirEkle(req.params.donem, req.body?.personelKod);
  res.json(puantajPaketi(req.params.donem));
}));

app.delete("/api/puantaj/:donem/satir/:kod", sar((req, res) => {
  puantaj.satirCikar(req.params.donem, req.params.kod);
  res.json(puantajPaketi(req.params.donem));
}));

app.post("/api/puantaj/:donem/kapat", sar(async (req, res) => {
  const p = puantaj.al(req.params.donem);
  if (p.durum === "kapali") throw new Error("Dönem zaten kapalı.");
  // Önce kilitle, sonra kapalı hâliyle Excel'i yaz (boş günler artık eksik sayılır).
  puantaj.durumYaz(p.donem, "kapali");
  const yol = puantajDosyaYolu(p.donem);
  let dosya = null;
  try {
    const tampon = await excel.puantajYaz(p, puantaj.hesapla(p), puantaj.gunBilgisi(p.donem), puantaj.donemAdi(p.donem));
    const tam = klasor.tamYol(kok(), yol);
    fs.mkdirSync(path.dirname(tam), { recursive: true });
    fs.writeFileSync(tam, Buffer.from(tampon));
    dosya = yol;
  } catch (e) {
    console.error(`[puantaj] Excel yazılamadı: ${e.message}`);
  }
  puantaj.durumYaz(p.donem, "kapali", { dosya });
  const kasaRaporu = kasa.esitle();
  res.json({
    ...puantajPaketi(p.donem), dosya, kasa: kasaRaporu,
    dosyaHatasi: dosya ? null : "Dönem kapandı ama Excel dosyası diske yazılamadı. Belge kökünü kontrol edin.",
  });
}));

app.post("/api/puantaj/:donem/ac", sar((req, res) => {
  puantaj.durumYaz(puantaj.al(req.params.donem).donem, "acik");
  // Kapanışta kasaya yazılan yemek / kira / maaş satırları geri alınır (elle düzeltilenler durur).
  res.json({ ...puantajPaketi(req.params.donem), kasa: kasa.esitle() });
}));

app.get("/api/puantaj/:donem/excel", sar(async (req, res) => {
  const p = puantaj.al(req.params.donem);
  const tampon = await excel.puantajYaz(p, puantaj.hesapla(p), puantaj.gunBilgisi(p.donem), puantaj.donemAdi(p.donem));
  const d = puantaj.donemCoz(p.donem);
  const ad = `KADRO Puantaj ${d.yil}-${String(d.ay).padStart(2, "0")} ${d.yari}. Yarı.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(ad)}`);
  res.end(Buffer.from(tampon));
}));

app.post("/api/puantaj/:donem/excel", yukleyici.single("dosya"), sar(async (req, res) => {
  if (!req.file) throw new Error("Dosya gelmedi.");
  const p = puantaj.al(req.params.donem);
  let okunan;
  try {
    okunan = await excel.puantajOku(fs.readFileSync(req.file.path), p, puantaj.gunBilgisi(p.donem));
  } finally {
    fs.unlinkSync(req.file.path);
  }
  // Değişmeyen hücreleri ayıkla; hatalı bir değer varsa hiçbir şey yazılmaz.
  const degisen = okunan.degisiklikler.filter(({ personelKod, gun, deger }) => {
    const s = p.satirlar.find((x) => x.personelKod === personelKod);
    return (s.hucre[gun] || "") !== puantaj.degerNormalize(deger);
  });
  if (degisen.length) puantaj.hucreYaz(p.donem, degisen);
  res.json({ ...puantajPaketi(p.donem), rapor: { degisen: degisen.length, bilinmeyen: okunan.bilinmeyen } });
}));

app.get("/api/istatistik", sar((req, res) => {
  res.json(puantaj.istatistik(req.query.bas || "", req.query.bit || ""));
}));

app.get("/api/istatistik/personel/:kod", sar((req, res) => res.json(puantaj.personelDokumu(req.params.kod))));

/** Çalışanın gözünden sayfası: kişinin kendi puantajı, hakedişi, kesinti nedenleri ve ödemeleri. */
app.get("/api/calisan/:kod", sar((req, res) => res.json({ ...calisan.gorunum(req.params.kod), kurAyari: kurlar.kurAyari() })));

/* ------------------------------------------------------------------ */
/* Kasa                                                                */
/* ------------------------------------------------------------------ */

const kasaDosyaYolu = (ay) => `02 - Muhasebe/Kasa/${ay} Kasa.xlsx`;

/** Kasa satırları: ekran ve Excel için durum etiketi, proje ve personel adı eklenir. */
function kasaSatirlari(satirlar) {
  const proje = new Map(db.tablo("proje").map((x) => [x.kod, x.ad]));
  const personel = new Map(db.tablo("personel").map((x) => [x.kod, x.ad]));
  return satirlar.map((r) => ({
    ...iliski.zenginlestir("kasa", r),
    projeAd: r.proje ? proje.get(r.proje) || r.proje : "",
    personelAd: r.personelKod ? personel.get(r.personelKod) || r.personelKod : "",
  }));
}

const kasaAyi = (ay) => { const v = kasa.ay(ay); return { ...v, satirlar: kasaSatirlari(v.satirlar) }; };

// Aylık kasa dosyası: en son yazılan içeriğin imzası ve yazılamadıysa sebebi.
const kasaImza = new Map();
const kasaDosyaHatasi = new Map();
let kasaZamanlayici = null;

function kasaDosyalariniZamanla() {
  clearTimeout(kasaZamanlayici);
  kasaZamanlayici = setTimeout(() => kasaDosyalariniYaz().catch((e) => console.error(`[kasa] ${e.message}`)), 400);
}

async function kasaDosyalariniYaz() {
  if (!fs.existsSync(kok())) return; // yapı henüz diske kurulmadı
  for (const ay of new Set([...kasaImza.keys(), ...kasa.aylar()])) {
    const v = kasaAyi(ay);
    const imza = JSON.stringify([v.satirlar.map((r) => [r._id, r.tarih, r.tur, r.kategori, r.aciklama, r.proje,
      r.personelKod, r.tutar, r.paraBirimi, r.durumEtiketi]), v.ozet.devir, v.silinen.length]);
    const tam = klasor.tamYol(kok(), kasaDosyaYolu(ay));
    if (kasaImza.get(ay) === imza && fs.existsSync(tam)) continue;
    try {
      fs.mkdirSync(path.dirname(tam), { recursive: true });
      fs.writeFileSync(tam, Buffer.from(await excel.kasaYaz(v)));
      kasaImza.set(ay, imza);
      kasaDosyaHatasi.delete(ay);
    } catch (e) {
      kasaDosyaHatasi.set(ay, ["EBUSY", "EPERM"].includes(e.code)
        ? "Kasa dosyası şu an Excel'de açık olduğu için güncellenemedi. Dosyayı kapatınca bir sonraki değişiklikte yazılır."
        : `Kasa dosyası yazılamadı: ${e.message}`);
    }
  }
}

// "rapor" bir ay değil; :ay rotalarından önce tanımlanmalı.
app.get("/api/kasa/rapor", sar((req, res) => res.json(kasa.rapor(req.query))));

app.get("/api/kasa/rapor/excel", sar(async (req, res) => {
  const r = kasa.rapor(req.query);
  const turAd = { donem: "15 Günlük", ay: "Aylık", ceyrek: "Çeyreklik", yariyil: "Yarıyıllık", yil: "Yıllık", proje: "Proje Bazlı" }[r.tur];
  const baslik = `Kasa Raporu · ${turAd}${r.tur === "yil" ? "" : ` · ${r.yil}`} · ${r.projeAd}`;
  const tampon = await excel.kasaRaporYaz(r, baslik);
  const ad = `KADRO Kasa Raporu ${turAd} ${r.tur === "yil" ? "" : r.yil}.xlsx`.replace(/\s+\./, ".");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(ad)}`);
  res.end(Buffer.from(tampon));
}));

app.get("/api/kasa/:ay", sar((req, res) => {
  const ay = req.params.ay === "bu" ? kasa.buAy() : req.params.ay;
  res.json({
    ...kasaAyi(ay), tanim: TABLOLAR.kasa,
    dosya: kasaDosyaYolu(ay), dosyaHatasi: kasaDosyaHatasi.get(ay) || null,
  });
}));

app.get("/api/kasa/:ay/excel", sar(async (req, res) => {
  const tampon = await excel.kasaYaz(kasaAyi(req.params.ay));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`KADRO ${req.params.ay} Kasa.xlsx`)}`);
  res.end(Buffer.from(tampon));
}));

app.post("/api/kasa/:ay/geri-getir", sar((req, res) => res.json(kasa.geriGetir(req.params.ay))));

app.post("/api/kasa/satir/:id/sistem", sar((req, res) => {
  const rapor = kasa.sistemeBirak(req.params.id);
  const satir = db.satirBul("kasa", (x) => x._id === req.params.id);
  res.json({ ...rapor, satir: satir ? kasaSatirlari([satir])[0] : null });
}));

/* ------------------------------------------------------------------ */
/* Ödemeler                                                            */
/* ------------------------------------------------------------------ */

/** Vadesi gelmiş (bugün ya da önce) ve ödenmemiş kalem sayısı: menüdeki sayaç. */
function bekleyenOdeme() {
  try {
    const bugun = new Date().toISOString().slice(0, 10);
    const odenen = new Set(db.tablo("odeme").map((r) => r.anahtar));
    return odeme.kalemler().filter((k) => k.vade <= bugun && !odenen.has(k.anahtar)).length;
  } catch { return 0; }
}

app.get("/api/odeme/:ay", sar((req, res) => {
  const ay = req.params.ay === "bu" ? kasa.buAy() : req.params.ay;
  res.json({ ...odeme.ay(ay), ad: kasa.ayAdi(ay), onceki: kasaKomsuAy(ay, -1), sonraki: kasaKomsuAy(ay, 1), buAy: kasa.buAy() });
}));

app.post("/api/odeme", sar((req, res) => {
  const adet = odeme.ode(req.body?.liste || []);
  res.json({ adet, kasa: kasa.esitle() });
}));

app.post("/api/odeme/geri-al", sar((req, res) => {
  odeme.geriAl(req.body?.anahtar);
  res.json({ kasa: kasa.esitle() });
}));

function kasaKomsuAy(ay, yon) {
  const [y, a] = ay.split("-").map(Number);
  const d = new Date(Date.UTC(y, a - 1 + yon, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Öngörü                                                              */
/* ------------------------------------------------------------------ */

app.get("/api/ongoru", sar((req, res) => res.json(ongoru.hesapla(req.query))));

app.put("/api/ongoru/hucre", sar((req, res) => {
  ongoru.hucreYaz(req.body || {});
  res.json(ongoru.hesapla(req.body?.gorunum || {}));
}));

app.get("/api/ongoru/excel", sar(async (req, res) => {
  const v = ongoru.hesapla(req.query);
  const tampon = await excel.ongoruYaz(v);
  const ad = `KADRO Öngörü ${v.sutunlar[0].donem} - ${v.sutunlar.at(-1).donem}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(ad)}`);
  res.end(Buffer.from(tampon));
}));

/* ------------------------------------------------------------------ */
/* Sesli komut (bkz. src/asistan.js)                                   */
/* ------------------------------------------------------------------ */

app.get("/api/asistan", sar((_req, res) => res.json(asistan.durum())));

app.post("/api/asistan/metin", sar(async (req, res) => {
  res.json(await asistan.komut(req.body?.metin, req.body?.konusmaId));
}));

app.post("/api/asistan/ses", yukleyici.single("ses"), sar(async (req, res) => {
  if (!req.file) throw new Error("Ses gelmedi.");
  try { res.json(await asistan.sesKomutu(req.file.path, req.file.mimetype, req.body?.konusmaId)); }
  finally { fs.unlink(req.file.path, () => {}); }
}));

app.post("/api/asistan/onayla", sar((req, res) => res.json(asistan.onayla(req.body?.id))));
app.post("/api/asistan/vazgec", sar((req, res) => res.json(asistan.vazgec(req.body?.id))));
app.post("/api/asistan/geri-al", sar((req, res) => res.json(asistan.geriAl(req.body?.id))));
// Komut kaydı: kuyrukta kaç kayıt var; gönder = 15 dakikayı beklemeden şimdi gönder.
app.get("/api/asistan/kayit", sar((_req, res) => res.json(asistan.kayitDurumu())));
app.post("/api/asistan/kayit/gonder", sar(async (_req, res) => res.json({ ...(await asistan.kayitGonder()), ...asistan.kayitDurumu() })));

/* ------------------------------------------------------------------ */
/* Süre uyarıları                                                      */
/* ------------------------------------------------------------------ */

app.get("/api/uyarilar", sar((_req, res) => {
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const cikti = [];

  for (const [tabloAdi, tanim] of Object.entries(TABLOLAR)) {
    const uyariliKolonlar = tanim.kolon.filter((k) => k.uyari);
    if (!uyariliKolonlar.length) continue;

    for (const satir of db.tablo(tabloAdi)) {
      if (["Ayrıldı", "Satıldı", "Arşiv", "Boşaltıldı", "Pasif"].includes(satir.durum)) continue;
      for (const k of uyariliKolonlar) {
        const ham = String(satir[k.k] || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ham)) continue;
        const t = new Date(ham + "T00:00:00");
        const kalan = Math.round((t - bugun) / 86400000);
        if (kalan > k.uyari) continue;
        const kisi = satir.personelKod ? db.satirBul("personel", (x) => x.kod === satir.personelKod) : null;
        if (tabloAdi === "kontrat" && !kontrat.uyarilsinMi(satir, kalan)) continue;
        cikti.push({
          tablo: tabloAdi,
          tabloAd: tanim.ad,
          id: satir._id,
          kim: satir.ad || satir.plaka || satir.kod || kisi?.ad || "—",
          href: tabloAdi === "kontrat" && kisi ? `#d/personel/${kisi._id}` : null,
          alan: k.b,
          tarih: ham,
          kalan,
          seviye: kalan < 0 ? "gecti" : kalan <= 15 ? "kritik" : "yaklasiyor",
        });
      }
    }
  }
  cikti.sort((a, b) => a.kalan - b.kalan);
  res.json(cikti);
}));

/* ------------------------------------------------------------------ */

// Gün dönünce çalışma dönemi biten / başlayan kişilerin durumu güncellenir.
setInterval(() => { try { kontrat.esitle(); } catch (e) { console.error(`[kontrat] ${e.message}`); } }, 3600_000).unref();

// Bir saatten eski bekleyen yüklemeleri temizle.
setInterval(() => {
  const sinir = Date.now() - 3600_000;
  for (const [fis, k] of bekleyen) {
    if (k.zaman < sinir) { try { fs.unlinkSync(k.yol); } catch {} bekleyen.delete(fis); }
  }
}, 600_000).unref();

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ hata: "Bilinmeyen uç." });
  if (PAKETLI) return res.type("html").send(Buffer.from(sea.getAsset("index.html")));
  res.sendFile(path.join(BURASI, "public", "index.html"));
});

/** Paketli sürümde hata olursa pencere hemen kapanmasın, kullanıcı mesajı okuyabilsin. */
function durVeBekle(mesaj) {
  console.error("\n  [HATA] " + mesaj + "\n");
  if (!PAKETLI) process.exit(1);
  console.error("  Kapatmak için bir tuşa basın veya pencereyi kapatın.");
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(1));
}
process.on("uncaughtException", (e) => durVeBekle(e.message));

/**
 * Başlangıç verisi: müşteriye giden exe'nin içine gömülen kayıtlar (paketle.mjs --veri).
 * Bu bilgisayarda ilk açılışta ve sistem boşsa bir kez yüklenir; klasör yapısı kurulur,
 * kapanmış puantajların ve kasanın Excel dosyaları yazılır. Kayıt varsa hiçbir şeye dokunulmaz.
 */
function baslangicVerisiniYukle() {
  if (!PAKETLI || db.ayarlar().baslangicVerisi) return null;
  let ham;
  try { ham = Buffer.from(sea.getAsset("baslangic-verisi.json")).toString("utf8"); } catch { return null; }
  const tarih = new Date().toISOString();
  const dolu = ["personel", "proje", "ekip", "ev", "musteri", "arac", "zimmet", "avans", "puantaj", "kasa"].some((k) => db.tablo(k).length);
  if (dolu) {
    db.ayarKaydet({ baslangicVerisi: { tarih, atlandi: "Bu bilgisayarda zaten kayıt vardı." } });
    return { atlandi: true };
  }
  const gelen = JSON.parse(ham.replace(/^﻿/, ""));
  db.iceAktar(gelen?.uygulama === "KADRO DMS" ? gelen.veri : gelen);
  db.ayarKaydet({ baslangicVerisi: { tarih, kaynak: gelen?.tarih || null } });
  veriyiHazirla();
  klasor.yapiyiKur(kok());
  (async () => {
    for (const p of puantaj.tumDonemler().filter((x) => x.durum === "kapali")) {
      const tam = klasor.tamYol(kok(), puantajDosyaYolu(p.donem));
      if (fs.existsSync(tam)) continue;
      fs.mkdirSync(path.dirname(tam), { recursive: true });
      fs.writeFileSync(tam, Buffer.from(await excel.puantajYaz(p, puantaj.hesapla(p), puantaj.gunBilgisi(p.donem), puantaj.donemAdi(p.donem))));
    }
    await kasaDosyalariniYaz();
  })().catch((e) => console.error(`[başlangıç verisi] dosyalar yazılamadı: ${e.message}`));
  return { personel: db.tablo("personel").length, proje: db.tablo("proje").length };
}
let baslangic = null;
try { baslangic = baslangicVerisiniYukle(); } catch (e) { console.error(`[başlangıç verisi] yüklenemedi: ${e.message}`); }

const sunucu = app.listen(PORT, "127.0.0.1", () => {
  const adres = `http://localhost:${PORT}`;
  console.log("");
  console.log("  ACME MÜHENDİSLİK — Belge Yönetim Sistemi");
  console.log("  " + "─".repeat(46));
  console.log(`  Adres        : ${adres}`);
  console.log(`  Belge kökü   : ${kok()}`);
  console.log(`  Yapay zekâ   : ${db.ayarlar().apiAnahtari || process.env.ANTHROPIC_API_KEY ? "açık" : "kapalı (API anahtarı girilmedi)"}`);
  console.log(`  Bilgisayar   : ${os.hostname()}`);
  if (baslangic?.personel !== undefined) console.log(`  Hazır veri   : yüklendi (${baslangic.personel} personel, ${baslangic.proje} proje)`);
  console.log("");
  console.log("  Kapatmak için bu pencereyi kapatın.");
  console.log("");
  if (!process.env.KADRO_TARAYICI_ACMA && process.platform === "win32") {
    exec(`start "" "${adres}"`);
  }
});

sunucu.on("error", (e) => {
  if (e.code !== "EADDRINUSE") return durVeBekle(e.message);
  // Program zaten açık (ikinci kez çift tıklandı): mevcut olanı tarayıcıda göster.
  console.log(`  KADRO zaten çalışıyor, tarayıcıda açılıyor: http://localhost:${PORT}`);
  if (!process.env.KADRO_TARAYICI_ACMA && process.platform === "win32") exec(`start "" "http://localhost:${PORT}"`);
  setTimeout(() => process.exit(0), 1500);
});
