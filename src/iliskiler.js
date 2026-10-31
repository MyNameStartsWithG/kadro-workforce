/**
 * Kayıtlar arası bağlar: Proje ──< Ekip ──< Personel ──> Ev, zimmetler ekibe ya da kişiye.
 *
 * Bağlar her zaman KOD üzerinden kurulur (KDR-2026-0001, EKP-01, EV-01, PRJ-2026-0001).
 * İsim değişse de bağ kopmaz. Hesaplanan sütunlar (kişi sayısı, doluluk, kişi başı kira…)
 * diske yazılmaz; her okumada buradan üretilir.
 */
import * as db from "./db.js";
import { kayitDurumu, durumOtomatikMi } from "./kontrat.js";
import { liste as notListesi } from "./notlar.js";

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** Puantaj gelene kadar 15 günlük tahminlerde kullanılan gün sayısı. */
export const STANDART_DONEM_GUN = 15;

const PASIF = new Set(["Ayrıldı"]);

export const sayi = (v) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const yuvarla = (n) => Math.round(n * 100) / 100;
export const paraMetni = (n, pb) => (n ? `${yuvarla(n).toLocaleString("tr-TR")} ${pb || ""}`.trim() : "—");

/** { EUR: 10, RSD: 5 } biçimindeki toplamlara ekler. */
function topla(hedef, pb, tutar) {
  if (!tutar) return;
  const k = pb || "EUR";
  hedef[k] = yuvarla((hedef[k] || 0) + tutar);
}

const bul = (tablo, kod) => (kod ? db.satirBul(tablo, (x) => x.kod === kod) : null);
const aktifPersonel = () => db.tablo("personel").filter((p) => !PASIF.has(p.durum));

export const ekipUyeleri = (kod) => aktifPersonel().filter((p) => p.ekip === kod);
export const evSakinleri = (kod) => aktifPersonel().filter((p) => p.ev === kod);
export const projeEkipleri = (kod) => db.tablo("ekip").filter((e) => e.proje === kod);

/** Kişinin maliyetinin yazılacağı proje: önce ekibinin projesi, yoksa kaldığı evin projesi. */
export function kisininProjesi(p) {
  return bul("ekip", p.ekip)?.proje || bul("ev", p.ev)?.proje || "";
}

export function ekipHesap(e) {
  const kisi = ekipUyeleri(e.kod).length;
  const gunluk = sayi(e.yemekGunluk);
  return {
    kisiSayisi: kisi,
    paraBirimi: e.yemekParaBirimi || "EUR",
    yemekKisiGunluk: gunluk,
    yemekEkipGunluk: yuvarla(gunluk * kisi),
    yemekEkipDonem: yuvarla(gunluk * kisi * STANDART_DONEM_GUN),
  };
}

/** Kira periyodunun yıldaki sayısı: günlük kira = kira × F ÷ 365. */
export const KIRA_F = { "Aylık": 12, "Haftalık": 52, "Günlük": 365 };
export const kiraGunlukTutar = (kira, periyot) => sayi(kira) * (KIRA_F[periyot] || 12) / 365;
/** Bir ayın kira tutarı: aylık kirada kiranın kendisi, haftalık/günlükte günlük kira × ayın gün sayısı. */
export const kiraAylikTutar = (kira, periyot, ayGunu = 365 / 12) =>
  (!periyot || periyot === "Aylık") ? sayi(kira) : kiraGunlukTutar(kira, periyot) * ayGunu;

export function evHesap(ev) {
  const kisi = evSakinleri(ev.kod).length;
  const yatak = sayi(ev.yatak);
  const kira = sayi(ev.kira);
  const periyot = ev.kiraPeriyodu || "Aylık";
  const aylik = kiraAylikTutar(kira, periyot);
  const gunluk = kiraGunlukTutar(kira, periyot);
  return {
    kisiSayisi: kisi,
    yatak,
    asim: yatak > 0 && kisi > yatak,
    paraBirimi: ev.paraBirimi || "EUR",
    kira,
    kiraPeriyodu: periyot,
    kiraAylik: yuvarla(aylik),
    kiraGunluk: yuvarla(gunluk),
    kisiBasiKira: kisi ? yuvarla(aylik / kisi) : 0,
    kisiBasiGunluk: kisi ? Math.round(gunluk / kisi * 10000) / 10000 : 0,
  };
}

/** Tablo satırına hesaplanan sütunları ekler (kaydedilmez). */
export function zenginlestir(tabloAdi, satir) {
  if (!satir) return satir;
  const s = { ...satir };
  if (tabloAdi === "ekip") {
    const h = ekipHesap(s);
    s.kisiSayisi = String(h.kisiSayisi);
    s.yemekEkipGunluk = paraMetni(h.yemekEkipGunluk, h.paraBirimi);
    s.yemekEkipDonem = paraMetni(h.yemekEkipDonem, h.paraBirimi);
  } else if (tabloAdi === "ev") {
    const h = evHesap(s);
    s.doluluk = `${h.kisiSayisi}/${h.yatak || "?"}${h.asim ? " !" : ""}`;
    s.kisiBasiKira = paraMetni(h.kisiBasiKira, h.paraBirimi);
    s.kisiBasiGunluk = paraMetni(h.kisiBasiGunluk, h.paraBirimi);
  } else if (tabloAdi === "proje") {
    const ekipler = projeEkipleri(s.kod);
    s.ekipSayisi = String(ekipler.length);
    s.kisiSayisi = String(ekipler.reduce((a, e) => a + ekipUyeleri(e.kod).length, 0));
  } else if (tabloAdi === "avans") {
    s.personelAd = db.satirBul("personel", (p) => p.kod === s.personelKod)?.ad || "—";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.tarih || "");
    s.donem = m ? `${AYLAR[+m[2] - 1]} ${m[1]} · ${+m[3] <= 15 ? 1 : 2}. Yarı` : "—";
  } else if (tabloAdi === "kontrat") {
    s.personelAd = db.satirBul("personel", (p) => p.kod === s.personelKod)?.ad || "—";
    s.durumEtiketi = kayitDurumu(s);
  } else if (tabloAdi === "kasa") {
    const oto = s.kaynak && s.kaynak !== "Elle";
    s.durumEtiketi = !oto ? "Elle girildi" : s.elleDuzeltildi ? "Elle düzeltildi" : "Otomatik";
    s.sistemTutar = oto && s.elleDuzeltildi && s.sistem
      ? (s.sistem.silindi ? "kaynağı silindi" : paraMetni(s.sistem.tutar, s.sistem.paraBirimi))
      : "";
  } else if (tabloAdi === "zimmet") {
    s.sahipAd = s.sahipTuru === "Ekip"
      ? (bul("ekip", s.ekipKod)?.ad || "—")
      : (db.satirBul("personel", (p) => p.kod === s.personelKod)?.ad || s.personelAd || "—");
  }
  return s;
}

const acikZimmet = (z) => z.durum !== "İade Edildi";
const kisiselZimmetler = (kod) => db.tablo("zimmet").filter((z) => z.sahipTuru !== "Ekip" && z.personelKod === kod && acikZimmet(z));
export const ekipZimmetleri = (kod) => db.tablo("zimmet").filter((z) => z.sahipTuru === "Ekip" && z.ekipKod === kod && acikZimmet(z));

const kisiOzet = (p) => ({
  _id: p._id, kod: p.kod, ad: p.ad, gorev: p.gorev, durum: p.durum,
  ekip: p.ekip, ev: p.ev, odemeTuru: p.odemeTuru, ucret: p.ucret, paraBirimi: p.paraBirimi,
});

/** Bir projenin günlük yemek ve aylık kira yükü (kişi başı paylarla). */
function projeMaliyeti(projeKod) {
  const yemekGunluk = {}, kiraAylik = {}, maasAylik = {};
  let saatlikKisi = 0;
  for (const e of projeEkipleri(projeKod)) {
    const h = ekipHesap(e);
    topla(yemekGunluk, h.paraBirimi, h.yemekEkipGunluk);
  }
  for (const ev of db.tablo("ev")) {
    if (ev.durum === "Boşaltıldı") continue;
    const h = evHesap(ev);
    for (const p of evSakinleri(ev.kod)) {
      if (kisininProjesi(p) === projeKod) topla(kiraAylik, h.paraBirimi, h.kisiBasiKira);
    }
  }
  for (const p of aktifPersonel()) {
    if (kisininProjesi(p) !== projeKod) continue;
    if (p.odemeTuru === "Aylık") topla(maasAylik, p.paraBirimi, sayi(p.ucret));
    else if (p.odemeTuru === "Saatlik") saatlikKisi += 1;
  }
  return { yemekGunluk, kiraAylik, maasAylik, saatlikKisi };
}

/** Ayrıntı sayfasının ihtiyaç duyduğu tüm bağlı veriler. */
export function detay(tabloAdi, id) {
  const satir = db.satirBul(tabloAdi, (x) => x._id === id);
  if (!satir) throw new Error("Kayıt bulunamadı.");
  const out = { satir: zenginlestir(tabloAdi, satir) };
  const zmt = (z) => zenginlestir("zimmet", z);

  if (tabloAdi === "personel") {
    const ekip = bul("ekip", satir.ekip);
    const ev = bul("ev", satir.ev);
    out.ekip = ekip ? zenginlestir("ekip", ekip) : null;
    out.ev = ev ? { ...zenginlestir("ev", ev), hesap: evHesap(ev) } : null;
    out.proje = bul("proje", kisininProjesi(satir));
    out.kisiselZimmet = kisiselZimmetler(satir.kod).map(zmt);
    out.ekipZimmet = ekip ? ekipZimmetleri(ekip.kod).map(zmt) : [];
    out.maasGecmisi = [...(satir.maasGecmisi || [])].reverse();
    out.yemekGunluk = ekip ? { tutar: sayi(ekip.yemekGunluk), paraBirimi: ekip.yemekParaBirimi || "EUR" } : null;
    out.kontratlar = db.tablo("kontrat").filter((r) => r.personelKod === satir.kod)
      .map((r) => ({ ...zenginlestir("kontrat", r), projeAd: bul("proje", r.proje)?.ad || "" }))
      .sort((a, b) => String(b.baslangic).localeCompare(String(a.baslangic)));
    out.durumOtomatik = durumOtomatikMi(satir.kod);
    out.notlar = notListesi(satir.kod);
  }

  if (tabloAdi === "ekip") {
    out.proje = bul("proje", satir.proje);
    out.ekipBasi = db.satirBul("personel", (p) => p.kod === satir.ekipBasi);
    out.hesap = ekipHesap(satir);
    out.uyeler = ekipUyeleri(satir.kod).map(kisiOzet);
    out.zimmet = ekipZimmetleri(satir.kod).map(zmt);
    out.kisiselZimmet = out.uyeler.flatMap((u) => kisiselZimmetler(u.kod)).map(zmt);
  }

  if (tabloAdi === "proje") {
    out.musteri = bul("musteri", satir.musteri);
    out.ekipler = projeEkipleri(satir.kod).map((e) => {
      const uyeler = ekipUyeleri(e.kod);
      return {
        ...zenginlestir("ekip", e),
        hesap: ekipHesap(e),
        uyeler: uyeler.map(kisiOzet),
        zimmet: ekipZimmetleri(e.kod).map(zmt),
        kisiselZimmet: uyeler.flatMap((u) => kisiselZimmetler(u.kod)).map(zmt),
      };
    });
    out.evler = db.tablo("ev")
      .filter((ev) => ev.proje === satir.kod || evSakinleri(ev.kod).some((p) => kisininProjesi(p) === satir.kod))
      .map((ev) => ({ ...zenginlestir("ev", ev), hesap: evHesap(ev), sakinler: evSakinleri(ev.kod).map(kisiOzet) }));
    out.maliyet = projeMaliyeti(satir.kod);
  }

  if (tabloAdi === "ev") {
    out.proje = bul("proje", satir.proje);
    out.hesap = evHesap(satir);
    out.sakinler = evSakinleri(satir.kod).map((p) => ({ ...kisiOzet(p), proje: kisininProjesi(p) }));
    const paylar = {};
    for (const p of out.sakinler) {
      const k = p.proje || "—";
      paylar[k] = paylar[k] || { proje: k, ad: bul("proje", p.proje)?.ad || "Projesiz", kisi: 0, tutar: 0 };
      paylar[k].kisi += 1;
      paylar[k].tutar = yuvarla(paylar[k].tutar + out.hesap.kisiBasiKira);
    }
    out.kiraPaylari = Object.values(paylar);
  }

  return out;
}
