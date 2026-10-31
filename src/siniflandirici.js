/**
 * 2. KATMAN — Gelen belgeyi okuyup hangi klasöre gideceğine karar verir.
 *
 * İki aşama çalışır:
 *   1) Kural motoru  — dosya adındaki anahtar kelimeler + tablolardaki isim/plaka/kod
 *      eşleşmesi. Anında, ücretsiz, internetsiz.
 *   2) Claude        — kural yeterince emin olamazsa belgenin İÇİNİ okur
 *      (PDF ve görseller dâhil) ve bölümü kendisi seçer.
 *
 * Claude'a klasörlerin tam listesi değil, sabit bir "bölüm kataloğu" verilir;
 * kişi/proje/araç eşleştirmesini kod yapar. Böylece istem sabit kalır
 * (önbelleğe girer) ve personel sayısı arttıkça maliyet artmaz.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { duzYapi, SABLONLAR } from "./yapi.js";
import { dinamikYol } from "./klasor.js";
import * as db from "./db.js";

const MODEL = "claude-opus-5";

/* ------------------------------------------------------------------ */
/* Türkçe normalleştirme                                               */
/* ------------------------------------------------------------------ */

const HARF = { ç: "c", ğ: "g", ı: "i", i̇: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

export function normalize(s) {
  return String(s || "")
    .replace(/İ/g, "i").replace(/I/g, "i")
    .toLocaleLowerCase("tr")
    .replace(/[çğıiöşüâîû]/g, (c) => HARF[c] || c)
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Tarih çıkarma                                                       */
/* ------------------------------------------------------------------ */

const AYLAR = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
  temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
};

/** Dosya adından tarih çıkarır. Döner: { yil, ay, gun } veya null */
export function tarihBul(ham) {
  const s = normalize(ham);
  let m;
  if ((m = /\b(20\d{2})[ ]?(0[1-9]|1[0-2])[ ]?(0[1-9]|[12]\d|3[01])\b/.exec(s)))
    return { yil: +m[1], ay: +m[2], gun: +m[3] };
  if ((m = /\b(0[1-9]|[12]\d|3[01])[ ](0[1-9]|1[0-2])[ ](20\d{2})\b/.exec(s)))
    return { yil: +m[3], ay: +m[2], gun: +m[1] };
  if ((m = /\b(20\d{2})[ ](0[1-9]|1[0-2])\b/.exec(s))) return { yil: +m[1], ay: +m[2], gun: null };
  if ((m = /\b(0[1-9]|1[0-2])[ ](20\d{2})\b/.exec(s))) return { yil: +m[2], ay: +m[1], gun: null };
  for (const [ad, no] of Object.entries(AYLAR)) {
    const re = new RegExp(`\\b${ad}\\b[ ]?(20\\d{2})?`);
    if ((m = re.exec(s))) return { yil: m[1] ? +m[1] : new Date().getFullYear(), ay: no, gun: null };
  }
  if ((m = /\b(20\d{2})\b/.exec(s))) return { yil: +m[1], ay: null, gun: null };
  return null;
}

export function tarihMetni(t) {
  if (!t) return null;
  const p = (n) => String(n).padStart(2, "0");
  if (t.gun) return `${t.yil}-${p(t.ay)}-${p(t.gun)}`;
  if (t.ay) return `${t.yil}-${p(t.ay)}`;
  return `${t.yil}`;
}

/* ------------------------------------------------------------------ */
/* Kayıt eşleştirme (kişi / araç / proje / müşteri)                    */
/* ------------------------------------------------------------------ */

const AYIRT_EDICI_MIN = 4; // bu uzunluğun altındaki kelimeler tek başına eşleşme sayılmaz

function kayitEsle(nAd) {
  const adaylar = [];

  for (const p of db.tablo("personel")) {
    let puan = 0;
    if (p.kod && nAd.includes(normalize(p.kod))) puan = 1;
    else {
      const parcalar = normalize(p.ad).split(" ").filter((w) => w.length >= AYIRT_EDICI_MIN);
      const tutan = parcalar.filter((w) => nAd.includes(w));
      if (parcalar.length && tutan.length === parcalar.length) puan = 0.95;
      else if (tutan.length >= 2) puan = 0.85;
      else if (tutan.length === 1 && parcalar.length === 1) puan = 0.6;
      else if (tutan.length === 1) puan = 0.45;
    }
    if (puan > 0) adaylar.push({ tur: "personel", satir: p, puan, etiket: `${p.kod} ${p.ad}` });
  }

  for (const a of db.tablo("arac")) {
    const np = normalize(a.plaka);
    if (np && np.length >= 4 && nAd.includes(np)) {
      adaylar.push({ tur: "arac", satir: a, puan: 1, etiket: `${a.plaka} ${a.marka || ""}`.trim() });
    }
  }

  for (const pr of db.tablo("proje")) {
    if (pr.kod && nAd.includes(normalize(pr.kod))) {
      adaylar.push({ tur: "proje", satir: pr, puan: 1, etiket: pr.ad });
      continue;
    }
    const parcalar = normalize(pr.ad).split(" ").filter((w) => w.length >= AYIRT_EDICI_MIN);
    const tutan = parcalar.filter((w) => nAd.includes(w));
    if (parcalar.length && tutan.length === parcalar.length) adaylar.push({ tur: "proje", satir: pr, puan: 0.9, etiket: pr.ad });
    else if (tutan.length >= 1 && parcalar.length > 1) adaylar.push({ tur: "proje", satir: pr, puan: 0.55, etiket: pr.ad });
  }

  for (const m of db.tablo("musteri")) {
    if (m.kod && nAd.includes(normalize(m.kod))) {
      adaylar.push({ tur: "musteri", satir: m, puan: 1, etiket: m.ad });
      continue;
    }
    const parcalar = normalize(m.ad).split(" ").filter((w) => w.length >= AYIRT_EDICI_MIN);
    const tutan = parcalar.filter((w) => nAd.includes(w));
    if (parcalar.length && tutan.length === parcalar.length) adaylar.push({ tur: "musteri", satir: m, puan: 0.9, etiket: m.ad });
  }

  adaylar.sort((a, b) => b.puan - a.puan);
  return adaylar[0] || null;
}

/* ------------------------------------------------------------------ */
/* Kural motoru                                                        */
/* ------------------------------------------------------------------ */

function anahtarPuani(nAd, anahtarlar) {
  let enIyi = 0, bulunan = null, adet = 0;
  for (const a of anahtarlar || []) {
    const na = normalize(a);
    if (!na || !nAd.includes(na)) continue;
    adet += 1;
    const w = Math.min(0.92, 0.42 + na.replace(/ /g, "").length * 0.035);
    if (w > enIyi) { enIyi = w; bulunan = a; }
  }
  return { puan: enIyi, anahtar: bulunan, adet };
}

/**
 * Kural tabanlı sınıflandırma.
 * Döner: { hedefYol, guven, gerekce, belgeTuru, ilgili, tarih, yontem:"kural" }
 */
export function kuralIle(dosyaAdi) {
  const nAd = normalize(path.basename(dosyaAdi, path.extname(dosyaAdi)));
  const kayit = kayitEsle(nAd);
  const tarih = tarihBul(dosyaAdi);
  const statik = duzYapi().filter((d) => d.hedef && d.anahtar.length);

  const adaylar = [];

  // 1) Eşleşen kayıt varsa önce onun şablon klasörlerine bak.
  if (kayit) {
    const taban = dinamikYol(kayit.tur, kayit.satir);
    for (const alt of SABLONLAR[kayit.tur] || []) {
      const { puan, anahtar, adet } = anahtarPuani(nAd, alt.anahtar);
      if (puan > 0) {
        adaylar.push({
          hedefYol: `${taban}/${alt.c} ${alt.n}`,
          puan: Math.min(0.97, puan + kayit.puan * 0.28 + (adet > 1 ? 0.05 : 0)),
          belgeTuru: alt.n,
          anahtar,
          kayit,
        });
      }
    }
  }

  // 2) Statik klasörler.
  for (const d of statik) {
    const { puan, anahtar, adet } = anahtarPuani(nAd, d.anahtar);
    if (puan > 0) {
      adaylar.push({
        hedefYol: d.yol,
        puan: Math.min(0.94, puan + (adet > 1 ? 0.06 : 0)),
        belgeTuru: d.isim,
        anahtar,
        kayit: null,
      });
    }
  }

  adaylar.sort((a, b) => b.puan - a.puan);
  const en = adaylar[0];

  if (!en) {
    return {
      hedefYol: null, guven: 0, yontem: "kural",
      gerekce: kayit
        ? `"${kayit.etiket}" kaydı tanındı ama belge türü anlaşılamadı.`
        : "Dosya adında tanınan bir anahtar kelime yok.",
      belgeTuru: null,
      ilgili: kayit ? kayit.etiket : null,
      tarih: tarihMetni(tarih),
      alternatif: [],
    };
  }

  const gerekceler = [`"${en.anahtar}" kelimesi ${en.belgeTuru} klasörünü işaret ediyor`];
  if (en.kayit) gerekceler.push(`dosya adında "${en.kayit.etiket}" geçiyor`);
  if (tarih) gerekceler.push(`tarih: ${tarihMetni(tarih)}`);

  return {
    hedefYol: en.hedefYol,
    guven: Math.round(en.puan * 100) / 100,
    yontem: "kural",
    gerekce: gerekceler.join(", ") + ".",
    belgeTuru: en.belgeTuru,
    ilgili: en.kayit ? en.kayit.etiket : null,
    ilgiliTur: en.kayit ? en.kayit.tur : null,
    tarih: tarihMetni(tarih),
    alternatif: adaylar.slice(1, 4).map((a) => ({ hedefYol: a.hedefYol, guven: Math.round(a.puan * 100) / 100 })),
  };
}

/* ------------------------------------------------------------------ */
/* Claude katmanı                                                      */
/* ------------------------------------------------------------------ */

/** Sabit bölüm kataloğu — istemin önbelleğe girmesi için sırası hiç değişmez. */
function bolumKatalogu() {
  const satirlar = [];
  for (const d of duzYapi()) {
    if (d.dinamik || !d.hedef) continue;
    satirlar.push(`  ${d.yol}\n      ${d.d}`);
  }
  const dinamikler = [
    ["personel", "Bir ÇALIŞANA ait belge"],
    ["proje", "Bir PROJEYE ait belge"],
    ["arac", "Bir ARACA ait belge"],
    ["musteri", "Bir MÜŞTERİYE ait belge"],
  ];
  for (const [tur, baslik] of dinamikler) {
    satirlar.push(`\n  --- ${baslik} (ilgiliAd alanını mutlaka doldur) ---`);
    for (const alt of SABLONLAR[tur]) {
      satirlar.push(`  ${tur}:${alt.c}\n      ${alt.n} — ${alt.d}`);
    }
  }
  return satirlar.join("\n");
}

const SISTEM_ONEK =
  `Sen ACME Mühendislik'in belge yönlendirme uzmanısın. Şirket Sırbistan'da elektrik ve ` +
  `muhendislik taahhüt işi yapıyor; personelin bir kısmı Türk, belgeler Türkçe veya Sırpça olabilir.\n\n` +
  `Sana bir belge veriliyor. Görevin: bu belgenin aşağıdaki kurumsal dosyalama düzeninde ` +
  `HANGİ BÖLÜME ait olduğunu belirlemek.\n\n` +
  `KURALLAR:\n` +
  `- Kararını her zaman "belge_siniflandir" aracını çağırarak ver. Düz metinle cevap verme.\n` +
  `- "bolum" alanına aşağıdaki listedeki değerlerden BİRİNİ birebir yaz.\n` +
  `- Belge bir çalışana/projeye/araca/müşteriye aitse "personel:06" gibi kısa biçimi kullan ` +
  `ve "ilgiliAd" alanına kişinin/projenin/aracın adını belgede yazdığı gibi yaz.\n` +
  `- Emin değilsen guven değerini düşük ver; uydurma. Hiçbir bölüm uymuyorsa bolum alanını boş bırak.\n\n` +
  `BÖLÜM LİSTESİ:\n`;

const ARAC_TANIMI = {
  name: "belge_siniflandir",
  description: "Belgenin ait olduğu bölümü ve belgeden okunan künye bilgilerini bildirir.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      bolum: { type: "string", description: "Bölüm listesindeki değerlerden biri, birebir. Hiçbiri uymuyorsa boş metin." },
      ilgiliAd: { type: "string", description: "Belgedeki kişi/proje/araç/müşteri adı. Yoksa boş metin." },
      belgeTuru: { type: "string", description: "Belgenin kısa Türkçe adı. Örn: Maaş bordrosu, Kasko poliçesi, Satış faturası." },
      tarih: { type: "string", description: "Belgenin tarihi: YYYY-AA-GG veya YYYY-AA. Yoksa boş metin." },
      guven: { type: "number", description: "0 ile 1 arasında kararın güvenilirliği." },
      gerekce: { type: "string", description: "Tek cümle Türkçe gerekçe." },
    },
    required: ["bolum", "ilgiliAd", "belgeTuru", "tarih", "guven", "gerekce"],
    additionalProperties: false,
  },
};

const RESIM = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
const DUZ_METIN = new Set([".txt", ".csv", ".md", ".log", ".json", ".xml", ".htm", ".html"]);
const MAX_PDF = 30 * 1024 * 1024;

function icerikBloklari(geciciYol, dosyaAdi) {
  const uz = path.extname(dosyaAdi).toLowerCase();
  const bloklar = [];
  let okundu = "yok";

  try {
    const boyut = fs.statSync(geciciYol).size;
    if (uz === ".pdf" && boyut <= MAX_PDF) {
      bloklar.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: fs.readFileSync(geciciYol).toString("base64") },
      });
      okundu = "pdf";
    } else if (RESIM[uz] && boyut <= 8 * 1024 * 1024) {
      bloklar.push({
        type: "image",
        source: { type: "base64", media_type: RESIM[uz], data: fs.readFileSync(geciciYol).toString("base64") },
      });
      okundu = "gorsel";
    } else if (DUZ_METIN.has(uz) && boyut <= 2 * 1024 * 1024) {
      const metin = fs.readFileSync(geciciYol, "utf8").slice(0, 8000);
      bloklar.push({ type: "text", text: `Dosya içeriği:\n\n${metin}` });
      okundu = "metin";
    }
  } catch (e) {
    console.error("[ai] içerik okunamadı:", e.message);
  }
  return { bloklar, okundu };
}

let istemciOnbellek = { anahtar: null, istemci: null };

function istemciAl(apiAnahtari) {
  const anahtar = apiAnahtari || process.env.ANTHROPIC_API_KEY || "";
  if (!anahtar) return null;
  if (istemciOnbellek.anahtar !== anahtar) {
    istemciOnbellek = { anahtar, istemci: new Anthropic({ apiKey: anahtar }) };
  }
  return istemciOnbellek.istemci;
}

/** Claude'un döndürdüğü kısa bölüm kodunu gerçek klasör yoluna çevirir. */
function bolumuCoz(bolum, ilgiliAd, kuralKaydi) {
  if (!bolum) return { hedefYol: null, ilgili: null, ilgiliTur: null };

  const dinamik = /^(personel|proje|arac|musteri):(\d{2})$/.exec(bolum.trim());
  if (!dinamik) {
    const varMi = duzYapi().find((d) => d.yol === bolum.trim() && d.hedef);
    return { hedefYol: varMi ? varMi.yol : null, ilgili: null, ilgiliTur: null };
  }

  const [, tur, kod] = dinamik;
  const alt = (SABLONLAR[tur] || []).find((a) => a.c === kod);
  if (!alt) return { hedefYol: null, ilgili: null, ilgiliTur: null };

  // Kişiyi/kaydı önce kural motorunun bulduğundan, olmazsa Claude'un okuduğu addan çöz.
  let kayit = kuralKaydi && kuralKaydi.tur === tur ? kuralKaydi : null;
  if (!kayit && ilgiliAd) kayit = kayitEsle(normalize(ilgiliAd));
  if (!kayit || kayit.tur !== tur) {
    return { hedefYol: null, ilgili: ilgiliAd || null, ilgiliTur: tur, eksikKayit: { tur, ad: ilgiliAd, altKod: kod } };
  }

  const taban = dinamikYol(tur, kayit.satir);
  return { hedefYol: `${taban}/${alt.c} ${alt.n}`, ilgili: kayit.etiket, ilgiliTur: tur };
}

/** Claude'a sorar. Hata olursa null döner — çağıran kural sonucuna geri düşer. */
export async function claudeIle(geciciYol, dosyaAdi, apiAnahtari, kuralSonucu) {
  const istemci = istemciAl(apiAnahtari);
  if (!istemci) return { hata: "API anahtarı tanımlı değil." };

  const { bloklar, okundu } = icerikBloklari(geciciYol, dosyaAdi);
  const nAd = normalize(path.basename(dosyaAdi, path.extname(dosyaAdi)));
  const kuralKaydi = kayitEsle(nAd);

  const ipuclari = [];
  if (kuralKaydi) ipuclari.push(`Dosya adı sistemdeki "${kuralKaydi.etiket}" kaydıyla eşleşiyor.`);
  if (kuralSonucu?.tarih) ipuclari.push(`Dosya adında geçen tarih: ${kuralSonucu.tarih}`);
  if (okundu === "yok") ipuclari.push("Bu dosya türünün içeriği okunamadı; sadece dosya adına göre karar ver.");

  const icerik = [
    ...bloklar,
    {
      type: "text",
      text:
        `Dosya adı: ${dosyaAdi}\n` +
        (ipuclari.length ? `\nSistemden ipuçları:\n- ${ipuclari.join("\n- ")}\n` : "") +
        `\nBu belgeyi sınıflandır.`,
    },
  ];

  try {
    const yanit = await istemci.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: [{ type: "text", text: SISTEM_ONEK + bolumKatalogu(), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: icerik }],
      tools: [ARAC_TANIMI],
    });

    if (yanit.stop_reason === "refusal") {
      return { hata: "Model bu belgeyi değerlendirmeyi reddetti; kural sonucu kullanılıyor." };
    }

    const cagri = yanit.content.find((b) => b.type === "tool_use" && b.name === "belge_siniflandir");
    if (!cagri) return { hata: "Model bir sınıflandırma döndürmedi." };

    const g = cagri.input;
    const cozum = bolumuCoz(g.bolum, g.ilgiliAd, kuralKaydi);

    return {
      hedefYol: cozum.hedefYol,
      guven: cozum.hedefYol ? Math.max(0, Math.min(1, Number(g.guven) || 0)) : 0,
      yontem: "claude",
      gerekce: g.gerekce || "",
      belgeTuru: g.belgeTuru || null,
      ilgili: cozum.ilgili,
      ilgiliTur: cozum.ilgiliTur,
      eksikKayit: cozum.eksikKayit || null,
      tarih: g.tarih || kuralSonucu?.tarih || null,
      okundu,
      kullanim: {
        giris: yanit.usage.input_tokens,
        cikis: yanit.usage.output_tokens,
        onbellekOkuma: yanit.usage.cache_read_input_tokens || 0,
      },
    };
  } catch (e) {
    console.error("[ai] Claude hatası:", e.message);
    return { hata: e.message };
  }
}

/* ------------------------------------------------------------------ */
/* Önerilen dosya adı                                                  */
/* ------------------------------------------------------------------ */

const TARIHLI_KLASOR = /(Bordro|Puantaj|Dekont|Fatura|Banka|Vergi|Maaş|Cari|Hakediş|Yakıt)/i;

export function onerilenAd(dosyaAdi, sonuc) {
  const uz = path.extname(dosyaAdi);
  let govde = path.basename(dosyaAdi, uz).replace(/\s+/g, " ").trim();

  // Zaten tarihle başlıyorsa dokunma.
  if (/^\d{4}[-_. ]\d{2}/.test(govde)) return govde + uz;
  if (!sonuc.tarih) return govde + uz;

  const tarihliOlmali = sonuc.hedefYol && TARIHLI_KLASOR.test(sonuc.hedefYol);
  const onek = tarihliOlmali ? sonuc.tarih.slice(0, 7) : sonuc.tarih;
  if (!/^\d{4}/.test(onek)) return govde + uz;
  return `${onek} ${govde}${uz}`;
}

/* ------------------------------------------------------------------ */
/* Ana giriş                                                           */
/* ------------------------------------------------------------------ */

/**
 * Bir dosyayı sınıflandırır. Ayarlardaki moda göre kural ve/veya Claude çalışır.
 * Döner: kural sonucu + (varsa) ai sonucu + seçilen nihai öneri.
 */
export async function siniflandir(geciciYol, dosyaAdi) {
  const { aiModu, apiAnahtari, esik } = db.ayarlar();
  const kural = kuralIle(dosyaAdi);

  const aiVar = Boolean(apiAnahtari || process.env.ANTHROPIC_API_KEY);
  const aiGerekli =
    aiModu === "sadeceAi" ||
    (aiModu === "karma" && (kural.guven < (esik ?? 0.72) || !kural.hedefYol));

  let ai = null;
  if (aiVar && aiModu !== "sadeceKural" && aiGerekli) {
    ai = await claudeIle(geciciYol, dosyaAdi, apiAnahtari, kural);
  }

  let secilen = kural;
  if (ai && !ai.hata && ai.hedefYol && ai.guven >= kural.guven) secilen = ai;
  else if (ai && !ai.hata && ai.hedefYol && !kural.hedefYol) secilen = ai;

  const notlar = [];
  if (!aiVar && aiModu !== "sadeceKural") notlar.push("API anahtarı girilmediği için yalnızca kurallar çalıştı.");
  if (ai?.hata) notlar.push(`Yapay zekâ katmanı devre dışı kaldı: ${ai.hata}`);
  if (ai?.eksikKayit) {
    notlar.push(
      `Belge "${ai.eksikKayit.ad}" adına ait görünüyor ama bu isim ${ai.eksikKayit.tur} tablosunda kayıtlı değil. ` +
      `Önce kaydı ekleyin, sonra yeniden yükleyin.`
    );
  }
  if (secilen.guven < 0.5) notlar.push("Güven düşük — hedefi kontrol edip gerekirse elle değiştirin.");

  return {
    dosyaAdi,
    kural,
    ai,
    hedefYol: secilen.hedefYol,
    guven: secilen.guven,
    yontem: secilen.hedefYol ? secilen.yontem : "yok",
    gerekce: secilen.gerekce,
    belgeTuru: secilen.belgeTuru,
    ilgili: secilen.ilgili || null,
    tarih: secilen.tarih || null,
    onerilenAd: onerilenAd(dosyaAdi, secilen),
    alternatif: kural.alternatif || [],
    notlar,
  };
}
