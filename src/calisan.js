/**
 * Çalışanın gözünden: bir kişinin kendi puantajı, hakedişi, kesinti nedenleri, avansları ve ödemeleri.
 * Yönetici personel sayfasından açar ("Çalışanın gözünden"); ileride çalışan portalı da bu veriyi gösterecek.
 * Bu yüzden sadece o kişiye ait ve çalışana gösterilebilecek alanlar döner: yönetici notları, başkalarının
 * bilgisi, kasa ve yönetici uyarıları girmez.
 */
import * as db from "./db.js";
import * as puantaj from "./puantaj.js";
import * as odeme from "./odeme.js";
import * as kontrat from "./kontrat.js";
import { evHesap, kisininProjesi } from "./iliskiler.js";

const bul = (tablo, kod) => (kod ? db.satirBul(tablo, (x) => x.kod === kod) : null);
const haftaGunu = (gun) => puantaj.GUN_KISA[new Date(`${gun}T00:00:00Z`).getUTCDay()];

export function gorunum(personelKod) {
  const kisi = bul("personel", personelKod);
  if (!kisi) throw new Error(`"${personelKod}" kodlu personel bulunamadı.`);

  const ekip = bul("ekip", kisi.ekip);
  const ev = bul("ev", kisi.ev);
  const proje = bul("proje", kisininProjesi(kisi));
  const evH = ev ? evHesap(ev) : null;

  const donemler = [];
  for (const p of puantaj.tumDonemler()) {
    const s = p.satirlar.find((x) => x.personelKod === personelKod);
    if (!s) continue;
    const i = p.satirlar.indexOf(s);
    const h = puantaj.hesapla(p).satirlar[i];            // aySonu ve ilkYariNet için dönemin tamamı
    const { gunluk } = puantaj.satirHesapla(p, s);
    const ekipAdi = (kod) => p.ekipler[kod]?.ad || kod;
    const d = puantaj.donemCoz(p.donem);
    const avansKayit = db.tablo("avans")
      .filter((a) => a.personelKod === personelKod && a.tarih >= d.gunler[0] && a.tarih <= d.gunler.at(-1))
      .map((a) => ({ tarih: a.tarih, tutar: Number(a.tutar) || 0, paraBirimi: a.paraBirimi || "EUR" }))
      .sort((a, b) => a.tarih.localeCompare(b.tarih));

    donemler.push({
      donem: p.donem, ad: puantaj.donemAdi(p.donem), yari: d.yari, durum: p.durum, kural: h.kural,
      ekip: s.ekip ? { kod: s.ekip, ad: ekipAdi(s.ekip) } : null,
      odemeTuru: s.odemeTuru, ucret: s.ucret, paraBirimi: h.paraBirimi,
      // Gün gün: n/m normal ve mesai saati (seçilen tarih aralığının toplamları bundan hesaplanır).
      gunler: gunluk.map((g) => {
        const disi = g.girisOncesi || g.kontratDisi;
        return {
          gun: g.gun, hg: haftaGunu(g.gun), tip: p.gunler[g.gun] || "normal", deger: s.hucre[g.gun] || "",
          n: g.n, m: g.m,
          // Kural 1 dönemlerinin gün dökümünde "gelmedi" işareti yok; hücreden okunur.
          gelmedi: !disi && (Boolean(g.gelmedi) || s.hucre[g.gun] === "–"),
          girisOncesi: Boolean(g.girisOncesi), kontratDisi: Boolean(g.kontratDisi),
          baskaEkip: g.ekip && g.ekip !== s.ekip ? ekipAdi(g.ekip) : "",
        };
      }),
      toplam: h.toplam, normal: h.normal, mesai: h.mesai, calisilanGun: h.calisilanGun,
      izin: h.izin, rapor: h.rapor, gelmedi: h.gelmedi,
      tabanUcret: h.tabanUcret, mesaiBirim: h.mesaiBirim, mesaiTutar: h.mesaiTutar, hakedis: h.hakedis,
      kesinti: h.kesinti, kesintiKalem: h.kesintiKalem || null, kesintiDetay: h.kesintiDetay, kesintiDisi: h.kesintiDisi,
      avans: avansKayit, avansDusulen: h.avansDusulen, avansCevrilen: h.avansCevrilen || [],
      net: h.net, aySonu: h.aySonu || null, ilkYariNet: h.ilkYariNet || null,
      kur: h.kur || null,
    });
  }

  // Ödemeler: maaş / saatlik ücret / yemek parası; ödendi mi, ne zaman. `donem` anahtardan (yemek:<dönem>:…).
  const donemi = (anahtar) => String(anahtar || "").split(":")[1] || null;
  const kayit = new Map((db.tablo("odeme") || []).map((r) => [r.anahtar, r]));
  const tumKalem = odeme.kalemler();
  const odemeler = tumKalem
    .filter((k) => k.personelKod === personelKod)
    .map((k) => {
      const r = kayit.get(k.anahtar);
      return { tur: k.tur, donem: donemi(k.anahtar), aciklama: k.aciklama, vade: k.vade, tutar: k.tutar, paraBirimi: k.paraBirimi,
        odendi: Boolean(r), odemeTarihi: r?.tarih || null, odenen: r ? Number(r.tutar) : null };
    });
  // Kalemi artık hesaplanmayan ama ödenmiş kayıtlar da görünür.
  const gorulen = new Set(tumKalem.map((k) => k.anahtar));
  for (const r of db.tablo("odeme") || []) {
    if (r.personelKod !== personelKod || gorulen.has(r.anahtar)) continue;
    odemeler.push({ tur: r.tur, donem: donemi(r.anahtar), aciklama: r.aciklama, vade: r.vade, tutar: r.sistemTutar, paraBirimi: r.paraBirimi,
      odendi: true, odemeTarihi: r.tarih, odenen: Number(r.tutar) });
  }
  odemeler.sort((a, b) => b.vade.localeCompare(a.vade) || a.tur.localeCompare(b.tur));

  return {
    kisi: {
      _id: kisi._id, kod: kisi.kod, ad: kisi.ad, gorev: kisi.gorev || "", durum: kisi.durum || "",
      odemeTuru: kisi.odemeTuru || "", ucret: kisi.ucret || "", paraBirimi: kisi.paraBirimi || "EUR",
      iseGiris: kisi.iseGiris || "",
      belgeler: [
        ["Çalışma izni", kisi.calismaIzniBitis], ["Oturma izni", kisi.oturmaIzniBitis], ["Pasaport", kisi.pasaportBitis],
      ].filter(([, t]) => t).map(([ad, bitis]) => ({ ad, bitis })),
    },
    ekip: ekip ? { kod: ekip.kod, ad: ekip.ad, yemekGunluk: Number(ekip.yemekGunluk) || 0, yemekPB: ekip.yemekParaBirimi || "EUR" } : null,
    proje: proje ? { kod: proje.kod, ad: proje.ad } : null,
    ev: ev ? {
      kod: ev.kod, ad: ev.ad, adres: [ev.adres, ev.sehir].filter(Boolean).join(", "),
      kisi: evH.kisiSayisi, kisiBasiKira: evH.kisiBasiKira, kisiBasiGunluk: evH.kisiBasiGunluk, paraBirimi: evH.paraBirimi,
    } : null,
    // Çalışma dönemleri (kontratlar); yönetici notu girmez.
    calisma: kontrat.kisininKayitlari(personelKod).map((r) => ({
      tur: r.tur || "Çalışma", baslangic: r.baslangic, bitis: r.bitis || "", durum: kontrat.kayitDurumu(r),
      proje: r.proje ? bul("proje", r.proje)?.ad || r.proje : "",
    })).reverse(),
    donemler: donemler.reverse(),
    odemeler,
    olusturma: new Date().toISOString(),
  };
}
