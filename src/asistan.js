/**
 * Sesli komut: konuşulan cümleyi KADRO kayıtlarına çevirir.
 *
 *   ses   → n8n /webhook/kadro/transcribe (Groq Whisper) → metin
 *   metin → n8n /webhook/kadro/assist (DeepSeek, araç çağırma) → araçlar BURADA çalışır
 *
 * Okuma araçları (puantaj, ödeme, kasa, avans sorguları) hemen çalışır ve sonucu modele döner.
 * Yazma araçları hiçbir şey yazmaz: doğrulanır ve ONAY KARTI olur. Kayıt, kullanıcı karttaki
 * Onayla'ya basınca programın normal doğrulamalarıyla yazılır; her onaylanan işlem "asistan"
 * günlüğüne düşer ve geri alınabilir. Silme, sıfırlama, maaş değişikliği ve dönem kapatma için araç yok.
 *
 * Model anahtarları (Groq, DeepSeek) bu bilgisayara hiç gelmez, n8n'de durur. Burada sadece n8n adresi
 * ve KADRO'ya verilmiş X-Api-Key saklanır; anahtar yedeğe girmez (bkz. db.disaAktar).
 *
 * Modele giden veri: personel, ekip, ev ve proje adları ile araçların döndürdüğü puantaj, avans, ödeme
 * ve kasa özetleri. IBAN, telefon, pasaport ve notlar hiçbir araçtan dönmez.
 *
 * Sunucu çağrısı az tutulur (n8n kapısı kişi başı günde 100 istek sayar): komut sadece geçerli yazma
 * araçlarından oluşuyorsa model ikinci kez çağrılmaz, cevabı burası kurar. Okuma ya da hata varsa
 * sonuçlar modele geri gider.
 */
import fs from "node:fs";
import sea from "node:sea";
import * as db from "./db.js";
import * as puantaj from "./puantaj.js";
import * as odeme from "./odeme.js";
import * as kasa from "./kasa.js";
import * as calisan from "./calisan.js";
import * as kontrat from "./kontrat.js";
import * as kayit from "./asistan-kayit.js";
import { KASA_KATEGORI } from "./tablolar.js";

const PARA_BIRIMLERI = ["EUR", "TRY", "RSD"];
const GUN_ADI = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const MAKS_TUR = 4;                 // bir komutta modele en fazla bu kadar gidilir
const KONUSMA_OMRU = 30 * 60_000;   // takip sorusu ("Mehmet Kılıç olan") bu süre içinde anlaşılır
const KART_OMRU = 60 * 60_000;

const pad = (n) => String(n).padStart(2, "0");
const yuvarla = (n) => Math.round(n * 100) / 100;
const sayi = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const yerelGun = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tarihMetni = (g) => {
  const d = new Date(`${g}T00:00:00Z`);
  return `${d.getUTCDate()} ${puantaj.AYLAR[d.getUTCMonth()]} ${GUN_ADI[d.getUTCDay()]}`;
};
const paraMetni = (n, pb) => `${Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ${pb}`;
const yeniId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** server.js'deki tablo işlemleri (satır hazırlama, kasa eşitleme, klasör) buraya bağlanır. */
let islem = null;
export function baglan(tabloIslemleri) { islem = tabloIslemleri; }

/** Komut kaydı (bkz. asistan-kayit.js): yerel arşiv + n8n kadro/log ucu. */
let surum = "";
export function kayitBaslat(veriDizini, programSurumu) {
  surum = programSurumu;
  kayit.baslat(veriDizini, (kayitlar) => n8n("kadro/log", { kayitlar }));
}
export const kayitDurumu = () => kayit.durum();
export const kayitGonder = () => kayit.gonder(true);
const kayitBasi = (tip) => ({ id: yeniId(), tip, zaman: new Date().toISOString(), surum, kullanici: db.ayarlar().kullanici || "" });
/** Kart olayı: onay, vazgeç, geri alma, süresi dolma. komutId ile komut kaydına bağlanır. */
const olayYaz = (olay, k, ek = {}) => kayit.yaz({ ...kayitBasi("olay"), olay, komutId: k.komutId || null, kartId: k.kartId || k.id || null,
  arac: k.arac || null, baslik: k.baslik || null, satirlar: k.satirlar || null, ...ek });

/* ------------------------------------------------------------------ */
/* Bağlantı                                                            */
/* ------------------------------------------------------------------ */

/** Ayarlarda adres boşsa kullanılır; müşteri yalnızca anahtarı girer. Sunucu taşınınca burası değişir. */
export const VARSAYILAN_ADRES = "https://n8n.example.com";

/** `paketle.mjs --asistan-anahtari` ile exe'ye gömülen anahtar: müşteri hiçbir şey girmeden sesli komut açılır. */
const GOMULU_ANAHTAR = (() => {
  try { return sea.isSea() ? Buffer.from(sea.getAsset("asistan-anahtari.txt")).toString("utf8").trim() : ""; } catch { return ""; }
})();
export const gomuluAnahtarVar = Boolean(GOMULU_ANAHTAR);

export function ayar() {
  const a = db.ayarlar();
  const adres = String(process.env.KADRO_ASISTAN_ADRES || a.asistanAdres || VARSAYILAN_ADRES).trim().replace(/\/+$/, "");
  const anahtar = String(process.env.KADRO_ASISTAN_ANAHTARI || a.asistanAnahtari || GOMULU_ANAHTAR).trim();
  return { adres, anahtar, hazir: Boolean(adres && anahtar) };
}

// n8n kapısı makine kodu döndürür; cümle burada kurulur.
const HATA_KODU = {
  bad_key: () => "Asistan anahtarı reddedildi. Ayarlar'daki anahtarı kontrol edin.",
  no_keys: () => "Asistan sunucusunda anahtar listesi tanımlı değil.",
  rate_min: (v) => `Çok hızlı: dakikada en fazla ${v.limit} istek. Biraz bekleyip tekrar deneyin.`,
  rate_day: (v) => `Bugünkü asistan sınırı doldu (${v.limit} istek). Yarın sıfırlanır.`,
  model_empty: () => "Model boş yanıt verdi. Tekrar deneyin.",
};

async function n8n(yol, govde) {
  const { adres, anahtar, hazir } = ayar();
  if (!hazir) throw new Error("Sesli komut kurulmamış: Ayarlar'dan asistan adresini ve anahtarını girin.");
  const form = govde instanceof FormData;
  let y;
  try {
    y = await fetch(`${adres}/webhook/${yol}`, {
      method: "POST",
      headers: { "X-Api-Key": anahtar, ...(form ? {} : { "Content-Type": "application/json" }) },
      body: form ? govde : JSON.stringify(govde),
      signal: AbortSignal.timeout(130_000),
    });
  } catch (e) {
    throw new Error(`Asistan sunucusuna ulaşılamadı (${e.cause?.code || e.name}). İnternet bağlantısını kontrol edin.`);
  }
  const metin = await y.text();
  let v = null;
  try { v = JSON.parse(metin); } catch {}
  if (v?.error_code && HATA_KODU[v.error_code]) throw new Error(HATA_KODU[v.error_code](v));
  if (y.status === 404) throw new Error(`Asistan sunucusunda "${yol}" ucu yok ya da etkin değil.`);
  if (!y.ok) throw new Error(v?.error || v?.message || `Asistan sunucusu hata verdi (${y.status}).`);
  if (!v) throw new Error("Asistan sunucusunun yanıtı okunamadı.");
  if (v.error) throw new Error(v.error);
  return v;
}

/* ------------------------------------------------------------------ */
/* Bağlam: modelin isimleri ve kodları eşleştirebilmesi için            */
/* ------------------------------------------------------------------ */

const aktifPersonel = () => db.tablo("personel").filter((p) => p.durum !== "Ayrıldı");

function kisiAl(kod) {
  const k = db.satirBul("personel", (x) => x.kod === String(kod || "").trim());
  if (!k) throw new Error(`"${kod}" kodlu personel yok. Listeden doğru kodu seç ya da kullanıcıya sor.`);
  return k;
}

function tarihAl(t, varsayilan = yerelGun()) {
  const g = String(t || "").trim() || varsayilan;
  if (!TARIH.test(g) || Number.isNaN(new Date(`${g}T00:00:00Z`).getTime())) throw new Error(`Tarih geçersiz: "${t}". YYYY-AA-GG yaz.`);
  return g;
}

function sistemMetni() {
  const bugun = yerelGun();
  const ekip = new Map(db.tablo("ekip").map((e) => [e.kod, e]));
  const ev = new Map(db.tablo("ev").map((e) => [e.kod, e]));
  const kisiler = aktifPersonel().map((p) => [
    p.kod, p.ad,
    p.ekip ? `ekip ${p.ekip} ${ekip.get(p.ekip)?.ad || ""}`.trim() : "ekipsiz",
    p.ev ? `ev ${p.ev}` : "",
    p.odemeTuru || "", p.paraBirimi || "EUR", p.durum === "İzinli" ? "İZİNLİ" : "",
  ].filter(Boolean).join(" | "));
  const ekipler = db.tablo("ekip").filter((e) => e.durum !== "Pasif").map((e) => `${e.kod} ${e.ad}${e.proje ? ` (proje ${e.proje})` : ""}`);
  const evler = db.tablo("ev").filter((e) => e.durum !== "Boşaltıldı").map((e) => `${e.kod} ${e.ad}${e.sehir ? `, ${e.sehir}` : ""}`);
  const projeler = db.tablo("proje").filter((p) => ["Devam Ediyor", "Teklif"].includes(p.durum)).map((p) => `${p.kod} ${p.ad}`);
  const donemler = puantaj.tumDonemler().slice(-4).map((p) => `${p.donem} = ${puantaj.donemAdi(p.donem)} (${p.durum === "kapali" ? "KAPALI" : "açık"})`);

  return [
    "ACME MÜHENDİSLİK'in personel, puantaj ve kasa programının asistanısın. Kullanıcı (yönetici) sana sesle konuşuyor;",
    "cümleler ses tanımadan geliyor, isimler yanlış yazılmış olabilir. Cevabın kısa, sade Türkçe ve sesli okunabilir olmalı.",
    "",
    `Bugün: ${bugun} ${GUN_ADI[new Date(`${bugun}T00:00:00Z`).getUTCDay()]}. "Bugün", "dün", "pazartesi", "geçen cuma" gibi ifadeleri buna göre çöz.`,
    "Haftanın günü belirtilip tarih verilmezse en yakın GEÇMİŞ günü kastediyordur (bugün dahil).",
    "",
    "KURALLAR",
    "1. Kullanıcı bir kayıt eklemek ya da değiştirmek istediğinde ilgili YAZMA aracını hemen çağır. Yazma araçları hiçbir şeyi",
    "   değiştirmez, kullanıcıya bir ONAY KARTI gösterir. Önce 'yapayım mı' diye sorma; kartın kendisi o sorudur.",
    "   Araçtan sonra asla 'yaptım/ekledim/yazdım' deme; 'onaylarsanız yazılacak' de.",
    "2. İsimleri aşağıdaki PERSONEL listesinden eşleştir ve araçlara KODU ver. Ses tanıma hatalarını hoş gör",
    "   (Yigit = Yiğit, Mehmed = Mehmet). Birden çok kişi uyuyorsa ya da hiç uymuyorsa TAHMİN ETME: adaylarıyla birlikte sor.",
    "   Kullanıcı bir ekibin tamamını söylüyorsa ('1. ekip', 'Montaj ekibi') o ekipteki herkes için yaz.",
    "3. Puantaj değeri: çalışılan saat sayısı ('8', '10.5'); 'İ' izin; 'R' rapor; '–' gelmedi; '' (boş) hücreyi temizler.",
    "   'gelmedi', 'yoktu', 'işe gelmedi' = '–'. 'izinli' = 'İ'. 'raporlu', 'hasta raporu' = 'R'.",
    "   'tam gün', 'normal' = 8. Saat söylenmeden 'çalıştı/geldi' denirse 8 yaz.",
    "   Bir kişinin birden çok günü ya da birden çok kişi tek puantaj_yaz çağrısında gönderilir.",
    "4. Para birimi söylenmezse avans için kişinin para birimini, kasa için EUR kullan. 'dinar' = RSD, 'lira' = TRY, 'euro/avro' = EUR.",
    "5. Sorulara cevap vermeden önce ilgili OKUMA aracını çağır; elindeki veri dışında rakam uydurma.",
    "6. Yapamadıkların: kayıt silmek, maaş/ücret değiştirmek, puantaj dönemi açmak/kapatmak, ayarlar, sıfırlama, belge işlemleri.",
    "   Bunlar istenirse 'bunu ekrandan yapmalısınız' de. Personel ekip/ev/görev/durum değişikliği yapabilirsin.",
    "7. Tek cümlede birden çok iş varsa hepsi için araç çağır; kullanıcı her kartı ayrı onaylar.",
    "8. Bir araç HATA döndürürse sebebini kullanıcıya kısaca söyle; düzeltilebiliyorsa düzeltip tekrar dene.",
    "9. Açıklama ve not alanlarına kullanıcının söylemediği bir şey yazma; söylemediyse boş bırak (kasa_ekle açıklaması hariç: orada kısa yaz).",
    "10. Avans için avans_ekle kullan, kasa_ekle değil (avans kasaya kendiliğinden düşer).",
    "    Maaş, yemek parası ve kira ödemesi için odeme_isaretle kullan (önce odeme_listesi ile anahtarı bul).",
    "",
    `PUANTAJ DÖNEMLERİ (son açılanlar): ${donemler.join("; ") || "yok"}`,
    "",
    "PERSONEL (kod | ad | ekip | ev | ödeme türü | para birimi):",
    ...(kisiler.length ? kisiler : ["(kayıt yok)"]),
    "",
    `EKİPLER: ${ekipler.join("; ") || "yok"}`,
    `EVLER: ${evler.join("; ") || "yok"}`,
    `PROJELER: ${projeler.join("; ") || "yok"}`,
    `KASA KATEGORİLERİ: ${KASA_KATEGORI.join(", ")}`,
  ].join("\n");
}

/** Whisper'a ipucu: isimleri doğru yazsın diye. Uzun ipucu kesilir (Whisper ~224 token okur). */
function isimIpucu() {
  let metin = "KADRO puantaj, avans, kasa.";
  for (const p of aktifPersonel()) {
    if (metin.length + p.ad.length > 420) break;
    metin += ` ${p.ad},`;
  }
  return metin.replace(/,$/, ".");
}

/* ------------------------------------------------------------------ */
/* Araçlar                                                             */
/* ------------------------------------------------------------------ */

const degerMetni = (v) => ({ "–": "gelmedi", "İ": "izin", R: "rapor", "": "boş" }[v] ?? `${String(v).replace(".", ",")} saat`);

const nesne = (ozellik, zorunlu = []) => ({ type: "object", properties: ozellik, required: zorunlu });
const metin = (aciklama, ek = {}) => ({ type: "string", description: aciklama, ...ek });
const kodAlani = metin("Personel kodu, PERSONEL listesinden (ör. KDR-2026-0001).");

const ARACLAR = {
  /* ---------------- okuma ---------------- */

  puantaj_oku: {
    aciklama: "Puantajı okur. personelKod verilirse o kişinin dönemdeki günleri; gun verilirse o gün herkesin değeri; " +
      "ikisi de yoksa dönemdeki herkesin özet saatleri. Dönem verilmezse gun'ün (yoksa bugünün) dönemi.",
    sema: nesne({
      personelKod: kodAlani,
      gun: metin("YYYY-AA-GG"),
      donem: metin("Dönem kimliği, ör. 2026-10-2 (ayın 16'sından sonrası 2, öncesi 1)."),
    }),
    oku({ personelKod, gun, donem }) {
      const g = gun ? tarihAl(gun) : null;
      const d = donem ? puantaj.donemCoz(donem).donem : puantaj.tarihDonemi(g || yerelGun());
      const p = puantaj.bul(d);
      if (!p) return `${puantaj.donemAdi(d)} puantajı henüz açılmadı.`;
      const h = puantaj.hesapla(p);
      const bas = `${puantaj.donemAdi(d)} — ${p.durum === "kapali" ? "KAPALI" : "açık"}`;
      if (personelKod) {
        const i = p.satirlar.findIndex((s) => s.personelKod === personelKod);
        if (i < 0) return `${kisiAl(personelKod).ad} bu dönemde yok.`;
        const s = p.satirlar[i], hs = h.satirlar[i];
        const gunler = puantaj.donemCoz(d).gunler.map((x) => `${x.slice(8)} ${GUN_ADI[new Date(`${x}T00:00:00Z`).getUTCDay()].slice(0, 3)}: ${s.hucre[x] ? degerMetni(s.hucre[x]) : "girilmedi"}`);
        return `${bas}\n${s.ad}: toplam ${hs.toplam} saat (mesai ${hs.mesai}), gelmedi ${hs.gelmedi} gün, izin ${hs.izin}, rapor ${hs.rapor}.\n${gunler.join("\n")}`;
      }
      if (g) {
        return `${bas}\n${tarihMetni(g)}:\n${p.satirlar.map((s) => `${s.personelKod} ${s.ad}: ${s.hucre[g] ? degerMetni(s.hucre[g]) : "girilmedi"}`).join("\n")}`;
      }
      return `${bas}\n${p.satirlar.map((s, i) => {
        const hs = h.satirlar[i];
        const bos = Object.keys(s.hucre).length;
        return `${s.personelKod} ${s.ad}: ${hs.toplam} saat, gelmedi ${hs.gelmedi}, izin ${hs.izin}, rapor ${hs.rapor}, dolu gün ${bos}`;
      }).join("\n")}`;
    },
  },

  kisi_ozeti: {
    aciklama: "Bir çalışanın son dönemlerdeki hakedişi, kesintileri, avansları, net/ay sonu alacağı ve ödemeleri (ödendi mi).",
    sema: nesne({ personelKod: kodAlani }, ["personelKod"]),
    oku({ personelKod }) {
      const v = calisan.gorunum(kisiAl(personelKod).kod);
      const pm = (t) => Object.entries(t || {}).map(([pb, n]) => paraMetni(n, pb)).join(" + ") || "0";
      return JSON.stringify({
        kisi: `${v.kisi.ad} · ${v.kisi.gorev || ""} · ${v.kisi.odemeTuru} ${v.kisi.ucret} ${v.kisi.paraBirimi}`,
        ekip: v.ekip?.ad || null, ev: v.ev?.ad || null,
        donemler: v.donemler.slice(0, 2).map((d) => ({
          donem: d.ad, durum: d.durum === "kapali" ? "kapalı" : "açık",
          saat: d.toplam, mesai: d.mesai, gelmediGun: d.gelmedi, izin: d.izin, rapor: d.rapor,
          hakedis: pm(d.hakedis), kesinti: pm(d.kesinti),
          avans: d.avans.map((a) => `${a.tarih} ${paraMetni(a.tutar, a.paraBirimi)}`),
          net: pm(d.net), aySonuAlacak: d.aySonu ? pm(d.aySonu) : null,
        })),
        odemeler: v.odemeler.slice(0, 6).map((o) => `${o.vade} ${o.aciklama}: ${paraMetni(o.tutar, o.paraBirimi)} — ` +
          (o.odendi ? `ödendi ${o.odemeTarihi} (${paraMetni(o.odenen, o.paraBirimi)})` : "ödenmedi")),
      });
    },
  },

  odeme_listesi: {
    aciklama: "Ödeme kalemleri (maaş, saatlik ücret, yemek parası, ev kirası): anahtar, kim, tutar, vade, ödendi mi. " +
      "odeme_isaretle için anahtar buradan alınır.",
    sema: nesne({
      ay: metin("Vade ayı, YYYY-AA. Verilmezse bu ay."),
      personelKod: kodAlani,
      sadeceOdenmemis: { type: "boolean" },
    }),
    oku({ ay, personelKod, sadeceOdenmemis }) {
      const v = odeme.ay(ay || kasa.buAy());
      const kalem = v.gunler.flatMap((g) => g.gruplar.flatMap((gr) => gr.kalemler))
        .filter((k) => !personelKod || k.personelKod === personelKod)
        .filter((k) => !sadeceOdenmemis || !k.odendi);
      if (!kalem.length) return `${kasa.ayAdi(v.ay)} için uygun ödeme kalemi yok.`;
      return kalem.map((k) => `anahtar=${k.anahtar} | ${k.kim} | ${k.aciklama} | ${paraMetni(k.tutar, k.paraBirimi)} | vade ${k.vade} | ` +
        (k.odendi ? `ödendi ${k.odeme.tarih} (${paraMetni(k.odeme.tutar, k.paraBirimi)})` : "ödenmedi")).join("\n");
    },
  },

  kasa_ozeti: {
    aciklama: "Bir ayın kasası: gelir, gider, net, bakiye, kategoriler ve son hareketler.",
    sema: nesne({ ay: metin("YYYY-AA. Verilmezse bu ay.") }),
    oku({ ay }) {
      const v = kasa.ay(ay || kasa.buAy());
      const pm = (t) => Object.entries(t || {}).map(([pb, n]) => paraMetni(n, pb)).join(" + ") || "0";
      return JSON.stringify({
        ay: v.ad, gelir: pm(v.ozet.gelir), gider: pm(v.ozet.gider), net: pm(v.ozet.net), bakiye: pm(v.ozet.bakiye),
        kategoriler: v.ozet.kategoriler.map((k) => `${k.tur} ${k.kategori}: ${pm(k.tutar)}`),
        sonHareketler: v.satirlar.slice(-15).map((r) => `${r.tarih} ${r.tur} ${r.kategori || ""} ${paraMetni(r.tutar, r.paraBirimi)} ${r.aciklama || ""}`.trim()),
      });
    },
  },

  avans_listesi: {
    aciklama: "Verilen avanslar. personelKod ve/veya ay (YYYY-AA) ile süzülür.",
    sema: nesne({ personelKod: kodAlani, ay: metin("YYYY-AA") }),
    oku({ personelKod, ay }) {
      const ad = new Map(db.tablo("personel").map((p) => [p.kod, p.ad]));
      const liste = db.tablo("avans")
        .filter((a) => (!personelKod || a.personelKod === personelKod) && (!ay || String(a.tarih).startsWith(ay)))
        .sort((a, b) => String(a.tarih).localeCompare(String(b.tarih))).slice(-40);
      if (!liste.length) return "Uygun avans kaydı yok.";
      return liste.map((a) => `${a.tarih} | ${ad.get(a.personelKod) || a.personelKod} | ${paraMetni(sayi(a.tutar), a.paraBirimi || "EUR")} | ${a.aciklama || ""}`).join("\n");
    },
  },

  /* ---------------- yazma: hazırla → kart, uygula → kayıt, geriAl ---------------- */

  puantaj_yaz: {
    aciklama: "Puantaj hücrelerini yazar (onay kartı açar). Değer: saat sayısı, 'İ' izin, 'R' rapor, '–' gelmedi, '' temizle.",
    sema: nesne({
      degisiklikler: {
        type: "array",
        items: nesne({ personelKod: kodAlani, gun: metin("YYYY-AA-GG"), deger: metin("8, 10.5, İ, R, – ya da boş") }, ["personelKod", "gun", "deger"]),
      },
    }, ["degisiklikler"]),
    hazirla({ degisiklikler }) {
      if (!Array.isArray(degisiklikler) || !degisiklikler.length) throw new Error("degisiklikler boş.");
      const tekil = new Map();
      for (const d of degisiklikler) {
        const kisi = kisiAl(d.personelKod);
        const gun = tarihAl(d.gun);
        const donem = puantaj.tarihDonemi(gun);
        const p = puantaj.bul(donem);
        if (!p) throw new Error(`${puantaj.donemAdi(donem)} puantajı henüz açılmadı; önce ekrandan dönemi açın.`);
        if (p.durum === "kapali") throw new Error(`${puantaj.donemAdi(donem)} kapalı; sesle değiştirilemez.`);
        const s = p.satirlar.find((x) => x.personelKod === kisi.kod);
        if (!s) throw new Error(`${kisi.ad}, ${puantaj.donemAdi(donem)} puantajında yok.`);
        tekil.set(`${kisi.kod}|${gun}`, { donem, personelKod: kisi.kod, ad: kisi.ad, gun, deger: puantaj.degerNormalize(d.deger), eski: s.hucre[gun] || "" });
      }
      const veri = [...tekil.values()].sort((a, b) => a.gun.localeCompare(b.gun) || a.ad.localeCompare(b.ad, "tr"));
      const degismeyen = veri.filter((v) => v.eski === v.deger).length;
      return {
        baslik: veri.length === 1 ? "Puantaj" : `Puantaj · ${veri.length} hücre`,
        satirlar: veri.map((v) => `${v.ad} · ${tarihMetni(v.gun)} · ${v.eski && v.eski !== v.deger ? `${degerMetni(v.eski)} → ` : ""}${degerMetni(v.deger)}`),
        not: degismeyen ? `${degismeyen} hücre zaten bu değerde.` : "",
        veri,
      };
    },
    uygula(veri) {
      const donemler = Map.groupBy(veri, (v) => v.donem);
      const eski = [];
      for (const [donem, liste] of donemler) {
        const p = puantaj.al(donem);
        for (const v of liste) eski.push({ donem, personelKod: v.personelKod, gun: v.gun, deger: p.satirlar.find((s) => s.personelKod === v.personelKod).hucre[v.gun] || "", yeni: v.deger });
      }
      for (const [donem, liste] of donemler) puantaj.hucreYaz(donem, liste.map(({ personelKod, gun, deger }) => ({ personelKod, gun, deger })));
      return { geri: { eski } };
    },
    geriAl({ eski }) {
      for (const [donem, liste] of Map.groupBy(eski, (v) => v.donem)) {
        const p = puantaj.al(donem);
        for (const v of liste) {
          const su = p.satirlar.find((s) => s.personelKod === v.personelKod)?.hucre[v.gun] || "";
          if (su !== v.yeni) throw new Error(`${v.gun} günündeki hücre sonradan değişmiş (${degerMetni(su)}); elle düzeltin.`);
        }
        puantaj.hucreYaz(donem, liste.map(({ personelKod, gun, deger }) => ({ personelKod, gun, deger })));
      }
    },
  },

  avans_ekle: {
    aciklama: "Personele verilen avansı kaydeder (onay kartı açar). Avans tarihine göre puantaj döneminde maaştan düşülür.",
    sema: nesne({
      personelKod: kodAlani,
      tutar: { type: "number" },
      paraBirimi: metin("EUR, TRY ya da RSD", { enum: PARA_BIRIMLERI }),
      tarih: metin("YYYY-AA-GG; verilmezse bugün"),
      aciklama: metin("Sadece kullanıcı bir not söylediyse; yoksa boş bırak, uydurma."),
    }, ["personelKod", "tutar"]),
    hazirla({ personelKod, tutar, paraBirimi, tarih, aciklama }) {
      const kisi = kisiAl(personelKod);
      const n = sayi(tutar);
      if (!(n > 0)) throw new Error("Avans tutarı sıfırdan büyük olmalı.");
      const pb = paraBirimi || kisi.paraBirimi || "EUR";
      if (!PARA_BIRIMLERI.includes(pb)) throw new Error(`Para birimi geçersiz: ${pb}`);
      const t = tarihAl(tarih);
      const veri = { personelKod: kisi.kod, tutar: yuvarla(n), paraBirimi: pb, tarih: t, aciklama: String(aciklama || "").trim() };
      return {
        baslik: "Avans",
        satirlar: [`${kisi.ad} · ${paraMetni(veri.tutar, pb)} · ${tarihMetni(t)}${veri.aciklama ? ` · ${veri.aciklama}` : ""}`],
        not: `${puantaj.donemAdi(puantaj.tarihDonemi(t))} hakedişinden düşülür.`,
        veri,
      };
    },
    uygula(veri) {
      const { satir } = islem.ekle("avans", veri);
      return { geri: { id: satir._id } };
    },
    geriAl({ id }) {
      if (!db.satirBul("avans", (x) => x._id === id)) throw new Error("Avans kaydı artık yok.");
      islem.sil("avans", id);
    },
  },

  kasa_ekle: {
    aciklama: "Kasaya elle gelir ya da gider yazar (onay kartı açar). Yakıt, malzeme, fatura, hakediş gibi hareketler için. " +
      "Avans, maaş, yemek parası ve kira için KULLANMA.",
    sema: nesne({
      tur: metin("Gelir ya da Gider", { enum: ["Gelir", "Gider"] }),
      kategori: metin("KASA KATEGORİLERİ listesinden", { enum: KASA_KATEGORI }),
      tutar: { type: "number" },
      paraBirimi: metin("EUR, TRY ya da RSD", { enum: PARA_BIRIMLERI }),
      tarih: metin("YYYY-AA-GG; verilmezse bugün"),
      aciklama: metin("Ne için"),
      proje: metin("Proje kodu (varsa)"),
      personelKod: kodAlani,
    }, ["tur", "tutar", "aciklama"]),
    hazirla({ tur, kategori, tutar, paraBirimi, tarih, aciklama, proje, personelKod }) {
      if (!["Gelir", "Gider"].includes(tur)) throw new Error('Tür "Gelir" ya da "Gider" olmalı.');
      if (kategori && !KASA_KATEGORI.includes(kategori)) throw new Error(`Kategori listede yok: ${kategori}`);
      if (["Avans", "Maaş", "Yemek", "Kira"].includes(kategori)) throw new Error(`${kategori} kasaya elle yazılmaz: avans için avans_ekle, ödemeler için odeme_isaretle kullan.`);
      const n = sayi(tutar);
      if (!(n > 0)) throw new Error("Tutar sıfırdan büyük olmalı.");
      const pb = paraBirimi || "EUR";
      if (!PARA_BIRIMLERI.includes(pb)) throw new Error(`Para birimi geçersiz: ${pb}`);
      const p = proje ? db.satirBul("proje", (x) => x.kod === proje) : null;
      if (proje && !p) throw new Error(`"${proje}" kodlu proje yok.`);
      const kisi = personelKod ? kisiAl(personelKod) : null;
      const veri = {
        tarih: tarihAl(tarih), tur, kategori: kategori || "", tutar: yuvarla(n), paraBirimi: pb,
        aciklama: String(aciklama || "").trim(), proje: p?.kod || "", personelKod: kisi?.kod || "", tekrar: "Hayır",
      };
      if (!veri.aciklama) throw new Error("Açıklama boş olamaz.");
      return {
        baslik: `Kasa · ${tur}`,
        satirlar: [
          `${paraMetni(veri.tutar, pb)} · ${tarihMetni(veri.tarih)}${veri.kategori ? ` · ${veri.kategori}` : ""}`,
          veri.aciklama + (p ? ` · ${p.ad}` : "") + (kisi ? ` · ${kisi.ad}` : ""),
        ],
        veri,
      };
    },
    uygula(veri) {
      const { satir } = islem.ekle("kasa", veri);
      return { geri: { id: satir._id } };
    },
    geriAl({ id }) {
      if (!db.satirBul("kasa", (x) => x._id === id)) throw new Error("Kasa satırı artık yok.");
      islem.sil("kasa", id);
    },
  },

  odeme_isaretle: {
    aciklama: "Bir ödeme kalemini (maaş, saatlik ücret, yemek parası, kira) 'ödendi' işaretler (onay kartı açar). " +
      "Anahtarı odeme_listesi'nden al. Tutar verilmezse hesaplanan tutar ödenmiş sayılır.",
    sema: nesne({
      anahtar: metin("odeme_listesi'ndeki anahtar"),
      tarih: metin("Ödeme tarihi YYYY-AA-GG; verilmezse bugün"),
      tutar: { type: "number", description: "Gerçekte ödenen tutar (hesaplanandan farklıysa)" },
      not: metin("Kısa not"),
    }, ["anahtar"]),
    hazirla({ anahtar, tarih, tutar, not }) {
      const mevcut = (db.tablo("odeme") || []).find((r) => r.anahtar === anahtar);
      const k = odeme.kalemler().find((x) => x.anahtar === anahtar) || (mevcut && { ...mevcut, tutar: mevcut.sistemTutar });
      if (!k) throw new Error(`Ödeme kalemi bulunamadı: ${anahtar}. Önce odeme_listesi çağır.`);
      const t = tarihAl(tarih);
      const n = tutar === undefined || tutar === null || tutar === "" ? k.tutar : sayi(tutar);
      if (!(n >= 0)) throw new Error("Ödenen tutar geçersiz.");
      const veri = { anahtar, tarih: t, tutar: yuvarla(n), not: String(not || "").trim() };
      const notlar = [];
      if (veri.tutar !== k.tutar) notlar.push(`Hesaplanan tutar ${paraMetni(k.tutar, k.paraBirimi)}; fark Ödemeler ekranında görünür.`);
      if (mevcut) notlar.push(`Zaten ödendi işaretli (${mevcut.tarih}, ${paraMetni(mevcut.tutar, k.paraBirimi)}); güncellenecek.`);
      return {
        baslik: "Ödendi işareti",
        satirlar: [`${k.kim} · ${k.aciklama}`, `${paraMetni(veri.tutar, k.paraBirimi)} ödendi · ${tarihMetni(t)}${veri.not ? ` · ${veri.not}` : ""}`],
        not: notlar.join(" "),
        veri,
      };
    },
    uygula(veri) {
      const onceki = (db.tablo("odeme") || []).find((r) => r.anahtar === veri.anahtar);
      const geri = { anahtar: veri.anahtar, onceki: onceki ? { tarih: onceki.tarih, tutar: onceki.tutar, not: onceki.not } : null };
      odeme.ode([veri]);
      kasa.esitle();
      return { geri };
    },
    geriAl({ anahtar, onceki }) {
      if (onceki) odeme.ode([{ anahtar, ...onceki }]); else odeme.geriAl(anahtar);
      kasa.esitle();
    },
  },

  personel_guncelle: {
    aciklama: "Personelin ekibini, evini, görevini ya da durumunu değiştirir (onay kartı açar). Maaş/ücret DEĞİŞTİRİLEMEZ. " +
      "Boş kod ('') ekip ya da evi kaldırır.",
    sema: nesne({
      personelKod: kodAlani,
      ekip: metin("Ekip kodu, ör. EKP-02; '' ekipten çıkarır"),
      ev: metin("Ev kodu, ör. EV-01; '' evden çıkarır"),
      gorev: metin("Görev"),
      durum: metin("Aktif, İzinli ya da Ayrıldı", { enum: ["Aktif", "İzinli", "Ayrıldı"] }),
    }, ["personelKod"]),
    hazirla(args) {
      const kisi = kisiAl(args.personelKod);
      const ad = (tablo, kod) => (kod ? `${kod} ${db.satirBul(tablo, (x) => x.kod === kod)?.ad || ""}`.trim() : "yok");
      const alanlar = {}, satirlar = [kisi.ad];
      const BASLIK = { ekip: "Ekip", ev: "Ev", gorev: "Görev", durum: "Durum" };
      for (const k of Object.keys(BASLIK)) {
        if (!(k in args) || args[k] === undefined || args[k] === null) continue;
        const v = String(args[k]).trim();
        if (k === "ekip" && v && !db.satirBul("ekip", (x) => x.kod === v)) throw new Error(`"${v}" numaralı ekip yok.`);
        if (k === "ev" && v && !db.satirBul("ev", (x) => x.kod === v)) throw new Error(`"${v}" numaralı ev yok.`);
        if (k === "durum" && !["Aktif", "İzinli", "Ayrıldı"].includes(v)) throw new Error(`Durum geçersiz: ${v}`);
        if (k === "durum" && String(kisi.durum || "") !== v && kontrat.durumOtomatikMi(kisi.kod)) {
          throw new Error(`${kisi.ad}: durum çalışma dönemlerinden hesaplanıyor, sesli komutla değiştirilemez. Kişi sayfasındaki Çalışma Dönemleri kartından düzenlenir.`);
        }
        if (String(kisi[k] || "") === v) continue;
        alanlar[k] = v;
        const goster = (x) => (k === "ekip" ? ad("ekip", x) : k === "ev" ? ad("ev", x) : x || "yok");
        satirlar.push(`${BASLIK[k]}: ${goster(kisi[k] || "")} → ${goster(v)}`);
      }
      if (!Object.keys(alanlar).length) throw new Error(`${kisi.ad} için değişen bir şey yok.`);
      const notlar = [];
      if ("ekip" in alanlar || "ev" in alanlar) notlar.push("Açık puantaj dönemine yansımaz; yeni açılan dönemlerden geçerli olur.");
      if (alanlar.durum === "Ayrıldı") notlar.push("Ayrıldı olarak işaretlenen kişi yeni puantaj dönemlerine alınmaz.");
      return { baslik: "Personel", satirlar, not: notlar.join(" "), veri: { personelKod: kisi.kod, alanlar } };
    },
    uygula({ personelKod, alanlar }) {
      const kisi = kisiAl(personelKod);
      const eski = Object.fromEntries(Object.keys(alanlar).map((k) => [k, kisi[k] || ""]));
      const { uyari } = islem.guncelle("personel", kisi._id, alanlar);
      return { geri: { id: kisi._id, eski, yeni: alanlar }, uyari };
    },
    geriAl({ id, eski, yeni }) {
      const kisi = db.satirBul("personel", (x) => x._id === id);
      if (!kisi) throw new Error("Personel kaydı artık yok.");
      for (const [k, v] of Object.entries(yeni)) {
        if (String(kisi[k] || "") !== v) throw new Error(`${kisi.ad}: ${k} sonradan değişmiş; elle düzeltin.`);
      }
      islem.guncelle("personel", id, eski);
    },
  },
};

const ARAC_TANIMLARI = Object.entries(ARACLAR).map(([ad, a]) => ({
  type: "function",
  function: { name: ad, description: a.aciklama, parameters: a.sema },
}));

/* ------------------------------------------------------------------ */
/* Konuşma döngüsü                                                     */
/* ------------------------------------------------------------------ */

const konusmalar = new Map();   // id → { id, mesajlar, zaman }
const kartlar = new Map();      // id → bekleyen onay kartı

function temizle() {
  const simdi = Date.now();
  for (const [id, k] of konusmalar) if (simdi - k.zaman > KONUSMA_OMRU) konusmalar.delete(id);
  for (const [id, k] of kartlar) {
    if (simdi - k.zaman <= KART_OMRU) continue;
    kartlar.delete(id);
    olayYaz("suresi_doldu", k);
  }
}

function konusmaAl(id) {
  let k = id ? konusmalar.get(id) : null;
  if (!k) { k = { id: yeniId(), mesajlar: [] }; konusmalar.set(k.id, k); }
  k.zaman = Date.now();
  return k;
}

/** Geçmiş uzamasın: son 6 kullanıcı mesajından öncesi atılır (araç çağrısı ile sonucu birbirinden ayrılmaz). */
function kirp(k) {
  const kullanici = k.mesajlar.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  if (kullanici.length > 6) k.mesajlar = k.mesajlar.slice(kullanici.at(-6));
}

function argumanlar(ham) {
  if (ham && typeof ham === "object") return ham;
  try { const v = JSON.parse(ham || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

const kartGorunumu = (k) => ({ id: k.id, arac: k.arac, baslik: k.baslik, satirlar: k.satirlar, not: k.not });

/**
 * Bir komutu işler. Döner: { konusmaId, metin, cevap, kartlar }
 * `iz`: sesle gelen komutta yazıya dökme bilgisi ({ baslangic, ses }); komut kaydına eklenir.
 */
export async function komut(cumle, konusmaId, iz = {}) {
  const metin = String(cumle || "").trim();
  if (!metin) throw new Error("Komut boş.");
  if (metin.length > 2000) throw new Error("Komut çok uzun.");
  temizle();
  const k = konusmaAl(konusmaId);
  k.mesajlar.push({ role: "user", content: metin });
  kirp(k);

  const baslangic = iz.baslangic || Date.now();
  const kyt = { ...kayitBasi("komut"), kaynak: iz.ses ? "ses" : "metin", ses: iz.ses || null, konusmaId: k.id,
    oncekiMesaj: k.mesajlar.length - 1, cumle: metin, turlar: [], kartlar: [], cevap: "", hata: null };
  const yeniKartlar = [];
  let cevap = "";
  try {
    for (let tur = 0; tur < MAKS_TUR && !cevap; tur += 1) {
      const d = new Date();
      const system = sistemMetni();
      const t0 = Date.now();
      const turKaydi = { sureMs: 0, sistemKarakter: system.length, mesajSayisi: k.mesajlar.length, cagrilar: [] };
      kyt.turlar.push(turKaydi);
      const y = await n8n("kadro/assist", {
        system,
        now_local: `${yerelGun(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        messages: k.mesajlar,
        tools: ARAC_TANIMLARI,
      });
      turKaydi.sureMs = Date.now() - t0;
      turKaydi.token = y.usage || null;
      const cagrilar = Array.isArray(y.tool_calls) ? y.tool_calls : [];
      if (!cagrilar.length) {
        turKaydi.soyledi = String(y.say || "");
        cevap = String(y.say || "").trim() || "Bunu anlayamadım; tekrar söyler misiniz?";
        k.mesajlar.push({ role: "assistant", content: cevap });
        break;
      }
      k.mesajlar.push({
        role: "assistant", content: "",
        tool_calls: cagrilar.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments || {}) } })),
      });

      let modeleDon = false;
      for (const c of cagrilar) {
        const a = ARACLAR[c.name];
        const cagriKaydi = { ad: c.name, arguman: argumanlar(c.arguments) };
        turKaydi.cagrilar.push(cagriKaydi);
        let sonuc;
        try {
          if (!a) throw new Error(`Böyle bir araç yok: ${c.name}`);
          const args = argumanlar(c.arguments);
          if (a.oku) {
            sonuc = a.oku(args);
            modeleDon = true;
          } else {
            const h = a.hazirla(args);
            const kart = { id: yeniId(), komutId: kyt.id, konusmaId: k.id, arac: c.name, args, cumle: metin, baslik: h.baslik, satirlar: h.satirlar, not: h.not || "", zaman: Date.now() };
            kartlar.set(kart.id, kart);
            cagriKaydi.kartId = kart.id;
            yeniKartlar.push(kartGorunumu(kart));
            sonuc = `Onay kartı gösterildi: ${h.baslik} — ${h.satirlar.join("; ")}. Kullanıcı Onayla'ya basınca yazılacak; henüz YAZILMADI.`;
          }
        } catch (e) {
          sonuc = `HATA: ${e.message}`;
          modeleDon = true;
        }
        cagriKaydi.sonuc = kayit.kes(sonuc);
        k.mesajlar.push({ role: "tool", tool_call_id: c.id, name: c.name, content: String(sonuc) });
      }

      // Sadece geçerli yazma kartları: modele tekrar gitmeye gerek yok, cevabı burada kur.
      if (!modeleDon) {
        cevap = yeniKartlar.length === 1 ? "Kontrol edip onaylayın." : `${yeniKartlar.length} işlem hazır; kontrol edip onaylayın.`;
        k.mesajlar.push({ role: "assistant", content: cevap });
      }
    }
    if (!cevap) cevap = "Bu komutu tamamlayamadım; daha kısa parçalar hâlinde söyleyin.";
  } catch (e) {
    kyt.hata = e.message;
    throw e;
  } finally {
    kyt.cevap = cevap;
    kyt.kartlar = yeniKartlar.map(({ id, arac, baslik, satirlar, not }) => ({ id, arac, baslik, satirlar, not }));
    kyt.sureMs = Date.now() - baslangic;
    kayit.yaz(kyt);
  }
  return { konusmaId: k.id, metin, cevap, kartlar: yeniKartlar };
}

// Whisper sessizlikte susmuyor, uyduruyor: altyazı veri setlerinden ezber kalıplar ("Altyazı M.K.")
// ya da verilen isim ipucunun tekrarı. transcribe akışı sadece no_speech_prob'a baktığı için burada elenir
// (ana projenin ingest akışındaki "Konusma Denetimi" ile aynı mantık).
const EZBER = new Set(["altyazi m k", "altyazi", "abone olmayi unutmayin", "izlediginiz icin tesekkurler",
  "tesekkurler", "tesekkur ederim", "thank you", "thanks for watching", "subscribe", "you", "music", "muzik", "alkis"]);
const sadelestir = (s) => String(s).toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function uydurmaMi(metin, ipucu) {
  const norm = sadelestir(metin);
  const kelime = norm ? norm.split(" ") : [];
  if (!kelime.length) return true;
  if (kelime.length <= 4 && EZBER.has(norm)) return true;
  // İpucunun tekrarı. ana proje'daki %60 oranı burada kullanılmaz: KADRO komutlarının çoğu isimdir
  // ("Ahet Demir ve Cem Polat gelmedi" → %67 isim). Tekrar sayılan: ipucunun başı ("kadro puantaj")
  // ya da ipucunda olmayan tek kelime içermeyen en az 4 kelimelik isim dizisi.
  const ipucuKelime = new Set(sadelestir(ipucu).split(" "));
  return norm.startsWith("kadro puantaj") || (kelime.length >= 4 && kelime.every((k) => ipucuKelime.has(k)));
}

/** Sesi yazıya döker. Döner: { metin, ham, elendi }; konuşma yoksa (ya da Whisper uydurduysa) metin boştur. */
async function yaziyaDok(dosyaYolu, mime) {
  const tur = String(mime || "audio/webm").split(";")[0];
  const uzanti = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" }[tur] || "webm";
  const ipucu = isimIpucu();
  const fd = new FormData();
  fd.append("audio", new Blob([fs.readFileSync(dosyaYolu)], { type: tur }), `ses.${uzanti}`);
  fd.append("language", "tr");
  fd.append("prompt", ipucu);
  const v = await n8n("kadro/transcribe", fd);
  const ham = String(v.transcript || "").trim();
  if (v.no_speech) return { metin: "", ham, elendi: "whisper: konuşma yok" };
  if (uydurmaMi(ham, ipucu)) return { metin: "", ham, elendi: "ezber kalıp ya da ipucu tekrarı" };
  return { metin: ham, ham, elendi: null };
}

/** Sesli komut: yazıya döker, sonra komut() gibi işler. Duyulmayan kayıt da kayda geçer (yazıya dökmeyi iyileştirmek için). */
export async function sesKomutu(dosyaYolu, mime, konusmaId) {
  const baslangic = Date.now();
  const ses = { tur: String(mime || "").split(";")[0], boyut: fs.statSync(dosyaYolu).size, sureMs: 0, ham: "", elendi: null };
  const bos = (ek) => kayit.yaz({ ...kayitBasi("komut"), kaynak: "ses", ses, konusmaId: konusmaId || null, cumle: "",
    turlar: [], kartlar: [], cevap: "", hata: null, sureMs: ses.sureMs, ...ek });
  let y;
  try { y = await yaziyaDok(dosyaYolu, mime); }
  catch (e) {
    ses.sureMs = Date.now() - baslangic;
    bos({ hata: e.message });
    throw e;
  }
  Object.assign(ses, { sureMs: Date.now() - baslangic, ham: y.ham, elendi: y.elendi });
  if (!y.metin) {
    const cevap = "Konuşma duyulmadı; tekrar deneyin.";
    bos({ cevap });
    return { konusmaId: konusmaId || null, metin: "", cevap, kartlar: [] };
  }
  return komut(y.metin, konusmaId, { baslangic, ses });
}

/* ------------------------------------------------------------------ */
/* Onay, vazgeçme, geri alma                                           */
/* ------------------------------------------------------------------ */

const gunlukGorunumu = (r) => ({
  id: r._id, tarih: r.tarih, kullanici: r.kullanici, cumle: r.cumle, baslik: r.baslik, satirlar: r.satirlar,
  geriAlindi: r.geriAlindi || null,
});

export function onayla(id) {
  const k = kartlar.get(id);
  if (!k) throw new Error("Bu kartın süresi doldu ya da zaten işlendi. Komutu yeniden söyleyin.");
  const a = ARACLAR[k.arac];
  // Kart açıldıktan sonra veri değişmiş olabilir: aynı doğrulama yeniden yapılır.
  let h, sonuc;
  try {
    h = a.hazirla(k.args);
    sonuc = a.uygula(h.veri);
  } catch (e) {
    olayYaz("onay_hatasi", k, { hata: e.message });
    throw e;
  }
  kartlar.delete(id);
  const satir = db.satirEkle("asistan", {
    tarih: new Date().toISOString(), kullanici: db.ayarlar().kullanici, cumle: k.cumle,
    arac: k.arac, baslik: h.baslik, satirlar: h.satirlar, geri: sonuc.geri, komutId: k.komutId, kartId: k.id,
  });
  // Kart açıldığından beri veri değiştiyse yazılan satırlar karttakinden farklı olur; ikisi de kayda geçer.
  olayYaz("onay", k, { satirlar: h.satirlar, kartSatirlari: k.satirlar, uyari: sonuc.uyari || null,
    sureSn: Math.round((Date.now() - k.zaman) / 1000) });
  return { kayit: gunlukGorunumu(satir), uyari: sonuc.uyari || null };
}

export function vazgec(id) {
  const k = kartlar.get(id);
  kartlar.delete(id);
  if (k) olayYaz("vazgec", k, { sureSn: Math.round((Date.now() - k.zaman) / 1000) });
  return { vazgecildi: true };
}

export function geriAl(id) {
  const r = db.satirBul("asistan", (x) => x._id === id);
  if (!r) throw new Error("İşlem kaydı bulunamadı.");
  if (r.geriAlindi) throw new Error("Bu işlem zaten geri alındı.");
  try { ARACLAR[r.arac].geriAl(r.geri); }
  catch (e) { olayYaz("geri_alma_hatasi", r, { hata: e.message }); throw e; }
  const satir = db.satirGuncelle("asistan", id, { geriAlindi: new Date().toISOString(), geriAlan: db.ayarlar().kullanici });
  olayYaz("geri_al", r, { sureSn: Math.round((Date.now() - new Date(r.tarih).getTime()) / 1000) });
  return { kayit: gunlukGorunumu(satir) };
}

export function durum() {
  const { adres, hazir } = ayar();
  let sunucu = "";
  try { sunucu = adres ? new URL(adres).host : ""; } catch { sunucu = adres; }
  return { hazir, sunucu, gunluk: db.tablo("asistan").slice(-30).reverse().map(gunlukGorunumu) };
}
