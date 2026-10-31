/**
 * Ödemeler: kime, ne zaman, ne kadar ödenecek ve ödendi mi.
 *
 * Ödeme kalemleri puantajdan üretilir (kaydedilmez, her okumada hesaplanır):
 *   Yemek parası  → açılmış her dönemin başında (ayın 1'i ve 16'sı), kişi başı, dönemin günleri için önden.
 *   Saatlik ücret → kapanmış her dönemin ertesi günü (16'sı ve sonraki ayın 1'i), dönemin neti.
 *   Aylık maaş    → ayın 2. yarısı kapanınca, sonraki ayın 1'inde, iki yarının neti (ay sonu ödenecek).
 *   Ev kirası     → ayın 1. yarısı açılınca, ayın 1'inde; evde kalanların projelerine bölünür.
 * Ödendi işareti db.odeme'ye yazılır (tarih, ödenen tutar, not). Ödenen tutar hesaplanandan farklı olabilir
 * (ör. 100 yerine 90): fark görünür kalır. Ödendi işareti kasaya gider satırı olarak düşer (bkz. kasa.js).
 */
import * as db from "./db.js";
import * as puantaj from "./puantaj.js";
import { kiraAylikTutar, sayi } from "./iliskiler.js";

const pad = (n) => String(n).padStart(2, "0");
const yuvarla = (n) => Math.round(n * 100) / 100;
const PB_SIRA = ["EUR", "TRY", "RSD"];
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export const GRUPLAR = {
  kira: { ad: "Ev kiraları", kategori: "Kira", sira: 1 },
  aylik: { ad: "Aylık maaşlar", kategori: "Maaş", sira: 2 },
  saatlik: { ad: "Saatlik ücretler", kategori: "Maaş", sira: 3 },
  yemek: { ad: "Yemek paraları", kategori: "Yemek", sira: 4 },
};

const ertesiGun = (gun) => {
  const d = new Date(`${gun}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const kayitlar = () => { const v = db.tum(); v.odeme = v.odeme || []; return v.odeme; };

/** Bütün ödeme kalemleri (ödendi bilgisi olmadan). */
export function kalemler() {
  const out = [];
  for (const p of puantaj.tumDonemler()) {
    const d = puantaj.donemCoz(p.donem);
    const ayKodu = `${d.yil}-${pad(d.ay)}`;
    const ayAdi = `${puantaj.AYLAR[d.ay - 1]} ${d.yil}`;
    const donemKisa = `${ayAdi} ${d.yari}. yarı (${d.bas}–${d.bit})`;
    const h = puantaj.hesapla(p);
    const ilkYariKapali = d.yari === 2 ? puantaj.bul(`${ayKodu}-1`)?.durum === "kapali" : true;

    p.satirlar.forEach((s, i) => {
      const hs = h.satirlar[i];
      const proje = p.ekipler[s.ekip]?.proje || s.proje || "";
      const ortak = { personelKod: s.personelKod, kim: s.ad, ekip: s.ekip, donem: p.donem, proje };

      for (const [pb, t] of Object.entries(hs.yemek)) {
        if (!(t > 0)) continue;
        out.push({
          ...ortak, anahtar: `yemek:${p.donem}:${s.personelKod}:${pb}`, tur: "yemek", vade: d.gunler[0],
          aciklama: `Yemek parası · ${donemKisa}`, tutar: yuvarla(t), paraBirimi: pb,
          detay: { gun: hs.isteGun ?? d.gunler.length, gunluk: p.ekipler[s.ekip]?.yemekGunluk || 0 },
        });
      }
      if (p.durum !== "kapali") return;
      const detay = {
        hakedis: hs.hakedis, mesai: hs.mesai, mesaiTutar: hs.mesaiTutar, kesinti: hs.kesinti,
        kesintiDetay: hs.kesintiDetay, gelmedi: hs.gelmedi, avans: hs.avansDusulen ?? (hs.avans[hs.paraBirimi] || 0),
      };
      if (s.odemeTuru === "Saatlik") {
        for (const [pb, t] of Object.entries(hs.net)) {
          if (!(t > 0)) continue;
          out.push({
            ...ortak, anahtar: `maas:${p.donem}:${s.personelKod}:${pb}`, tur: "saatlik", vade: ertesiGun(d.gunler.at(-1)),
            aciklama: `Saatlik ücret · ${donemKisa}`, tutar: t, paraBirimi: pb, detay,
          });
        }
      } else if (s.odemeTuru === "Aylık" && d.yari === 2) {
        for (const [pb, t] of Object.entries(hs.aySonu || hs.net)) {
          if (!(t > 0)) continue;
          out.push({
            ...ortak, anahtar: `maas:${ayKodu}:${s.personelKod}:${pb}`, tur: "aylik", vade: ertesiGun(d.gunler.at(-1)),
            aciklama: `Aylık maaş · ${ayAdi}`, tutar: t, paraBirimi: pb,
            detay: { ...detay, ilkYari: hs.ilkYariNet?.[pb] ?? null },
            uyari: ilkYariKapali ? null : "Ayın 1. yarısı henüz kapanmadı; tutar değişebilir.",
          });
        }
      }
    });

    // Kira: ayın 1. yarısı açıldığında o ayın kirası, evde kalanların projelerine bölünür.
    if (d.yari === 1) {
      const ayGunu = new Date(Date.UTC(d.yil, d.ay, 0)).getUTCDate();
      for (const [evKod, ev] of Object.entries(puantaj.evlerAnlik(p))) {
        if (ev.durum === "Boşaltıldı" || !(ev.kira > 0)) continue;
        const tutar = yuvarla(kiraAylikTutar(ev.kira, ev.kiraPeriyodu, ayGunu));
        const sakinler = p.satirlar.filter((s) => s.ev === evKod);
        const paylar = {};
        for (const s of sakinler) paylar[s.proje || ""] = (paylar[s.proje || ""] || 0) + 1;
        const dagilim = sakinler.length
          ? Object.entries(paylar).map(([proje, n]) => ({ proje, oran: n / sakinler.length }))
          : [{ proje: ev.proje || "", oran: 1 }];
        out.push({
          anahtar: `kira:${ayKodu}:${evKod}:${ev.paraBirimi}`, tur: "kira", vade: d.gunler[0],
          kim: `${evKod} ${ev.ad}`, evKod, donem: p.donem, proje: ev.proje || "",
          aciklama: `Ev kirası · ${ayAdi}${ev.kiraPeriyodu && ev.kiraPeriyodu !== "Aylık" ? ` (${ev.kiraPeriyodu.toLocaleLowerCase("tr")} kira × ${ayGunu} gün)` : ""}`,
          tutar, paraBirimi: ev.paraBirimi, dagilim,
          detay: { kisi: sakinler.length, kira: ev.kira, periyot: ev.kiraPeriyodu || "Aylık" },
        });
      }
    }
  }
  return out;
}

/** Bir ayın ödeme günleri: vadesi bu ayda olan kalemler, ödendi bilgileriyle, güne ve gruba göre. */
export function ay(ayKodu) {
  if (!/^\d{4}-\d{2}$/.test(String(ayKodu || ""))) throw new Error(`Geçersiz ay: "${ayKodu}". Beklenen biçim: 2026-10`);
  const tum = kalemler();
  const kayit = new Map(kayitlar().map((r) => [r.anahtar, r]));
  const bugun = new Date().toISOString().slice(0, 10);

  const birlestir = (k) => {
    const r = kayit.get(k.anahtar);
    return { ...k, odendi: Boolean(r), odeme: r || null, degisti: r && r.sistemTutar !== k.tutar ? k.tutar : null };
  };
  const buAy = tum.filter((k) => k.vade.startsWith(ayKodu)).map(birlestir);
  // Kalemi artık üretilmeyen ama ödenmiş kayıtlar (ör. dönem yeniden açıldı) da listede kalır.
  const varolan = new Set(buAy.map((k) => k.anahtar));
  for (const r of kayitlar()) {
    if (!r.vade?.startsWith(ayKodu) || varolan.has(r.anahtar)) continue;
    buAy.push({ ...r, tutar: r.sistemTutar, odendi: true, odeme: r, kaynakYok: true });
  }

  const gunler = new Map();
  for (const k of buAy) {
    const g = (gunler.get(k.vade) || gunler.set(k.vade, { vade: k.vade, gruplar: new Map() }).get(k.vade));
    const gr = (g.gruplar.get(k.tur) || g.gruplar.set(k.tur, { tur: k.tur, ad: GRUPLAR[k.tur]?.ad || k.tur, kalemler: [] }).get(k.tur));
    gr.kalemler.push(k);
  }
  const ozet = (liste) => {
    const o = { toplam: {}, odenen: {}, kalan: {}, adet: liste.length, odenmis: 0 };
    for (const k of liste) {
      const pb = k.paraBirimi;
      o.toplam[pb] = yuvarla((o.toplam[pb] || 0) + (k.tutar || 0));
      if (k.odendi) { o.odenmis += 1; o.odenen[pb] = yuvarla((o.odenen[pb] || 0) + sayi(k.odeme.tutar)); }
      else o.kalan[pb] = yuvarla((o.kalan[pb] || 0) + (k.tutar || 0));
    }
    return o;
  };
  const siraliGunler = [...gunler.values()].sort((a, b) => a.vade.localeCompare(b.vade)).map((g) => ({
    vade: g.vade, gecti: g.vade < bugun,
    gruplar: [...g.gruplar.values()].sort((a, b) => (GRUPLAR[a.tur]?.sira || 9) - (GRUPLAR[b.tur]?.sira || 9)).map((gr) => ({
      ...gr, kalemler: gr.kalemler.sort((a, b) => a.kim.localeCompare(b.kim, "tr") || PB_SIRA.indexOf(a.paraBirimi) - PB_SIRA.indexOf(b.paraBirimi)),
      ozet: ozet(gr.kalemler),
    })),
    ozet: ozet(g.gruplar.size ? [...g.gruplar.values()].flatMap((x) => x.kalemler) : []),
  }));

  const bekleyenEski = tum.filter((k) => k.vade < `${ayKodu}-01` && !kayit.has(k.anahtar));
  return {
    ay: ayKodu, gunler: siraliGunler, ozet: ozet(buAy),
    gecikmis: { adet: bekleyenEski.length, enEski: bekleyenEski.map((k) => k.vade).sort()[0] || null },
  };
}

/** Ödendi işareti koyar ya da günceller: [{ anahtar, tarih, tutar, not }] */
export function ode(liste) {
  if (!Array.isArray(liste) || !liste.length) throw new Error("Ödenecek kalem seçilmedi.");
  const tum = new Map(kalemler().map((k) => [k.anahtar, k]));
  const kayit = kayitlar();
  const hazir = liste.map(({ anahtar, tarih, tutar, not }) => {
    const mevcut = kayit.find((r) => r.anahtar === anahtar);
    const k = tum.get(anahtar) || (mevcut && { ...mevcut, tutar: mevcut.sistemTutar });
    if (!k) throw new Error(`Ödeme kalemi bulunamadı: ${anahtar}`);
    if (!TARIH.test(String(tarih || ""))) throw new Error(`${k.kim}: ödeme tarihi geçersiz.`);
    const n = tutar === undefined || tutar === null || tutar === "" ? k.tutar : sayi(tutar);
    if (!(n >= 0)) throw new Error(`${k.kim}: ödenen tutar geçersiz.`);
    return { k, mevcut, tarih, tutar: yuvarla(n), not: String(not ?? mevcut?.not ?? "").trim() };
  });
  for (const { k, mevcut, tarih, tutar, not } of hazir) {
    const r = {
      anahtar: k.anahtar, tur: k.tur, vade: k.vade, kim: k.kim, aciklama: k.aciklama,
      personelKod: k.personelKod || "", evKod: k.evKod || "", donem: k.donem, proje: k.proje || "",
      dagilim: k.dagilim || null, paraBirimi: k.paraBirimi,
      sistemTutar: k.tutar, tutar, tarih, not,
      kullanici: db.ayarlar().kullanici, kayitTarihi: new Date().toISOString(),
    };
    if (mevcut) Object.assign(mevcut, r); else kayit.push(r);
  }
  db.yaz();
  return hazir.length;
}

/** Ödendi işaretini kaldırır (kasadaki satırı da kalkar). */
export function geriAl(anahtar) {
  const kayit = kayitlar();
  const i = kayit.findIndex((r) => r.anahtar === anahtar);
  if (i < 0) throw new Error("Bu kalem zaten ödenmemiş görünüyor.");
  kayit.splice(i, 1);
  db.yaz();
}

/** Ödenmiş kalemlerin kasa satırları (kasa.esitle bunları otomatik satır olarak yazar). */
export function kasaSatirlari() {
  const out = [];
  for (const r of kayitlar()) {
    const kategori = GRUPLAR[r.tur]?.kategori || "Diğer Gider";
    const fark = r.tutar !== r.sistemTutar ? ` (hesaplanan ${r.sistemTutar.toLocaleString("tr-TR")} ${r.paraBirimi})` : "";
    const aciklama = `${r.aciklama} — ${r.kim}${fark}${r.not ? ` · ${r.not}` : ""}`;
    const ortak = { tarih: r.tarih, tur: "Gider", kategori, kaynak: "Ödeme", aciklama, personelKod: r.personelKod || "", paraBirimi: r.paraBirimi };
    if (r.dagilim?.length > 1) {
      for (const d of r.dagilim) out.push({ ...ortak, anahtar: `odeme:${r.anahtar}:${d.proje || "-"}`, proje: d.proje, tutar: r.tutar * d.oran });
    } else {
      out.push({ ...ortak, anahtar: `odeme:${r.anahtar}`, proje: r.dagilim?.[0]?.proje ?? r.proje, tutar: r.tutar });
    }
  }
  return out;
}
