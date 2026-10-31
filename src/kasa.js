/**
 * Kasa: gelir ve giderler, otomatik satırlar ve raporlar.
 *
 * Otomatik satırlar her eşitlemede kaynağından yeniden üretilir:
 *   Avans → her avans kaydı, kendi tarihinde gider.
 *   Ödeme → Ödemeler ekranında "ödendi" işaretlenen maaş, yemek parası ve kira; ödeme tarihinde, ödenen tutarla.
 *           Kira evde kalanların projelerine bölünür. (Ekim 2026'dan önce dönem kapanınca kendiliğinden yazılıyordu;
 *           müşteri kararıyla artık sadece ödendi işaretiyle düşer.)
 * Avans zaten ayrı bir gider olduğu için maaş ödemesi avans düşülmüş tutardır; ikisinin toplamı hakedişe eşittir.
 *
 * Kurallar:
 *  - Elle düzeltilen otomatik satır bir daha ezilmez. Sistemin hesabı `sistem` alanında yanında saklanır.
 *  - Elle silinen otomatik satır bir daha üretilmez (kasaSilinen). Kasa ekranından geri getirilebilir.
 *  - Kaynağı ortadan kalkan otomatik satır (dönem yeniden açıldı, avans silindi) silinir.
 *    Elle düzeltilmişse durur ve "kaynağı silindi" diye işaretlenir.
 */
import * as db from "./db.js";
import * as puantaj from "./puantaj.js";
import * as odeme from "./odeme.js";
import { kisininProjesi, sayi } from "./iliskiler.js";

const pad = (n) => String(n).padStart(2, "0");
const yuvarla = (n) => Math.round(n * 100) / 100;
const { AYLAR } = puantaj;

function topla(hedef, pb, tutar) {
  if (!tutar) return;
  const k = pb || "EUR";
  hedef[k] = yuvarla((hedef[k] || 0) + tutar);
}
const fark = (a, b) => {
  const out = {};
  for (const pb of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const v = yuvarla((a[pb] || 0) - (b[pb] || 0));
    if (v) out[pb] = v;
  }
  return out;
};
const sonGun = (yil, ay) => new Date(Date.UTC(yil, ay, 0)).getUTCDate();

/** Elle değiştirildiğinde satırı "elle düzeltildi" yapan alanlar. */
const DEGER_ALANLARI = ["tarih", "tur", "kategori", "aciklama", "proje", "personelKod", "tutar", "paraBirimi"];

export function elleDegistiMi(eski, yeni) {
  return DEGER_ALANLARI.some((k) => (k === "tutar"
    ? sayi(eski[k]) !== sayi(yeni[k])
    : String(eski[k] ?? "") !== String(yeni[k] ?? "")));
}

const otomatikMi = (r) => Boolean(r.anahtar);

/* ------------------------------------------------------------------ */
/* Otomatik satırlar                                                   */
/* ------------------------------------------------------------------ */

const personelAdi = (kod) => db.satirBul("personel", (x) => x.kod === kod)?.ad || kod;

/** Avansın projesi: dönem açıksa puantajdaki o günün ekibinden, değilse kişinin bugünkü projesinden. */
function avansProjesi(a, mevcut) {
  const p = puantaj.bul(puantaj.tarihDonemi(a.tarih));
  const s = p?.satirlar.find((x) => x.personelKod === a.personelKod);
  if (s) return p.ekipler[s.ekipGun[a.tarih]]?.proje || s.proje || "";
  // Dönem açılmadan önce yazılmış satırın projesi korunur (kişi sonradan başka projeye geçmiş olabilir).
  if (mevcut?.sistem && mevcut.sistem.personelKod === a.personelKod) return mevcut.sistem.proje || "";
  const kisi = db.satirBul("personel", (x) => x.kod === a.personelKod);
  return kisi ? kisininProjesi(kisi) : "";
}

/** Kaynaklardan olması gereken otomatik satırlar: anahtar → satır. */
function hedefSatirlar(mevcut) {
  const out = new Map();
  const ekle = (anahtar, s) => {
    if (!(sayi(s.tutar) > 0)) return;
    out.set(anahtar, { tur: "Gider", personelKod: "", proje: "", ...s, tutar: yuvarla(s.tutar) });
  };

  for (const a of db.tablo("avans")) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.tarih || "")) continue;
    const anahtar = `avans:${a._id}`;
    ekle(anahtar, {
      tarih: a.tarih, kategori: "Avans", kaynak: "Avans",
      aciklama: `Avans — ${personelAdi(a.personelKod)}${a.aciklama ? ` · ${a.aciklama}` : ""}`,
      personelKod: a.personelKod, proje: avansProjesi(a, mevcut.get(anahtar)),
      tutar: sayi(a.tutar), paraBirimi: a.paraBirimi || "EUR",
    });
  }

  // Maaş, yemek ve kira: Ödemeler ekranında "ödendi" işaretlenen kalemler, ödeme tarihinde gider.
  for (const r of odeme.kasaSatirlari()) ekle(r.anahtar, r);
  return out;
}

/** Otomatik satırları kaynaklarıyla eşitler. Döner: { eklenen, guncellenen, silinen } */
export function esitle() {
  const kasa = db.tablo("kasa");
  const mevcut = new Map(kasa.filter(otomatikMi).map((r) => [r.anahtar, r]));
  const hedef = hedefSatirlar(mevcut);
  const silinmis = new Set(db.tablo("kasaSilinen").map((x) => x.anahtar));
  const rapor = { eklenen: 0, guncellenen: 0, silinen: 0 };
  let degisti = false;
  const simdi = new Date().toISOString();

  for (const r of [...kasa]) {
    if (!otomatikMi(r) || (hedef.has(r.anahtar) && !silinmis.has(r.anahtar))) continue;
    if (r.elleDuzeltildi) {
      if (!r.sistem?.silindi) { r.sistem = { ...(r.sistem || {}), silindi: true }; degisti = true; }
      continue;
    }
    kasa.splice(kasa.indexOf(r), 1);
    rapor.silinen += 1; degisti = true;
  }

  for (const [anahtar, h] of hedef) {
    if (silinmis.has(anahtar)) continue;
    const sistem = { tarih: h.tarih, tutar: h.tutar, paraBirimi: h.paraBirimi, proje: h.proje, personelKod: h.personelKod };
    const r = mevcut.get(anahtar);
    if (!r) {
      kasa.push({ _id: db.yeniId(), _olusturma: simdi, ...h, tekrar: "Hayır", anahtar, elleDuzeltildi: false, sistem });
      rapor.eklenen += 1; degisti = true;
    } else if (r.elleDuzeltildi) {
      if (JSON.stringify(r.sistem) !== JSON.stringify(sistem)) { r.sistem = sistem; degisti = true; }
    } else if (elleDegistiMi(r, h) || r.kaynak !== h.kaynak || JSON.stringify(r.sistem) !== JSON.stringify(sistem)) {
      Object.assign(r, h, { sistem, _guncelleme: simdi });
      rapor.guncellenen += 1; degisti = true;
    }
  }
  if (degisti) db.yaz();
  return rapor;
}

/** Otomatik satır elle silinirken: sistem bir daha üretmesin diye işaret bırakılır. */
export function silinirken(r) {
  if (!otomatikMi(r)) return null;
  db.tablo("kasaSilinen").push({
    anahtar: r.anahtar, tarih: r.tarih, aciklama: r.aciklama, tutar: r.tutar, paraBirimi: r.paraBirimi,
    silmeTarihi: new Date().toISOString(), kullanici: db.ayarlar().kullanici,
  });
  return "Otomatik satır silindi; sistem bunu bir daha yazmayacak. Kasa ekranından geri getirebilirsiniz.";
}

/** Bir ayda elle silinmiş otomatik satırları geri getirir. */
export function geriGetir(ayKodu) {
  const liste = db.tablo("kasaSilinen");
  const kalan = liste.filter((x) => !String(x.tarih || "").startsWith(ayKodu));
  const sayi = liste.length - kalan.length;
  liste.splice(0, liste.length, ...kalan);
  db.yaz();
  return { geriGelen: sayi, ...esitle() };
}

/** Elle düzeltilen otomatik satırı sistemin hesabına geri bırakır. */
export function sistemeBirak(id) {
  const r = db.satirBul("kasa", (x) => x._id === id);
  if (!r) throw new Error("Kasa satırı bulunamadı.");
  if (!otomatikMi(r)) throw new Error("Bu satır elle girilmiş; sistemin hesabı yok.");
  r.elleDuzeltildi = false;
  db.yaz();
  return esitle();
}

/* ------------------------------------------------------------------ */
/* Özet ve raporlar                                                    */
/* ------------------------------------------------------------------ */

const projeAdi = (kod) => (kod ? db.satirBul("proje", (x) => x.kod === kod)?.ad || kod : "Projesiz");

/** [bas, bit] aralığındaki satırların özeti; devir, bas'tan önceki tüm satırların netidir. */
function ozetle(satirlar, bas, bit) {
  const devir = {}, gelir = {}, gider = {};
  const kategori = new Map(), proje = new Map();
  let adet = 0;
  for (const r of satirlar) {
    const t = r.tarih || "";
    const tutar = sayi(r.tutar), pb = r.paraBirimi || "EUR";
    const isaret = r.tur === "Gelir" ? 1 : -1;
    if (t < bas) { topla(devir, pb, isaret * tutar); continue; }
    if (t > bit) continue;
    adet += 1;
    topla(r.tur === "Gelir" ? gelir : gider, pb, tutar);
    const kk = `${r.tur}|${r.kategori || "Kategorisiz"}`;
    if (!kategori.has(kk)) kategori.set(kk, { tur: r.tur, kategori: r.kategori || "Kategorisiz", tutar: {} });
    topla(kategori.get(kk).tutar, pb, tutar);
    const pk = r.proje || "";
    if (!proje.has(pk)) proje.set(pk, { proje: pk, ad: projeAdi(pk), gelir: {}, gider: {} });
    topla(proje.get(pk)[r.tur === "Gelir" ? "gelir" : "gider"], pb, tutar);
  }
  const net = fark(gelir, gider);
  const bakiye = { ...devir };
  for (const [pb, v] of Object.entries(net)) topla(bakiye, pb, v);
  for (const pb of Object.keys(bakiye)) if (!bakiye[pb]) delete bakiye[pb];
  return {
    devir, gelir, gider, net, bakiye, adet,
    kategoriler: [...kategori.values()].sort((a, b) => a.tur.localeCompare(b.tur, "tr") || a.kategori.localeCompare(b.kategori, "tr")),
    projeler: [...proje.values()].map((x) => ({ ...x, net: fark(x.gelir, x.gider) })).sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
  };
}

const ayKoduCoz = (ay) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ay || ""));
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`Geçersiz ay: "${ay}". Beklenen biçim: 2026-10`);
  return { yil: +m[1], ay: +m[2] };
};
export const ayAdi = (ay) => { const a = ayKoduCoz(ay); return `${AYLAR[a.ay - 1]} ${a.yil}`; };
const komsuAy = (ay, yon) => {
  const a = ayKoduCoz(ay);
  const d = new Date(Date.UTC(a.yil, a.ay - 1 + yon, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
export const buAy = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

/** İçinde hareket olan aylar. */
export const aylar = () => [...new Set(db.tablo("kasa").map((r) => String(r.tarih || "").slice(0, 7)).filter((x) => /^\d{4}-\d{2}$/.test(x)))].sort();

/** Kasa ekranı ve aylık dosya için bir ayın tamamı. */
export function ay(ayKodu) {
  const a = ayKoduCoz(ayKodu);
  const bas = `${ayKodu}-01`, bit = `${ayKodu}-${pad(sonGun(a.yil, a.ay))}`;
  const tum = db.tablo("kasa");
  const satirlar = tum.filter((r) => r.tarih >= bas && r.tarih <= bit)
    .sort((x, y) => x.tarih.localeCompare(y.tarih) || (x.tur === "Gelir" ? -1 : 1) - (y.tur === "Gelir" ? -1 : 1));
  return {
    ay: ayKodu, ad: ayAdi(ayKodu), bas, bit,
    onceki: komsuAy(ayKodu, -1), sonraki: komsuAy(ayKodu, 1), buAy: buAy(),
    satirlar,
    ozet: ozetle(tum, bas, bit),
    silinen: db.tablo("kasaSilinen").filter((x) => String(x.tarih || "").startsWith(ayKodu)),
  };
}

const RAPOR_TURLERI = ["donem", "ay", "ceyrek", "yariyil", "yil", "proje"];

function kovalar(tur, yil, satirlar) {
  const out = [];
  const tarihAraligi = (ay1, ay2) => [`${yil}-${pad(ay1)}-01`, `${yil}-${pad(ay2)}-${pad(sonGun(yil, ay2))}`];
  if (tur === "donem") {
    for (let m = 1; m <= 12; m += 1) {
      for (const yari of [1, 2]) {
        const d = puantaj.donemCoz(`${yil}-${pad(m)}-${yari}`);
        out.push({ anahtar: d.donem, ad: `${AYLAR[m - 1]} ${yari}. yarı`, bas: d.gunler[0], bit: d.gunler.at(-1) });
      }
    }
  } else if (tur === "ay") {
    for (let m = 1; m <= 12; m += 1) { const [bas, bit] = tarihAraligi(m, m); out.push({ anahtar: `${yil}-${pad(m)}`, ad: AYLAR[m - 1], bas, bit }); }
  } else if (tur === "ceyrek") {
    for (let q = 1; q <= 4; q += 1) {
      const [bas, bit] = tarihAraligi(q * 3 - 2, q * 3);
      out.push({ anahtar: `${yil}-Q${q}`, ad: `${q}. çeyrek (${AYLAR[q * 3 - 3]}–${AYLAR[q * 3 - 1]})`, bas, bit });
    }
  } else if (tur === "yariyil") {
    out.push({ anahtar: `${yil}-H1`, ad: "1. yarıyıl (Ocak–Haziran)", bas: `${yil}-01-01`, bit: `${yil}-06-30` });
    out.push({ anahtar: `${yil}-H2`, ad: "2. yarıyıl (Temmuz–Aralık)", bas: `${yil}-07-01`, bit: `${yil}-12-31` });
  } else if (tur === "yil") {
    const yillar = satirlar.map((r) => +String(r.tarih).slice(0, 4)).filter(Boolean);
    const ilk = Math.min(new Date().getFullYear(), ...yillar), son = Math.max(new Date().getFullYear(), ...yillar);
    for (let y = ilk; y <= son; y += 1) out.push({ anahtar: String(y), ad: String(y), bas: `${y}-01-01`, bit: `${y}-12-31` });
  }
  return out;
}

/**
 * Kasa raporu. tur: donem | ay | ceyrek | yariyil | yil | proje. proje: "" tümü, "-" projesiz, kod.
 * Her kova: devir, gelir, gider, net, bakiye, kategori ve proje dağılımı. Tutarlar para birimine göre ayrı.
 */
export function rapor({ tur = "ay", yil, proje = "" } = {}) {
  if (!RAPOR_TURLERI.includes(tur)) throw new Error(`Geçersiz rapor türü: ${tur}`);
  yil = Number(yil) || new Date().getFullYear();
  const tum = db.tablo("kasa");
  const satirlar = proje ? tum.filter((r) => (r.proje || "-") === proje) : tum;
  const yilBas = `${yil}-01-01`, yilBit = `${yil}-12-31`;

  let liste;
  if (tur === "proje") {
    const kodlar = [...new Set(satirlar.filter((r) => r.tarih >= yilBas && r.tarih <= yilBit).map((r) => r.proje || ""))];
    liste = kodlar.map((k) => ({
      anahtar: k || "-", ad: projeAdi(k), proje: k,
      ...ozetle(satirlar.filter((r) => (r.proje || "") === k), yilBas, yilBit),
    })).sort((a, b) => (a.proje ? 0 : 1) - (b.proje ? 0 : 1) || a.ad.localeCompare(b.ad, "tr"));
  } else {
    liste = kovalar(tur, yil, satirlar).map((k) => ({ ...k, ...ozetle(satirlar, k.bas, k.bit) }));
  }

  const yillar = [...new Set([new Date().getFullYear(), ...tum.map((r) => +String(r.tarih).slice(0, 4)).filter(Boolean)])].sort();
  const genel = tur === "yil" && liste.length
    ? ozetle(satirlar, liste[0].bas, liste.at(-1).bit)
    : ozetle(satirlar, yilBas, yilBit);
  return {
    tur, yil, proje, projeAd: proje ? projeAdi(proje === "-" ? "" : proje) : "Tüm projeler",
    yillar, kovalar: liste, toplam: genel,
  };
}
