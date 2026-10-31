/**
 * Takvimli puantaj: 15 günlük dönemler, saat hesabı, hakediş ve istatistikler.
 *
 * Dönem kimliği: "2026-10-1" (1–15) ve "2026-10-2" (16–ay sonu).
 *
 * İLKE: Dönem açılırken personelin maaşı, ekibi, ekiplerin yemek tutarı ve kira payı
 * döneme KOPYALANIR (anlık görüntü). Sonradan yapılan değişiklikler açılmış dönemleri
 * etkilemez; sadece yeni açılan dönemlere yansır.
 *
 * Hücre değerleri: saat ("8", "10.5"), "İ" izin, "R" rapor, "–" gelmedi, "" girilmedi.
 */
import * as db from "./db.js";
import { kisininProjesi, evHesap, KIRA_F } from "./iliskiler.js";
import { kurAyari, cevir, cevirmeMetni } from "./kur.js";
import * as kontrat from "./kontrat.js";

export const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const GUN_KISA = ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"];
export const GUN_TIPLERI = ["normal", "mesai", "tatil"];

export const VARSAYILAN_AYAR = {
  mesaiCarpani: 1.5,     // mesai saatinin ücret çarpanı
  normalSaat: 8,         // normal günde beklenen saat
  haftaIciAsim: false,   // açıksa normal günde normal saati aşan kısım mesai sayılır
  tatilMesai: true,      // açıksa tatil gününde çalışılan saat mesai sayılır
};

/**
 * Hesap kuralları sürümü. Kural 2 (Ekim 2026, müşteri kararı) sadece bundan sonra açılan dönemlere uygulanır:
 *  - Mesai sabit saatlik ücretle ödenir (para birimine göre dönem ayarı; personelde kişiye özel ücret girilebilir).
 *  - Sadece "–" (gelmedi) yazılan gün kesinti doğurur. Boş hücre ve işe giriş öncesi günler kesinti doğurmaz.
 *  - Gelmedi gününde: aylıkçıdan günlük maaş (maaş × 12 ÷ 365) + günlük kira payı + günlük yemek,
 *    saatlikçiden günlük kira payı + günlük yemek kesilir.
 *  - Yemek parası dönemin her günü için önden verilir; kira payı günlük hesaplanır (kira × F ÷ 365).
 * Kural 3 (13 Ekim 2026): kural 2 + kur. Maaştan farklı para birimindeki kira, yemek ve avans dönemin kuruyla
 * (ayar.kur, dönem açılırken Ayarlar'dan kopyalanır) maaşın para birimine çevrilip düşülür. Kur yoksa düşülmez.
 */
export const GUNCEL_KURAL = 3;
export const KURAL2_AYAR = {
  mesaiModu: "ucret",            // "ucret": sabit saatlik mesai ücreti · "carpan": saat değeri × çarpan
  mesaiUcreti: { EUR: 5 },       // para birimine göre saatlik mesai ücreti
  eksikSaatKesinti: false,       // açıksa aylıkçının eksik saatleri (gelmedi günleri dışında) saat değerinden kesilir
};

const pad = (n) => String(n).padStart(2, "0");
const yuvarla = (n) => Math.round(n * 100) / 100;
const trs = (n, basamak = 2) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: basamak });
const sayi = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const bugunMetni = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function topla(hedef, pb, tutar) {
  if (!tutar) return;
  const k = pb || "EUR";
  hedef[k] = yuvarla((hedef[k] || 0) + tutar);
}
const birlestir = (hedef, kaynak) => { for (const [pb, v] of Object.entries(kaynak || {})) topla(hedef, pb, v); return hedef; };

/* ------------------------------------------------------------------ */
/* Dönemler                                                            */
/* ------------------------------------------------------------------ */

export function donemCoz(donem) {
  const m = /^(\d{4})-(\d{2})-([12])$/.exec(String(donem || ""));
  if (!m) throw new Error(`Geçersiz dönem: "${donem}". Beklenen biçim: 2026-10-1`);
  const yil = +m[1], ay = +m[2], yari = +m[3];
  if (ay < 1 || ay > 12) throw new Error(`Geçersiz ay: ${donem}`);
  const sonGun = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
  const bas = yari === 1 ? 1 : 16;
  const bit = yari === 1 ? 15 : sonGun;
  const gunler = [];
  for (let g = bas; g <= bit; g += 1) gunler.push(`${yil}-${pad(ay)}-${pad(g)}`);
  return { donem: `${yil}-${pad(ay)}-${yari}`, yil, ay, yari, bas, bit, gunler };
}

export const donemAdi = (donem) => {
  const d = donemCoz(donem);
  return `${AYLAR[d.ay - 1]} ${d.yil} · ${d.yari}. Yarı (${d.bas}–${d.bit})`;
};

export function tarihDonemi(tarih) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(tarih || ""));
  if (!m) return null;
  return `${m[1]}-${m[2]}-${+m[3] <= 15 ? 1 : 2}`;
}
export const buDonem = () => tarihDonemi(bugunMetni());

export function komsuDonem(donem, yon) {
  const d = donemCoz(donem);
  let { yil, ay, yari } = d;
  if (yon > 0) { if (yari === 1) yari = 2; else { yari = 1; ay += 1; if (ay > 12) { ay = 1; yil += 1; } } }
  else { if (yari === 2) yari = 1; else { yari = 2; ay -= 1; if (ay < 1) { ay = 12; yil -= 1; } } }
  return `${yil}-${pad(ay)}-${yari}`;
}

const haftaGunu = (gun) => new Date(`${gun}T00:00:00Z`).getUTCDay();

/** Varsayılan gün tipi: Cumartesi mesai günü, Pazar tatil, diğerleri normal. */
export const varsayilanGunTipi = (gun) => ({ 6: "mesai", 0: "tatil" }[haftaGunu(gun)] || "normal");

export function gunBilgisi(donem) {
  return donemCoz(donem).gunler.map((g) => ({ gun: g, no: +g.slice(8), kisa: GUN_KISA[haftaGunu(g)] }));
}

/* ------------------------------------------------------------------ */
/* Kayıt erişimi                                                       */
/* ------------------------------------------------------------------ */

const liste = () => { const v = db.tum(); v.puantaj = v.puantaj || []; return v.puantaj; };
export const bul = (donem) => liste().find((p) => p.donem === donem) || null;
export const tumDonemler = () => [...liste()].sort((a, b) => a.donem.localeCompare(b.donem));

export function al(donem) {
  const p = bul(donem);
  if (!p) throw new Error(`${donemAdi(donem)} henüz açılmadı.`);
  return p;
}

function acikOlmali(p) {
  if (p.durum === "kapali") throw new Error(`${donemAdi(p.donem)} kapalı. Değişiklik için önce dönemi yeniden açın.`);
}

/** Bir ekibin döneme kopyalanan hâli. */
function ekipKopyasi(e) {
  const proje = e.proje ? db.satirBul("proje", (x) => x.kod === e.proje) : null;
  return {
    ad: e.ad, proje: e.proje || "", projeAd: proje?.ad || "",
    yemekGunluk: sayi(e.yemekGunluk), yemekPB: e.yemekParaBirimi || "EUR",
  };
}

/** Bir personelin döneme kopyalanan hâli (maaş, ekip, kira payı, çalışma aralıkları). */
function satirKopyasi(p) {
  const ev = p.ev ? db.satirBul("ev", (x) => x.kod === p.ev) : null;
  const kira = ev && ev.durum !== "Boşaltıldı" ? evHesap(ev) : null;
  const calisma = kontrat.araliklar(p.kod);
  return {
    ...(calisma ? { calisma } : {}),
    personelKod: p.kod, ad: p.ad, gorev: p.gorev || "",
    ekip: p.ekip || "", proje: kisininProjesi(p),
    odemeTuru: p.odemeTuru || "", ucret: p.ucret || "", paraBirimi: p.paraBirimi || "EUR",
    mesaiUcreti: p.mesaiUcreti || "", iseGiris: p.iseGiris || "",
    ev: p.ev || "", kiraPayi: kira ? yuvarla(kira.kisiBasiKira / 2) : 0, kiraPB: kira?.paraBirimi || "EUR",
    kiraGunluk: kira ? kira.kisiBasiGunluk : 0,
    hucre: {}, ekipGun: {},
  };
}

/** Bir evin döneme kopyalanan hâli (kira ödemesi bu kopyadan hesaplanır). */
const evKopyasi = (ev) => ({
  ad: ev.ad, proje: ev.proje || "", kira: sayi(ev.kira), kiraPeriyodu: ev.kiraPeriyodu || "Aylık",
  paraBirimi: ev.paraBirimi || "EUR", durum: ev.durum || "Aktif",
});

/** Dönemin ev kopyası. Ev kopyası olmayan eski dönemlerde evlerin güncel hâli kullanılır. */
export const evlerAnlik = (p) => p.evler || Object.fromEntries(db.tablo("ev").map((ev) => [ev.kod, evKopyasi(ev)]));

/** Döneme alınacak kişiler: çalışma dönemi olan, dönemle kesişiyorsa; olmayan, Ayrıldı değilse. */
function donemKisileri(d) {
  return db.tablo("personel").filter((p) => {
    const ar = kontrat.araliklar(p.kod);
    return ar ? kontrat.kesisir(ar, d.gunler[0], d.gunler.at(-1)) : p.durum !== "Ayrıldı";
  });
}

/** Kural 2+ hesabında satırın gün dışı mı (işe giriş öncesi ya da çalışma dönemi dışında). Döner: sebep ya da "". */
export function gunDisi(s, gun) {
  if (s.iseGiris && gun < s.iseGiris) return "girisOncesi";
  if (Array.isArray(s.calisma) && !kontrat.icinde(s.calisma, gun)) return "kontratDisi";
  return "";
}

// Ekip ekip sıralanır; ekipsizler en altta.
const ekipSirasi = (a, b) => (!a.ekip - !b.ekip) || (a.ekip || "").localeCompare(b.ekip || "") || a.ad.localeCompare(b.ad, "tr");

/** Dönemi açar: aktif personeli, ekipleri ve gün tiplerini kopyalar. */
export function olustur(donem) {
  const d = donemCoz(donem);
  if (bul(d.donem)) throw new Error(`${donemAdi(d.donem)} zaten açık.`);
  const ekipler = {};
  for (const e of db.tablo("ekip")) ekipler[e.kod] = ekipKopyasi(e);
  const satirlar = donemKisileri(d).map(satirKopyasi).sort(ekipSirasi);

  // Ayarlar bir önceki dönemden devralınır; ilk dönemde varsayılanlar kullanılır.
  const onceki = bul(komsuDonem(d.donem, -1));
  const p = {
    _id: db.yeniId(),
    donem: d.donem,
    durum: "acik",
    kural: GUNCEL_KURAL,
    olusturma: new Date().toISOString(),
    olusturan: db.ayarlar().kullanici,
    ayar: { ...VARSAYILAN_AYAR, ...KURAL2_AYAR, ...(onceki?.ayar || {}), kur: kurAyari() },
    gunler: Object.fromEntries(d.gunler.map((g) => [g, varsayilanGunTipi(g)])),
    ekipler,
    evler: Object.fromEntries(db.tablo("ev").map((ev) => [ev.kod, evKopyasi(ev)])),
    satirlar,
  };
  liste().push(p);
  db.yaz();
  return p;
}

/** Dönem açılmadan önce ne kopyalanacağını gösterir. */
export function onizleme(donem) {
  const kisiler = donemKisileri(donemCoz(donem));
  return {
    kisi: kisiler.length,
    ekip: new Set(kisiler.map((p) => p.ekip).filter(Boolean)).size,
    maassiz: kisiler.filter((p) => !p.odemeTuru || !sayi(p.ucret)).map((p) => `${p.kod} ${p.ad}`),
    ekipsiz: kisiler.filter((p) => !p.ekip).length,
    oncekiAyar: bul(komsuDonem(donem, -1))?.ayar || null,
  };
}

/* ------------------------------------------------------------------ */
/* Düzenleme                                                           */
/* ------------------------------------------------------------------ */

export function degerNormalize(v) {
  const s = String(v ?? "").trim().toLocaleUpperCase("tr");
  if (!s) return "";
  if (["İ", "I", "İZİN", "IZIN"].includes(s)) return "İ";
  if (["R", "RAPOR"].includes(s)) return "R";
  if (["-", "–", "—", "X", "G"].includes(s)) return "–";
  const n = Number(s.replace(",", "."));
  if (!/^\d+([.,]\d+)?$/.test(s) || !Number.isFinite(n) || n > 24) {
    throw new Error(`"${v}" geçerli değil. Saat (0–24), İ (izin), R (rapor) ya da – (gelmedi) yazın.`);
  }
  return String(yuvarla(n));
}

const satirAl = (p, kod) => {
  const s = p.satirlar.find((x) => x.personelKod === kod);
  if (!s) throw new Error(`${kod} bu dönemde yok.`);
  return s;
};

/** Birden çok hücreyi tek seferde yazar: [{ personelKod, gun, deger }] */
export function hucreYaz(donem, degisiklikler) {
  const p = al(donem);
  acikOlmali(p);
  const gunler = new Set(donemCoz(donem).gunler);
  const etkilenen = new Set();
  // Önce hepsini doğrula; biri hatalıysa hiçbiri yazılmasın.
  const hazir = degisiklikler.map(({ personelKod, gun, deger }) => {
    if (!gunler.has(gun)) throw new Error(`${gun} bu döneme ait değil.`);
    return { s: satirAl(p, personelKod), gun, deger: degerNormalize(deger) };
  });
  for (const { s, gun, deger } of hazir) {
    if (deger) s.hucre[gun] = deger; else delete s.hucre[gun];
    etkilenen.add(s.personelKod);
  }
  db.yaz();
  return [...etkilenen];
}

/** Bir kişinin belirli günlerdeki ekibini değiştirir (dönem ortası ekip değişimi). */
export function ekipGunYaz(donem, personelKod, gunListesi, ekipKod) {
  const p = al(donem);
  acikOlmali(p);
  const s = satirAl(p, personelKod);
  if (ekipKod && !p.ekipler[ekipKod]) {
    const e = db.satirBul("ekip", (x) => x.kod === ekipKod);
    if (!e) throw new Error(`"${ekipKod}" numaralı ekip bulunamadı.`);
    p.ekipler[ekipKod] = ekipKopyasi(e); // dönemden sonra kurulan ekip: o anki hâliyle kopyalanır
  }
  for (const g of gunListesi) {
    if (!ekipKod || ekipKod === s.ekip) delete s.ekipGun[g]; else s.ekipGun[g] = ekipKod;
  }
  db.yaz();
}

export function ayarYaz(donem, { ayar, gunler, kuralGuncelle }) {
  const p = al(donem);
  acikOlmali(p);
  if (kuralGuncelle && (p.kural || 1) < GUNCEL_KURAL) {
    // Açık dönemi yeni kurallara geçirir: eksik ayarlar ve kişilerin yeni alanları bugünkü hâlinden tamamlanır.
    const eski = p.kural || 1;
    p.kural = GUNCEL_KURAL;
    p.ayar = { ...KURAL2_AYAR, ...p.ayar };
    if (!p.ayar.kur) p.ayar.kur = kurAyari();
    if (eski < 2) for (const s of p.satirlar) {
      const k = db.satirBul("personel", (x) => x.kod === s.personelKod);
      const yeni = k ? satirKopyasi(k) : {};
      if (s.mesaiUcreti === undefined) s.mesaiUcreti = yeni.mesaiUcreti || "";
      if (s.iseGiris === undefined) s.iseGiris = yeni.iseGiris || "";
      if (s.kiraGunluk === undefined) s.kiraGunluk = s.ev && s.ev === yeni.ev ? yeni.kiraGunluk || 0 : yuvarla((s.kiraPayi || 0) * 2 * 12 / 365);
    }
    for (const kod of Object.keys(p.evler || {})) if (!p.evler[kod].kiraPeriyodu) p.evler[kod].kiraPeriyodu = "Aylık";
    for (const s of p.satirlar) { const ar = kontrat.araliklar(s.personelKod); if (ar) s.calisma = ar; }
  }
  if (ayar) {
    const a = { ...p.ayar };
    if ("mesaiCarpani" in ayar) a.mesaiCarpani = Math.max(1, Math.min(5, sayi(ayar.mesaiCarpani) || 1.5));
    if ("normalSaat" in ayar) a.normalSaat = Math.max(1, Math.min(24, sayi(ayar.normalSaat) || 8));
    if ("haftaIciAsim" in ayar) a.haftaIciAsim = Boolean(ayar.haftaIciAsim);
    if ("tatilMesai" in ayar) a.tatilMesai = Boolean(ayar.tatilMesai);
    if ("mesaiModu" in ayar) a.mesaiModu = ayar.mesaiModu === "carpan" ? "carpan" : "ucret";
    if ("eksikSaatKesinti" in ayar) a.eksikSaatKesinti = Boolean(ayar.eksikSaatKesinti);
    if (ayar.kur === "guncel") a.kur = kurAyari();   // dönemin kurunu Ayarlar'daki güncel kurla değiştirir
    if (ayar.mesaiUcreti && typeof ayar.mesaiUcreti === "object") {
      a.mesaiUcreti = { ...(a.mesaiUcreti || {}) };
      for (const [pb, v] of Object.entries(ayar.mesaiUcreti)) {
        const n = sayi(v);
        if (n < 0 || n > 100000) throw new Error(`Mesai ücreti geçersiz: ${v}`);
        if (n) a.mesaiUcreti[pb] = yuvarla(n); else delete a.mesaiUcreti[pb];
      }
    }
    p.ayar = a;
  }
  if (gunler) {
    for (const [g, tip] of Object.entries(gunler)) {
      if (!(g in p.gunler)) throw new Error(`${g} bu döneme ait değil.`);
      if (!GUN_TIPLERI.includes(tip)) throw new Error(`Geçersiz gün tipi: ${tip}`);
      p.gunler[g] = tip;
    }
  }
  db.yaz();
}

/** Dönem açıldıktan sonra işe giren biri: o anki hâliyle eklenir. */
export function satirEkle(donem, personelKod) {
  const p = al(donem);
  acikOlmali(p);
  if (p.satirlar.some((s) => s.personelKod === personelKod)) throw new Error(`${personelKod} bu dönemde zaten var.`);
  const kisi = db.satirBul("personel", (x) => x.kod === personelKod);
  if (!kisi) throw new Error(`${personelKod} bulunamadı.`);
  if (kisi.ekip && !p.ekipler[kisi.ekip]) {
    const e = db.satirBul("ekip", (x) => x.kod === kisi.ekip);
    if (e) p.ekipler[e.kod] = ekipKopyasi(e);
  }
  p.satirlar.push(satirKopyasi(kisi));
  p.satirlar.sort(ekipSirasi);
  db.yaz();
}

export function satirCikar(donem, personelKod) {
  const p = al(donem);
  acikOlmali(p);
  const s = satirAl(p, personelKod);
  if (Object.keys(s.hucre).length) throw new Error(`${s.ad} için girilmiş saatler var. Önce satırı temizleyin.`);
  p.satirlar = p.satirlar.filter((x) => x !== s);
  db.yaz();
}

export function durumYaz(donem, durum, ek = {}) {
  const p = al(donem);
  p.durum = durum;
  if (durum === "kapali") p.kapanis = { tarih: new Date().toISOString(), kullanici: db.ayarlar().kullanici, ...ek };
  else delete p.kapanis;
  db.yaz();
  return p;
}

/* ------------------------------------------------------------------ */
/* Hesap                                                               */
/* ------------------------------------------------------------------ */

/** Ayın iş günü: bu dönemin normal günleri + aynı ayın diğer yarısının normal günleri. */
function ayIsGunu(p) {
  const d = donemCoz(p.donem);
  const kardes = `${d.yil}-${pad(d.ay)}-${d.yari === 1 ? 2 : 1}`;
  const kp = bul(kardes);
  const say = (gunler, tipi) => gunler.filter((g) => tipi(g) === "normal").length;
  return say(d.gunler, (g) => p.gunler[g] || varsayilanGunTipi(g))
    + say(donemCoz(kardes).gunler, (g) => kp?.gunler[g] || varsayilanGunTipi(g));
}

function avanslar(personelKod, gunler) {
  const bas = gunler[0], bit = gunler[gunler.length - 1];
  return db.tablo("avans").filter((a) => a.personelKod === personelKod && a.tarih >= bas && a.tarih <= bit);
}

/** Bir satırın tüm hesabı. Döner: saatler, para tutarları ve gün gün dağılım. */
export function satirHesapla(p, s, baglam = {}) {
  return (p.kural || 1) >= 2 ? satirHesaplaK2(p, s, baglam) : satirHesaplaK1(p, s, baglam);
}

/** Kural 1 (ilk sürüm): eksik saat × saat değeri kesilir, mesai = saat değeri × çarpan. Eski dönemler böyle kalır. */
function satirHesaplaK1(p, s, baglam = {}) {
  const a = { ...VARSAYILAN_AYAR, ...p.ayar };
  const ns = sayi(a.normalSaat) || 8;
  const c = sayi(a.mesaiCarpani) || 1.5;
  const gunler = donemCoz(p.donem).gunler;
  const bugun = baglam.bugun || bugunMetni();
  const kapali = p.durum === "kapali";

  let normal = 0, mesai = 0, eksik = 0, calisilanGun = 0, izin = 0, rapor = 0, gelmedi = 0, normalGun = 0;
  const yemek = {};
  const gunluk = [];

  for (const g of gunler) {
    const tip = p.gunler[g] || "normal";
    const v = s.hucre[g] || "";
    const ekip = s.ekipGun[g] || s.ekip;
    const saat = /^\d/.test(v) ? Number(v) : 0;
    if (tip === "normal") normalGun += 1;

    let n = 0, m = 0;
    if (tip === "normal") {
      if (a.haftaIciAsim) { n = Math.min(saat, ns); m = saat - n; } else n = saat;
    } else if (tip === "mesai") m = saat;
    else if (a.tatilMesai) m = saat; else n = saat;
    normal += n; mesai += m;

    let gunYemek = 0;
    if (saat > 0) {
      calisilanGun += 1;
      const e = p.ekipler[ekip];
      if (e?.yemekGunluk) { gunYemek = e.yemekGunluk; topla(yemek, e.yemekPB, gunYemek); }
    }
    if (v === "İ") izin += 1;
    else if (v === "R") rapor += 1;
    else if (v === "–") gelmedi += 1;

    // Eksik saat: normal günde beklenenin altında kalan kısım. İzin ve rapor eksik sayılmaz.
    // Boş hücre sadece günü geçmişse (ya da dönem kapandıysa) eksik sayılır.
    let gunEksik = 0;
    if (tip === "normal" && v !== "İ" && v !== "R" && (v !== "" || kapali || g <= bugun)) {
      gunEksik = Math.max(0, ns - saat);
      eksik += gunEksik;
    }
    gunluk.push({ gun: g, ekip, n, m, eksik: gunEksik, yemek: gunYemek });
  }

  // Ücret
  const u = sayi(s.ucret);
  let hakedis = 0, kesinti = 0, saatDegeri = 0, tabanUcret = 0;
  if (s.odemeTuru === "Saatlik") {
    saatDegeri = u;
    tabanUcret = normal * u;
    hakedis = tabanUcret + mesai * u * c;
  } else if (s.odemeTuru === "Aylık") {
    const isGunu = baglam.ayIsGunu ?? ayIsGunu(p);
    saatDegeri = isGunu ? u / (isGunu * ns) : 0;
    const yarim = u / 2;
    kesinti = Math.min(yarim, eksik * saatDegeri);
    tabanUcret = yarim - kesinti;
    hakedis = tabanUcret + mesai * saatDegeri * c;
  }
  const pb = s.paraBirimi || "EUR";

  const avansKayitlari = avanslar(s.personelKod, gunler);
  const avans = {};
  for (const k of avansKayitlari) topla(avans, k.paraBirimi || "EUR", sayi(k.tutar));
  const net = { [pb]: yuvarla(hakedis - (avans[pb] || 0)) };
  const baskaPB = Object.keys(avans).filter((k) => k !== pb);

  return {
    personelKod: s.personelKod, kural: 1,
    toplam: yuvarla(normal + mesai), normal: yuvarla(normal), mesai: yuvarla(mesai), eksik: yuvarla(eksik),
    calisilanGun, izin, rapor, gelmedi, normalGun,
    paraBirimi: pb, saatDegeri: yuvarla(saatDegeri), carpan: c,
    mesaiBirim: saatDegeri * c, mesaiTutar: yuvarla(mesai * saatDegeri * c),
    tabanUcret: yuvarla(tabanUcret), tabanNet: yuvarla(tabanUcret), kesinti: yuvarla(kesinti), hakedis: yuvarla(hakedis),
    kesintiDetay: { maas: 0, eksikSaat: yuvarla(kesinti), kira: 0, yemek: 0 }, kesintiDisi: {},
    avans, avansDusulen: avans[pb] || 0, avansSayisi: avansKayitlari.length, net,
    uyari: [
      !s.odemeTuru || !u ? "Maaş bilgisi yok; hakediş hesaplanmadı." : "",
      baskaPB.length ? `Avans farklı para biriminde (${baskaPB.join(", ")}); maaştan düşülmedi.` : "",
    ].filter(Boolean),
    yemek, kira: s.kiraPayi ? { [s.kiraPB || "EUR"]: s.kiraPayi } : {},
    gunluk,
  };
}

/**
 * Kural 2 ve 3: sabit mesai ücreti, sadece "gelmedi" günleri kesinti, kira ve yemek günlük.
 * hakedis brüttür; net = hakedis − kesinti − avans. Kesintiler maaşın para birimindeyse maaştan düşer.
 * Farklı para birimindeki kira/yemek/avans: kural 3'te dönemin kuruyla çevrilip düşülür; kural 2'de ya da kur yoksa
 * kesintiDisi'nde gösterilir ve düşülmez. kesintiKalem: ekranda gösterilen formül dökümü.
 */
function satirHesaplaK2(p, s, baglam = {}) {
  const a = { ...VARSAYILAN_AYAR, ...KURAL2_AYAR, ...p.ayar };
  const ns = sayi(a.normalSaat) || 8;
  const c = sayi(a.mesaiCarpani) || 1.5;
  const gunler = donemCoz(p.donem).gunler;
  const pb = s.paraBirimi || "EUR";
  const u = sayi(s.ucret);
  const aylik = s.odemeTuru === "Aylık", saatlik = s.odemeTuru === "Saatlik";
  const gunlukMaas = aylik ? u * 12 / 365 : 0;
  const kiraGunluk = s.kiraGunluk !== undefined ? sayi(s.kiraGunluk) : (s.kiraPayi ? s.kiraPayi * 2 * 12 / 365 : 0);
  const kiraPB = s.kiraPB || "EUR";

  let normal = 0, mesai = 0, eksik = 0, kismiEksik = 0, calisilanGun = 0, izin = 0, rapor = 0, gelmedi = 0, normalGun = 0, isteGun = 0;
  const yemek = {}, kira = {};
  const kes = { maas: 0, eksikSaat: 0, kira: {}, yemek: {} };
  const ham = { kira: {}, yemek: {} };   // yuvarlanmamış kesinti (kural 3 dökümü bununla hesaplanır)
  const hamEkle = (t, pb, v) => { t[pb || "EUR"] = (t[pb || "EUR"] || 0) + v; };
  const yemekGun = {};   // "PB|günlük tutar" → gelmedi gün sayısı (döküm için)
  const gunluk = [];

  for (const g of gunler) {
    const tip = p.gunler[g] || "normal";
    const ekip = s.ekipGun[g] || s.ekip;
    // İşe girişten önceki ve çalışma dönemi dışındaki günler hiçbir hesaba girmez.
    const disi = gunDisi(s, g);
    if (disi) { gunluk.push({ gun: g, ekip, n: 0, m: 0, eksik: 0, yemek: 0, [disi]: true }); continue; }
    isteGun += 1;
    const v = s.hucre[g] || "";
    const saat = /^\d/.test(v) ? Number(v) : 0;
    if (tip === "normal") normalGun += 1;

    let n = 0, m = 0;
    if (tip === "normal") {
      if (a.haftaIciAsim) { n = Math.min(saat, ns); m = saat - n; } else n = saat;
    } else if (tip === "mesai") m = saat;
    else if (a.tatilMesai) m = saat; else n = saat;
    normal += n; mesai += m;
    if (saat > 0) calisilanGun += 1;

    // Yemek parası dönemin her günü için önden verilir; kira payı her gün işler.
    const e = p.ekipler[ekip];
    const gunYemek = e?.yemekGunluk || 0;
    if (gunYemek) topla(yemek, e.yemekPB, gunYemek);
    if (kiraGunluk) topla(kira, kiraPB, kiraGunluk);

    // Kesinti sadece "–" (gelmedi) gününde. Boş hücre kesinti doğurmaz.
    let gunEksik = 0;
    if (v === "İ") izin += 1;
    else if (v === "R") rapor += 1;
    else if (v === "–") {
      gelmedi += 1;
      if (tip === "normal") gunEksik = ns;
      kes.maas += gunlukMaas;
      if (kiraGunluk) { topla(kes.kira, kiraPB, kiraGunluk); hamEkle(ham.kira, kiraPB, kiraGunluk); }
      if (gunYemek) {
        topla(kes.yemek, e.yemekPB, gunYemek);
        hamEkle(ham.yemek, e.yemekPB, gunYemek);
        const yk = `${e.yemekPB || "EUR"}|${gunYemek}`;
        yemekGun[yk] = (yemekGun[yk] || 0) + 1;
      }
    } else if (tip === "normal" && saat > 0 && saat < ns) {
      gunEksik = ns - saat;      // girilmiş ama eksik kalan saat: bilgi, ayar açıksa kesilir
      kismiEksik += gunEksik;
    }
    eksik += gunEksik;
    gunluk.push({ gun: g, ekip, n, m, eksik: gunEksik, yemek: gunYemek, gelmedi: v === "–" });
  }

  // Taban ücret: saatlikte normal saat × ücret; aylıkta yarım maaş, dönemin bir kısmında işteyse günlük maaş × gün.
  const isGunu = baglam.ayIsGunu ?? ayIsGunu(p);
  const saatDegeri = saatlik ? u : aylik && isGunu ? u / (isGunu * ns) : 0;
  const kismi = isteGun < gunler.length;
  const tabanUcret = saatlik ? normal * u : aylik ? (kismi ? gunlukMaas * isteGun : u / 2) : 0;
  if (aylik && a.eksikSaatKesinti) kes.eksikSaat = kismiEksik * saatDegeri;
  // Maaş kesintisi (gelmedi + eksik saat) taban ücreti aşamaz.
  kes.eksikSaat = Math.min(kes.eksikSaat, tabanUcret);
  kes.maas = Math.min(kes.maas, tabanUcret - kes.eksikSaat);

  // Mesai: sabit ücret (kişiye özel, yoksa dönemin para birimi ücreti) ya da saat değeri × çarpan.
  const kisiye = sayi(s.mesaiUcreti);
  const mesaiBirim = a.mesaiModu === "carpan" ? saatDegeri * c : (kisiye || sayi(a.mesaiUcreti?.[pb]));
  const mesaiTutar = mesai * mesaiBirim;
  const hakedis = tabanUcret + mesaiTutar;

  // Kesinti dökümü: her kalem formülüyle. Maaşın para biriminde olmayanlar kural 3'te dönemin kuruyla çevrilir.
  const k3 = (p.kural || 1) >= 3;
  const kur = k3 ? a.kur || null : null;
  // Kural 2 rakamları değişmesin diye günlük yuvarlanmış toplam; kural 3'te formülle birebir tutan yuvarlanmamış toplam.
  const kk = k3 ? ham : kes;
  const kalemler = [], kesintiDisi = {};
  const kalemEkle = (tur, ad, formul, tutar, kpb) => {
    if (!tutar) return;
    if (kpb === pb) { kalemler.push({ tur, ad, formul, tutar: yuvarla(tutar), pb }); return; }
    const c = kur ? cevir(tutar, kpb, pb, kur) : null;
    if (c === null) {
      kesintiDisi[`${tur} ${kpb}`] = yuvarla(tutar);
      kalemler.push({ tur, ad, formul, tutar: yuvarla(tutar), pb: kpb, dusulmedi: kur ? `${kpb} kuru girilmemiş` : "farklı para birimi" });
    } else {
      kalemler.push({ tur, ad, formul: `${formul} ${cevirmeMetni(kpb, pb, kur)}`, tutar: yuvarla(c), pb, kaynak: { tutar: yuvarla(tutar), pb: kpb } });
    }
  };
  if (kes.maas) {
    const sinirli = yuvarla(kes.maas) < yuvarla(gunlukMaas * gelmedi);
    kalemEkle("maas", "Günlük maaş", `${gelmedi} gün × ${trs(u)} ${pb} × 12 ÷ 365${sinirli ? " (taban ücretle sınırlı)" : ""}`, kes.maas, pb);
  }
  if (kes.eksikSaat) kalemEkle("eksikSaat", "Eksik saat", `${trs(kismiEksik)} saat × ${trs(saatDegeri)} ${pb}`, kes.eksikSaat, pb);
  if (Object.keys(kk.kira).length) {
    const ev = s.ev ? evlerAnlik(p)[s.ev] : null;
    const F = KIRA_F[ev?.kiraPeriyodu] || 12;
    const kisi = ev && kiraGunluk ? ev.kira * F / 365 / kiraGunluk : 0;
    const kiraFormul = ev && (ev.paraBirimi || "EUR") === kiraPB && kisi >= 0.99 && Math.abs(kisi - Math.round(kisi)) < 0.01
      ? `${trs(ev.kira)} ${kiraPB}${F === 365 ? "" : ` × ${F} ÷ 365`} ÷ ${Math.round(kisi)} kişi`
      : `${trs(kiraGunluk, 4)} ${kiraPB}/gün`;
    for (const [kpb, v] of Object.entries(kk.kira)) kalemEkle("kira", "Kira payı", `${gelmedi} gün × ${kiraFormul}`, v, kpb);
  }
  for (const [kpb, v] of Object.entries(kk.yemek)) {
    const parca = Object.entries(yemekGun).filter(([k]) => k.split("|")[0] === kpb)
      .map(([k, n]) => `${n} gün × ${trs(Number(k.split("|")[1]))} ${kpb}`);
    kalemEkle("yemek", "Yemek", parca.length > 1 ? `(${parca.join(" + ")})` : parca[0] || `${kpb}`, v, kpb);
  }
  const dusen = (tur) => yuvarla(kalemler.filter((k) => k.tur === tur && !k.dusulmedi).reduce((t, k) => t + k.tutar, 0));
  const kesintiDetay = { maas: dusen("maas"), eksikSaat: dusen("eksikSaat"), kira: dusen("kira"), yemek: dusen("yemek") };
  const kesinti = kesintiDetay.maas + kesintiDetay.eksikSaat + kesintiDetay.kira + kesintiDetay.yemek;

  const avansKayitlari = avanslar(s.personelKod, gunler);
  const avans = {};
  for (const k of avansKayitlari) topla(avans, k.paraBirimi || "EUR", sayi(k.tutar));
  // Farklı para birimindeki avans: kural 3'te kurla çevrilip düşülür.
  let avansDusulen = avans[pb] || 0;
  const baskaPB = [], avansCevrilen = [];
  for (const [k, v] of Object.entries(avans)) {
    if (k === pb) continue;
    const c = kur ? cevir(v, k, pb, kur) : null;
    if (c === null) baskaPB.push(k);
    else { avansDusulen += c; avansCevrilen.push({ tutar: v, pb: k, cevrilen: yuvarla(c), formul: `${trs(v)} ${k} ${cevirmeMetni(k, pb, kur)}` }); }
  }
  avansDusulen = yuvarla(avansDusulen);
  const net = { [pb]: yuvarla(hakedis - kesinti - avansDusulen) };

  return {
    personelKod: s.personelKod, kural: k3 ? 3 : 2,
    toplam: yuvarla(normal + mesai), normal: yuvarla(normal), mesai: yuvarla(mesai), eksik: yuvarla(eksik),
    calisilanGun, izin, rapor, gelmedi, normalGun, isteGun,
    paraBirimi: pb, saatDegeri: yuvarla(saatDegeri), carpan: c,
    mesaiModu: a.mesaiModu, mesaiBirim: yuvarla(mesaiBirim), mesaiTutar: yuvarla(mesaiTutar),
    gunlukMaas: yuvarla(gunlukMaas), kiraGunluk: yuvarla(kiraGunluk),
    tabanUcret: yuvarla(tabanUcret), tabanNet: yuvarla(tabanUcret - kes.maas - kes.eksikSaat),
    hakedis: yuvarla(hakedis), kesinti: yuvarla(kesinti), kesintiDetay, kesintiDisi, kesintiKalem: kalemler,
    kur: kur || null,
    avans, avansDusulen, avansCevrilen, avansSayisi: avansKayitlari.length, net,
    uyari: [
      !s.odemeTuru || !u ? "Maaş bilgisi yok; hakediş hesaplanmadı." : "",
      mesai > 0 && !mesaiBirim ? `Mesai ücreti girilmemiş (${pb}); ${yuvarla(mesai)} saat mesai ödenmedi.` : "",
      baskaPB.length ? `Avans farklı para biriminde (${baskaPB.join(", ")}); maaştan düşülmedi.` : "",
      Object.keys(kesintiDisi).length
        ? `Kesinti farklı para biriminde (${Object.entries(kesintiDisi).map(([k, v]) => `${k} ${v}`).join(", ")}); ${kur ? "kuru girilmediği için " : ""}maaştan düşülmedi.` : "",
    ].filter(Boolean),
    yemek, kira,
    gunluk,
  };
}

/** Dönemin tüm satırları + özet istatistikler. */
export function hesapla(p) {
  const ayIs = ayIsGunu(p);
  const bugun = bugunMetni();
  const satirlar = p.satirlar.map((s) => satirHesapla(p, s, { ayIsGunu: ayIs, bugun }));

  // 2. yarıda ay sonu ödemesi: iki dönemin neti toplamı.
  const d = donemCoz(p.donem);
  if (d.yari === 2) {
    const ilk = bul(`${d.yil}-${pad(d.ay)}-1`);
    const ilkAyIs = ilk ? ayIsGunu(ilk) : 0;
    for (const h of satirlar) {
      const s1 = ilk?.satirlar.find((x) => x.personelKod === h.personelKod);
      const h1 = s1 ? satirHesapla(ilk, s1, { ayIsGunu: ilkAyIs, bugun }) : null;
      h.aySonu = birlestir({ ...h.net }, h1?.net);
      h.ilkYariNet = h1?.net || null;
    }
  }

  const ozet = {
    kisi: satirlar.length,
    ekip: new Set(p.satirlar.flatMap((s) => [s.ekip, ...Object.values(s.ekipGun)]).filter(Boolean)).size,
    toplamSaat: 0, normal: 0, mesai: 0, eksik: 0, izin: 0, rapor: 0, gelmedi: 0, calisilanGun: 0,
    hakedis: {}, kesinti: {}, avans: {}, net: {}, aySonu: {}, yemek: {}, kira: {},
    kesintiMaas: {}, kesintiKira: {}, kesintiYemek: {}, mesaiTutar: {},
    maassiz: 0, kural: p.kural || 1,
  };
  satirlar.forEach((h) => {
    ozet.toplamSaat += h.toplam; ozet.normal += h.normal; ozet.mesai += h.mesai; ozet.eksik += h.eksik;
    ozet.izin += h.izin; ozet.rapor += h.rapor; ozet.gelmedi += h.gelmedi; ozet.calisilanGun += h.calisilanGun;
    topla(ozet.hakedis, h.paraBirimi, h.hakedis);
    topla(ozet.kesinti, h.paraBirimi, h.kesinti);
    topla(ozet.kesintiMaas, h.paraBirimi, h.kesintiDetay.maas + h.kesintiDetay.eksikSaat);
    topla(ozet.kesintiKira, h.paraBirimi, h.kesintiDetay.kira);
    topla(ozet.kesintiYemek, h.paraBirimi, h.kesintiDetay.yemek);
    topla(ozet.mesaiTutar, h.paraBirimi, h.mesaiTutar);
    birlestir(ozet.avans, h.avans);
    birlestir(ozet.net, h.net);
    if (h.aySonu) birlestir(ozet.aySonu, h.aySonu);
    birlestir(ozet.yemek, h.yemek);
    birlestir(ozet.kira, h.kira);
    if (h.uyari.some((x) => x.startsWith("Maaş"))) ozet.maassiz += 1;
  });
  for (const k of ["toplamSaat", "normal", "mesai", "eksik"]) ozet[k] = yuvarla(ozet[k]);

  // Ekip bazında yemek ve kişi-gün (istatistik panelinde gösterilir).
  const ekipOzet = {};
  satirlar.forEach((h) => {
    for (const g of h.gunluk) {
      if (!g.ekip || !(g.n + g.m || g.yemek)) continue;
      const e = (ekipOzet[g.ekip] ||= { kod: g.ekip, ad: p.ekipler[g.ekip]?.ad || g.ekip, kisiGun: 0, saat: 0, yemek: {} });
      if (g.n + g.m) { e.kisiGun += 1; e.saat = yuvarla(e.saat + g.n + g.m); }
      if (g.yemek) topla(e.yemek, p.ekipler[g.ekip]?.yemekPB, g.yemek);
    }
  });

  return { satirlar: satirlar.map(({ gunluk, ...h }) => h), ozet, ekipOzet: Object.values(ekipOzet), ayIsGunu: ayIs };
}

/* ------------------------------------------------------------------ */
/* İstatistik: çalışan ve proje bazında, birden çok dönem              */
/* ------------------------------------------------------------------ */

/** Bir satırın tutarlarını günlerin ekibine göre projelere dağıtır. */
function projeyeDagit(p, s, h, hedef) {
  const ekle = (proje, alan, pb, tutar) => {
    const k = proje || "—";
    const r = (hedef[k] ||= { proje: k, kisiler: new Set(), saat: 0, normal: 0, mesai: 0, eksik: 0, hakedis: {}, yemek: {}, kira: {} });
    if (alan === "kisi") { r.kisiler.add(s.personelKod); return; }
    if (typeof r[alan] === "number") r[alan] = yuvarla(r[alan] + tutar);
    else topla(r[alan], pb, tutar);
  };
  const toplamNormal = h.gunluk.reduce((a, g) => a + g.n, 0);
  for (const g of h.gunluk) {
    const proje = p.ekipler[g.ekip]?.proje || s.proje;
    if (g.n + g.m > 0) ekle(proje, "kisi");
    ekle(proje, "saat", null, g.n + g.m);
    ekle(proje, "normal", null, g.n);
    ekle(proje, "mesai", null, g.m);
    ekle(proje, "eksik", null, g.eksik);
    if (g.yemek) ekle(proje, "yemek", p.ekipler[g.ekip]?.yemekPB, g.yemek);
    // Mesai ücreti günün projesine; taban ücret normal saat payına göre.
    ekle(proje, "hakedis", h.paraBirimi, g.m * h.mesaiBirim);
    if (toplamNormal) ekle(proje, "hakedis", h.paraBirimi, h.tabanNet * (g.n / toplamNormal));
  }
  if (!toplamNormal && h.tabanNet) ekle(s.proje, "hakedis", h.paraBirimi, h.tabanNet);
  for (const [pb, t] of Object.entries(h.kira)) ekle(s.proje, "kira", pb, t);
}

export function istatistik(bas, bit) {
  const donemler = tumDonemler().filter((p) => (!bas || p.donem >= bas) && (!bit || p.donem <= bit));
  const kisiler = {}, projeler = {};
  const bugun = bugunMetni();

  for (const p of donemler) {
    const ayIs = ayIsGunu(p);
    for (const s of p.satirlar) {
      const h = satirHesapla(p, s, { ayIsGunu: ayIs, bugun });
      const k = (kisiler[s.personelKod] ||= {
        personelKod: s.personelKod, ad: s.ad, donem: 0,
        saat: 0, normal: 0, mesai: 0, eksik: 0, izin: 0, rapor: 0, gelmedi: 0, calisilanGun: 0,
        hakedis: {}, kesinti: {}, avans: {}, net: {}, yemek: {}, kira: {}, projeler: new Set(),
        kesintiMaas: {}, kesintiKira: {}, kesintiYemek: {},
      });
      k.donem += 1;
      k.saat = yuvarla(k.saat + h.toplam); k.normal = yuvarla(k.normal + h.normal);
      k.mesai = yuvarla(k.mesai + h.mesai); k.eksik = yuvarla(k.eksik + h.eksik);
      k.izin += h.izin; k.rapor += h.rapor; k.gelmedi += h.gelmedi; k.calisilanGun += h.calisilanGun;
      topla(k.hakedis, h.paraBirimi, h.hakedis); topla(k.kesinti, h.paraBirimi, h.kesinti);
      topla(k.kesintiMaas, h.paraBirimi, h.kesintiDetay.maas + h.kesintiDetay.eksikSaat);
      topla(k.kesintiKira, h.paraBirimi, h.kesintiDetay.kira); topla(k.kesintiYemek, h.paraBirimi, h.kesintiDetay.yemek);
      birlestir(k.avans, h.avans); birlestir(k.net, h.net);
      birlestir(k.yemek, h.yemek); birlestir(k.kira, h.kira);
      for (const g of h.gunluk) { const pr = p.ekipler[g.ekip]?.proje || s.proje; if (pr && g.n + g.m) k.projeler.add(pr); }
      projeyeDagit(p, s, h, projeler);
    }
  }

  const projeAdi = (kod) => db.satirBul("proje", (x) => x.kod === kod)?.ad || (kod === "—" ? "Projesiz" : kod);
  const personelId = (kod) => db.satirBul("personel", (x) => x.kod === kod)?._id || null;
  return {
    donemler: donemler.map((p) => ({ donem: p.donem, ad: donemAdi(p.donem), durum: p.durum })),
    kisiler: Object.values(kisiler).map((k) => ({ ...k, _id: personelId(k.personelKod), projeler: [...k.projeler].map((x) => ({ kod: x, ad: projeAdi(x) })) }))
      .sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
    projeler: Object.values(projeler)
      .filter((r) => r.saat || Object.keys(r.hakedis).length || Object.keys(r.kira).length)
      .map((r) => ({ ...r, ad: projeAdi(r.proje), kisi: r.kisiler.size, kisiler: undefined }))
      .sort((a, b) => b.saat - a.saat),
  };
}

/** Personel kartı için dönem dönem döküm. */
export function personelDokumu(personelKod) {
  const out = [];
  for (const p of tumDonemler()) {
    const s = p.satirlar.find((x) => x.personelKod === personelKod);
    if (!s) continue;
    const { gunluk, ...h } = satirHesapla(p, s);
    out.push({
      donem: p.donem, ad: donemAdi(p.donem), durum: p.durum, ekip: s.ekip, odemeTuru: s.odemeTuru, ucret: s.ucret, ...h,
      gelmediGunler: gunluk.filter((g) => g.gelmedi).map((g) => g.gun),
    });
  }
  return out.reverse();
}
