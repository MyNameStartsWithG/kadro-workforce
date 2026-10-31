/**
 * Öngörü tablosu: sütunlar 15 günlük dönemler, satırlar maliyet kalemleri.
 *
 * Geçmiş dönemler (günü geçmiş ya da puantajı kapanmış) GERÇEKLEŞEN değeri gösterir:
 *   Maaş, mesai, yemek → puantajdan (hakediş tahakkuku; tutar günün ekibinin projesine yazılır)
 *   Kira, diğer giderler, gelirler → kasadan
 * Gelecek dönemler TAHMİN gösterir:
 *   Maaş   → aktif personelin güncel maaşı (aylık: maaşın yarısı; saatlik: iş günü × normal saat × ücret).
 *            Çalışma dönemi girilen kişi sadece o tarihler arasında sayılır (aylıkta günlük maaş × gün).
 *   Mesai  → kişinin son 4 kapanmış dönemdeki mesai ücreti ortalaması
 *   Yemek  → ekip yemek tutarı × ekipteki kişi × dönemin çalışma günü (tatil hariç)
 *   Kira   → evlerin kirası, ayın 1. dönemine; kişi başı paylarla kişinin projesine
 *   Diğer  → kasada ileri tarihli elle giderler + "her ay tekrarlar" işaretli giderler
 *   Gelir  → aynısı, gelir tarafı
 * Tahmin hücreleri elle düzeltilebilir (db.ongoru). Düzeltme hangi proje görünümünde yapıldıysa orada geçerlidir.
 * Kur çevirisi yoktur: her para birimi ayrı hesaplanır.
 */
import * as db from "./db.js";
import * as puantaj from "./puantaj.js";
import * as kontrat from "./kontrat.js";
import { kisininProjesi, evHesap, evSakinleri, ekipUyeleri, kiraAylikTutar, sayi } from "./iliskiler.js";

const pad = (n) => String(n).padStart(2, "0");
const yuvarla = (n) => Math.round(n * 100) / 100;
const bugunMetni = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const PB_SIRA = ["EUR", "TRY", "RSD"];
const OTOMATIK_KATEGORI = new Set(["Maaş", "Avans", "Yemek", "Kira"]);
const MESAI_ORNEK = 4;

export const SATIRLAR = [
  { k: "maas", ad: "Maaşlar", tur: "gider",
    gercek: "Puantaj hakedişi (mesai hariç, kesinti düşülmüş)", tahmin: "Aktif personelin güncel maaşı. Aylık: maaşın yarısı. Saatlik: iş günü × normal saat × ücret. Çalışma dönemi girilen kişi sadece o tarihler arasında" },
  { k: "mesai", ad: "Mesai", tur: "gider",
    gercek: "Puantajdaki mesai ücreti", tahmin: `Kişinin son ${MESAI_ORNEK} kapanmış dönemdeki mesai ücreti ortalaması` },
  { k: "yemek", ad: "Yemek", tur: "gider",
    gercek: "Puantajdaki yemek parası (dönemin günleri için önden verilen)", tahmin: "Ekip yemek tutarı × ekipteki kişi × dönemin gün sayısı (önden verilir)" },
  { k: "kira", ad: "Ev kiraları", tur: "gider",
    gercek: "Kasadaki kira giderleri (ödendi işaretlenen kiralar)", tahmin: "Evlerin o ayki kirası (haftalık/günlük kira ayın gün sayısıyla), ayın 1. yarısına. Kişi başı paylarla projelere bölünür" },
  { k: "diger", ad: "Diğer giderler", tur: "gider",
    gercek: "Kasadaki diğer giderler (maaş, avans, yemek, kira hariç)", tahmin: "Kasada ileri tarihli elle giderler ve \"her ay tekrarlar\" işaretli giderler" },
  { k: "gelir", ad: "Gelirler", tur: "gelir",
    gercek: "Kasadaki gelirler", tahmin: "Kasada ileri tarihli gelirler ve \"her ay tekrarlar\" işaretli gelirler" },
];
const SATIR_K = new Set(SATIRLAR.map((s) => s.k));

const elleAnahtar = (donem, k, pb, proje) => `${donem}|${k}|${pb}|${proje || "*"}`;
const elleler = () => { const v = db.tum(); v.ongoru = v.ongoru || {}; return v.ongoru; };

/** Tahmin hücresini elle düzeltir; boş değer düzeltmeyi kaldırır. */
export function hucreYaz({ donem, satir, pb, proje, deger }) {
  const d = puantaj.donemCoz(donem);
  if (!SATIR_K.has(satir)) throw new Error(`Bilinmeyen satır: ${satir}`);
  if (!PB_SIRA.includes(pb)) throw new Error(`Geçersiz para birimi: ${pb}`);
  if (donemGercekMi(d)) throw new Error(`${puantaj.donemAdi(d.donem)} gerçekleşmiş bir dönem; sadece tahminler düzeltilebilir.`);
  const anahtar = elleAnahtar(d.donem, satir, pb, proje);
  const ham = String(deger ?? "").trim().replace(/\s/g, "");
  if (!ham) delete elleler()[anahtar];
  else {
    // "1.500,25" (Türkçe binlik) da "1500.25" de kabul edilir.
    const duz = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(ham) ? ham.replace(/\./g, "").replace(",", ".") : ham.replace(",", ".");
    const n = Number(duz);
    if (!/^\d+(\.\d+)?$/.test(duz) || !Number.isFinite(n)) throw new Error(`"${deger}" geçerli bir tutar değil.`);
    elleler()[anahtar] = { deger: yuvarla(n), tarih: new Date().toISOString(), kullanici: db.ayarlar().kullanici };
  }
  db.yaz();
}

function donemGercekMi(d, bugun = bugunMetni()) {
  return puantaj.bul(d.donem)?.durum === "kapali" || d.gunler.at(-1) < bugun;
}

/** Dönemin gün tipleri: puantaj açıldıysa oradan, değilse varsayılan (Ct mesai, Pz tatil). */
function gunTipleri(d) {
  const p = puantaj.bul(d.donem);
  return d.gunler.map((g) => p?.gunler[g] || puantaj.varsayilanGunTipi(g));
}

/** Kişinin son kapanmış dönemlerdeki ortalama mesai ücreti: { pb, tutar, ornek } */
function mesaiOrtalamalari() {
  const kapali = puantaj.tumDonemler().filter((p) => p.durum === "kapali");
  const out = new Map();
  for (const p of kapali.reverse()) {
    for (const s of p.satirlar) {
      const o = out.get(s.personelKod) || { toplam: 0, ornek: 0, pb: null };
      if (o.ornek >= MESAI_ORNEK) continue;
      const h = puantaj.satirHesapla(p, s);
      o.toplam += h.mesaiTutar;
      o.ornek += 1; o.pb = o.pb || h.paraBirimi;
      out.set(s.personelKod, o);
    }
  }
  for (const o of out.values()) o.tutar = o.ornek ? yuvarla(o.toplam / o.ornek) : 0;
  return out;
}

/** En son puantajın normal gün saati (yoksa 8). */
function normalSaat() {
  const son = puantaj.tumDonemler().at(-1);
  return sayi(son?.ayar?.normalSaat) || puantaj.VARSAYILAN_AYAR.normalSaat;
}

/** "Her ay tekrarlar" işaretli elle kasa satırları: aynı kalemin en son kaydı seri kaynağıdır. */
function tekrarSerileri() {
  const seriler = new Map();
  for (const r of db.tablo("kasa")) {
    if (r.tekrar !== "Evet" || (r.kaynak && r.kaynak !== "Elle") || !/^\d{4}-\d{2}-\d{2}$/.test(r.tarih || "")) continue;
    const anahtar = [r.tur, r.kategori, (r.aciklama || "").trim().toLocaleLowerCase("tr"), r.proje, r.paraBirimi].join("|");
    const s = seriler.get(anahtar);
    if (!s) seriler.set(anahtar, { kaynak: r, aylar: new Set([r.tarih.slice(0, 7)]) });
    else {
      s.aylar.add(r.tarih.slice(0, 7));
      if (r.tarih > s.kaynak.tarih) s.kaynak = r;
    }
  }
  return [...seriler.values()];
}

/**
 * Tabloyu hesaplar. bas: ilk dönem ("2026-07-1"), adet: sütun sayısı, proje: "" tümü, "-" projesiz, kod.
 */
export function hesapla({ bas, adet = 24, proje = "" } = {}) {
  adet = Math.max(1, Math.min(72, Number(adet) || 24));
  const bugun = bugunMetni();
  const buDonem = puantaj.buDonem();
  bas = bas ? puantaj.donemCoz(bas).donem : (() => { let d = buDonem; for (let i = 0; i < 4; i += 1) d = puantaj.komsuDonem(d, -1); return d; })();

  const donemler = [];
  for (let i = 0, d = bas; i < adet; i += 1, d = puantaj.komsuDonem(d, 1)) donemler.push(d);

  // degerler[k][donem][pb] = { sistem, detay: Map(etiket → tutar) }
  const degerler = Object.fromEntries(SATIRLAR.map((s) => [s.k, {}]));
  const projeUyar = (kod) => !proje || (kod || "-") === proje;
  const ekle = (k, donem, pb, tutar, projeKod, etiket) => {
    if (!tutar || !projeUyar(projeKod)) return;
    const h = ((degerler[k][donem] ||= {})[pb || "EUR"] ||= { sistem: 0, detay: new Map() });
    h.sistem += tutar;
    h.detay.set(etiket, (h.detay.get(etiket) || 0) + tutar);
  };

  const kasa = db.tablo("kasa").filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.tarih || ""));
  const personel = db.tablo("personel");
  const ns = normalSaat();
  const mesaiOrt = mesaiOrtalamalari();
  const seriler = tekrarSerileri();
  const sutunlar = [];

  for (const donem of donemler) {
    const d = puantaj.donemCoz(donem);
    const bit = d.gunler.at(-1), ilk = d.gunler[0];
    const p = puantaj.bul(donem);
    const gercek = donemGercekMi(d, bugun);
    const ayKodu = `${d.yil}-${pad(d.ay)}`;
    sutunlar.push({
      donem, ad: puantaj.donemAdi(donem), ay: `${puantaj.AYLAR[d.ay - 1]} ${d.yil}`, yari: d.yari,
      aralik: `${d.bas}–${d.bit}`, durum: gercek ? "gercek" : "tahmin", bu: donem === buDonem,
      puantaj: p ? p.durum : null,
    });
    const donemKasasi = kasa.filter((r) => r.tarih >= ilk && r.tarih <= bit);

    if (gercek) {
      // Puantaj: hakediş, mesai ve yemek, günün ekibinin projesine dağıtılır.
      for (const s of p?.satirlar || []) {
        const h = puantaj.satirHesapla(p, s, { bugun });
        const toplamNormal = h.gunluk.reduce((a, g) => a + g.n, 0);
        for (const g of h.gunluk) {
          const pr = p.ekipler[g.ekip]?.proje || s.proje;
          if (toplamNormal) ekle("maas", donem, h.paraBirimi, h.tabanNet * (g.n / toplamNormal), pr, s.ad);
          ekle("mesai", donem, h.paraBirimi, g.m * h.mesaiBirim, pr, s.ad);
          if (g.yemek) ekle("yemek", donem, p.ekipler[g.ekip]?.yemekPB, g.yemek, pr, `${g.ekip} ${p.ekipler[g.ekip]?.ad || ""}`.trim());
        }
        if (!toplamNormal) ekle("maas", donem, h.paraBirimi, h.tabanNet, s.proje, s.ad);
      }
      for (const r of donemKasasi) {
        const t = sayi(r.tutar), etiket = r.aciklama || r.kategori || "—";
        if (r.tur === "Gelir") ekle("gelir", donem, r.paraBirimi, t, r.proje, etiket);
        else if (r.kategori === "Kira") ekle("kira", donem, r.paraBirimi, t, r.proje, etiket);
        else if (!OTOMATIK_KATEGORI.has(r.kategori)) ekle("diger", donem, r.paraBirimi, t, r.proje, etiket);
      }
      continue;
    }

    // --- tahmin ---
    const tipler = gunTipleri(d);
    const normalGun = tipler.filter((t) => t === "normal").length;
    const donemGunu = d.gunler.length;

    // Kişinin bu dönemde işte olduğu günler: çalışma dönemi varsa ondan, yoksa durum ve işe girişten (bütün dönem).
    const isteGunleri = (k) => {
      const ar = kontrat.araliklar(k.kod);
      if (ar) return d.gunler.filter((g) => kontrat.icinde(ar, g));
      return k.durum === "Ayrıldı" || (k.iseGiris && k.iseGiris > bit) ? [] : d.gunler;
    };

    for (const k of personel) {
      const gunler = isteGunleri(k);
      if (!gunler.length) continue;
      const tam = gunler.length === donemGunu;
      const u = sayi(k.ucret), pr = kisininProjesi(k), pb = k.paraBirimi || "EUR";
      const ad = tam ? k.ad : `${k.ad} · ${gunler.length} gün`;
      const normal = tam ? normalGun : d.gunler.filter((g, i) => tipler[i] === "normal" && gunler.includes(g)).length;
      if (k.odemeTuru === "Aylık") ekle("maas", donem, pb, tam ? u / 2 : u * 12 / 365 * gunler.length, pr, ad);
      else if (k.odemeTuru === "Saatlik") ekle("maas", donem, pb, normal * ns * u, pr, ad);
      const m = mesaiOrt.get(k.kod);
      if (m?.tutar) ekle("mesai", donem, m.pb, m.tutar * gunler.length / donemGunu, pr, ad);
    }

    for (const e of db.tablo("ekip")) {
      if (e.durum === "Pasif" || !(sayi(e.yemekGunluk) > 0)) continue;
      const gunSayilari = ekipUyeleri(e.kod).map((k) => isteGunleri(k).length).filter(Boolean);
      const kisi = gunSayilari.length, kisiGun = gunSayilari.reduce((a, n) => a + n, 0);
      const etiket = kisiGun === kisi * donemGunu ? `${kisi} kişi × ${donemGunu} gün` : `${kisi} kişi · ${kisiGun} kişi-gün`;
      ekle("yemek", donem, e.yemekParaBirimi || "EUR", sayi(e.yemekGunluk) * kisiGun, e.proje, `${e.kod} ${e.ad} · ${etiket}`);
    }

    if (d.yari === 1) {
      for (const ev of db.tablo("ev")) {
        if (ev.durum === "Boşaltıldı") continue;
        const h = evHesap(ev);
        const ayKira = kiraAylikTutar(ev.kira, ev.kiraPeriyodu, new Date(Date.UTC(d.yil, d.ay, 0)).getUTCDate());
        if (!(ayKira > 0)) continue;
        const sakinler = evSakinleri(ev.kod);
        if (!sakinler.length) ekle("kira", donem, h.paraBirimi, ayKira, ev.proje, `${ev.kod} ${ev.ad} · boş`);
        for (const s of sakinler) ekle("kira", donem, h.paraBirimi, ayKira / sakinler.length, kisininProjesi(s), `${ev.kod} ${ev.ad}`);
      }
    }

    // Kasada bu döneme ileri tarihle girilmiş elle satırlar.
    for (const r of donemKasasi) {
      if (r.kaynak && r.kaynak !== "Elle") continue;
      ekle(r.tur === "Gelir" ? "gelir" : "diger", donem, r.paraBirimi, sayi(r.tutar), r.proje, r.aciklama || r.kategori || "—");
    }
    // Her ay tekrarlayanlar: kaynağın ayından sonraki aylarda, aynı gün (ay kısaysa ayın son günü).
    for (const s of seriler) {
      const r = s.kaynak;
      if (ayKodu <= r.tarih.slice(0, 7) || s.aylar.has(ayKodu)) continue;
      const gun = Math.min(+r.tarih.slice(8), new Date(Date.UTC(d.yil, d.ay, 0)).getUTCDate());
      if (gun < d.bas || gun > d.bit) continue;
      ekle(r.tur === "Gelir" ? "gelir" : "diger", donem, r.paraBirimi, sayi(r.tutar), r.proje, `${r.aciklama || r.kategori || "—"} (her ay)`);
    }
  }

  // Elle düzeltmeler ve son değerler.
  const elle = elleler();
  const pbVar = new Set();
  const cikti = {};
  for (const s of SATIRLAR) {
    cikti[s.k] = {};
    for (const sut of sutunlar) {
      const hucreler = degerler[s.k][sut.donem] || {};
      const pbler = new Set(Object.keys(hucreler));
      if (sut.durum === "tahmin") {
        for (const pb of PB_SIRA) if (elle[elleAnahtar(sut.donem, s.k, pb, proje)]) pbler.add(pb);
      }
      for (const pb of pbler) {
        const h = hucreler[pb];
        const sistem = yuvarla(h?.sistem || 0);
        const e = sut.durum === "tahmin" ? elle[elleAnahtar(sut.donem, s.k, pb, proje)] : null;
        const deger = e ? e.deger : sistem;
        if (!deger && !e) continue;
        pbVar.add(pb);
        (cikti[s.k][sut.donem] ||= {})[pb] = {
          deger, sistem, elle: Boolean(e),
          detay: h ? [...h.detay].map(([ad, t]) => ({ ad, tutar: yuvarla(t) })).filter((x) => x.tutar).sort((a, b) => b.tutar - a.tutar) : [],
        };
      }
    }
  }

  // Toplamlar: gider, net ve kasa bakiyesi (gerçekleşende kasadaki bakiye, tahminde önceki + net).
  const pbler = PB_SIRA.filter((pb) => pbVar.has(pb));
  const projeKasasi = kasa.filter((r) => projeUyar(r.proje));
  const kasaBakiye = (sinir, pb) => yuvarla(projeKasasi.filter((r) => r.tarih <= sinir && (r.paraBirimi || "EUR") === pb)
    .reduce((a, r) => a + (r.tur === "Gelir" ? 1 : -1) * sayi(r.tutar), 0));
  for (const r of kasa) { const pb = r.paraBirimi || "EUR"; if (projeUyar(r.proje) && !pbler.includes(pb) && PB_SIRA.includes(pb)) pbler.push(pb); }
  pbler.sort((a, b) => PB_SIRA.indexOf(a) - PB_SIRA.indexOf(b));
  if (!pbler.length) pbler.push("EUR");

  const toplam = { gider: {}, gelir: {}, net: {}, bakiye: {} };
  const onceki = {};
  for (const pb of pbler) onceki[pb] = kasaBakiye(puantaj.donemCoz(puantaj.komsuDonem(bas, -1)).gunler.at(-1), pb);
  for (const sut of sutunlar) {
    for (const t of Object.values(toplam)) t[sut.donem] = {};
    for (const pb of pbler) {
      const al = (k) => cikti[k][sut.donem]?.[pb]?.deger || 0;
      const gider = yuvarla(SATIRLAR.filter((s) => s.tur === "gider").reduce((a, s) => a + al(s.k), 0));
      const gelir = yuvarla(al("gelir"));
      const net = yuvarla(gelir - gider);
      const bakiye = sut.durum === "gercek" ? kasaBakiye(puantaj.donemCoz(sut.donem).gunler.at(-1), pb) : yuvarla(onceki[pb] + net);
      onceki[pb] = bakiye;
      Object.assign(toplam.gider[sut.donem], { [pb]: gider });
      Object.assign(toplam.gelir[sut.donem], { [pb]: gelir });
      Object.assign(toplam.net[sut.donem], { [pb]: net });
      Object.assign(toplam.bakiye[sut.donem], { [pb]: bakiye });
    }
  }

  const projeAd = !proje ? "Tüm projeler" : proje === "-" ? "Projesiz" : db.satirBul("proje", (x) => x.kod === proje)?.ad || proje;
  return {
    bas, adet, proje, projeAd, buDonem, onceki: puantaj.komsuDonem(bas, -1),
    sutunlar, pbler, satirlar: SATIRLAR, degerler: cikti, toplam,
    bilgi: {
      normalSaat: ns,
      mesaiOrnek: MESAI_ORNEK,
      kapaliDonem: puantaj.tumDonemler().filter((p) => p.durum === "kapali").length,
      tekrarSeri: seriler.length,
      maassiz: personel.filter((k) => k.durum !== "Ayrıldı" && (!k.odemeTuru || !sayi(k.ucret))).length,
      elleSayisi: Object.keys(elle).length,
    },
  };
}
