/**
 * Tabloları .xlsx olarak dışa aktarır ve geri okur.
 * Dışa aktarılan dosya Excel'de doğrudan düzenlenip tekrar içe aktarılabilir:
 * başlık satırı sütun anahtarını taşır, seçim sütunlarında açılır liste vardır.
 */
import ExcelJS from "exceljs";
import { TABLOLAR } from "./tablolar.js";

const TURUNCU = "FFE85D04";
const SIYAH = "FF141210";
const ACIK = "FFF6F3F0";

function bicimlendir(deger, tur) {
  if (deger === undefined || deger === null || deger === "") return null;
  if (tur === "sayi" || tur === "para") {
    const n = Number(String(deger).replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (tur === "tarih") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(deger).trim());
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : String(deger);
  }
  return String(deger);
}

function tarihMetnine(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  return s;
}

export async function tabloyuYaz(tabloAdi, satirlar) {
  const tanim = TABLOLAR[tabloAdi];
  if (!tanim) throw new Error(`Bilinmeyen tablo: ${tabloAdi}`);

  const kitap = new ExcelJS.Workbook();
  kitap.creator = "KADRO DMS";
  kitap.created = new Date();
  const sayfa = kitap.addWorksheet(tanim.ad, {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // 1. satır: başlık bandı
  sayfa.mergeCells(1, 1, 1, tanim.kolon.length);
  const bant = sayfa.getCell(1, 1);
  bant.value = `ACME MÜHENDİSLİK — ${tanim.ad}   ·   ${new Date().toLocaleDateString("tr-TR")}   ·   ${satirlar.length} kayıt`;
  bant.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  bant.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SIYAH } };
  bant.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sayfa.getRow(1).height = 26;

  // 2. satır: sütun başlıkları
  const basliklar = sayfa.getRow(2);
  tanim.kolon.forEach((k, i) => {
    const h = basliklar.getCell(i + 1);
    h.value = k.b;
    h.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TURUNCU } };
    h.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
    h.border = { bottom: { style: "thin", color: { argb: SIYAH } } };
    sayfa.getColumn(i + 1).width = Math.max(10, Math.round((k.gen || 120) / 8));
  });
  basliklar.height = 22;

  // Veri satırları
  satirlar.forEach((satir, ri) => {
    const r = sayfa.getRow(ri + 3);
    tanim.kolon.forEach((k, ci) => {
      const h = r.getCell(ci + 1);
      h.value = bicimlendir(satir[k.k], k.tur);
      h.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      if (k.tur === "tarih") h.numFmt = "yyyy-mm-dd";
      if (k.tur === "para") h.numFmt = "#,##0.00";
      if (ri % 2 === 1) h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACIK } };
      if (k.tur === "salt") h.font = { color: { argb: "FF8A8078" } };
    });
    r.height = 18;
  });

  // Seçim sütunlarına açılır liste
  tanim.kolon.forEach((k, ci) => {
    if (k.tur !== "secim" || !k.secenek?.length) return;
    for (let r = 3; r <= Math.max(satirlar.length + 2, 500); r += 1) {
      sayfa.getCell(r, ci + 1).dataValidation = {
        type: "list", allowBlank: true,
        formulae: [`"${k.secenek.join(",")}"`],
      };
    }
  });

  sayfa.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: tanim.kolon.length } };
  return kitap.xlsx.writeBuffer();
}

/** Yüklenen .xlsx dosyasını okuyup satır nesnelerine çevirir. */
export async function tabloyuOku(tabloAdi, tampon) {
  const tanim = TABLOLAR[tabloAdi];
  if (!tanim) throw new Error(`Bilinmeyen tablo: ${tabloAdi}`);

  const kitap = new ExcelJS.Workbook();
  await kitap.xlsx.load(tampon);
  const sayfa = kitap.worksheets[0];
  if (!sayfa) throw new Error("Dosyada okunabilir bir sayfa yok.");

  // Başlık satırını bul: sütun adlarının en çok eşleştiği ilk 5 satır içinde.
  const etiketler = new Map(tanim.kolon.map((k) => [k.b.toLocaleLowerCase("tr"), k]));
  let baslikSatiri = 0, esleme = null, enIyi = 0;

  for (let r = 1; r <= Math.min(6, sayfa.rowCount); r += 1) {
    const harita = new Map();
    let sayac = 0;
    sayfa.getRow(r).eachCell({ includeEmpty: false }, (hucre, ci) => {
      const metin = String(hucre.text || "").trim().toLocaleLowerCase("tr");
      const k = etiketler.get(metin);
      if (k) { harita.set(ci, k); sayac += 1; }
    });
    if (sayac > enIyi) { enIyi = sayac; baslikSatiri = r; esleme = harita; }
  }
  if (!esleme || enIyi === 0) {
    throw new Error("Başlık satırı bulunamadı. Lütfen sistemden indirdiğiniz şablonu kullanın.");
  }

  const satirlar = [];
  for (let r = baslikSatiri + 1; r <= sayfa.rowCount; r += 1) {
    const kaynak = sayfa.getRow(r);
    const nesne = {};
    let doluMu = false;
    for (const [ci, k] of esleme) {
      const hucre = kaynak.getCell(ci);
      let v = hucre.value;
      if (v && typeof v === "object" && "result" in v) v = v.result;
      if (v && typeof v === "object" && "text" in v) v = v.text;
      if (v === null || v === undefined || v === "") { nesne[k.k] = ""; continue; }
      nesne[k.k] = k.tur === "tarih" ? tarihMetnine(v) : String(v).trim();
      if (nesne[k.k]) doluMu = true;
    }
    if (doluMu) satirlar.push(nesne);
  }
  return { satirlar, baslikSatiri, taninanSutun: enIyi };
}

/* ------------------------------------------------------------------ */
/* Puantaj                                                             */
/* ------------------------------------------------------------------ */

const TIP_RENK = { mesai: "FFFCEADD", tatil: "FFE7E0D9" };
const PB_SIRA = ["EUR", "TRY", "RSD"];
const pbMetni = (t) => PB_SIRA.concat(Object.keys(t || {}).filter((k) => !PB_SIRA.includes(k)))
  .filter((k) => t?.[k]).map((k) => `${t[k].toLocaleString("tr-TR")} ${k}`).join("  ·  ") || "—";

/**
 * Dönemi .xlsx olarak yazar. Saat hücreleri sayıdır, toplamlar Excel formülüdür.
 * Dosya Excel'de düzenlenip "Excel'den yükle" ile geri okunabilir (sadece gün hücreleri okunur).
 */
export async function puantajYaz(p, hesap, gunler, baslik) {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "KADRO DMS";
  kitap.created = new Date();
  const sayfa = kitap.addWorksheet("Puantaj", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const sabit = ["Personel Kodu", "Ad Soyad", "Ekip"];
  const sag = ["Toplam", "Normal", "Mesai", "Eksik", "Ödeme", "Ücret", "Hakediş", "Kesinti", "Avans", "Net", "Para Birimi"];
  const ilkGun = sabit.length + 1;
  const sonGun = sabit.length + gunler.length;
  const sutunSayisi = sonGun + sag.length;

  sayfa.mergeCells(1, 1, 1, sutunSayisi);
  const bant = sayfa.getCell(1, 1);
  bant.value = `ACME MÜHENDİSLİK — Puantaj · ${baslik}   ·   çarpan ${p.ayar.mesaiCarpani}   ·   normal gün ${p.ayar.normalSaat} saat` +
    (p.durum === "kapali" ? "   ·   KAPALI" : "");
  bant.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  bant.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SIYAH } };
  bant.alignment = { vertical: "middle", indent: 1 };
  sayfa.getRow(1).height = 26;

  // 2. satır gün adı, 3. satır gün numarası (geri okumada sütun anahtarı budur).
  const basBicim = (h, renk = TURUNCU) => {
    h.font = { name: "Calibri", size: 10, bold: true, color: { argb: renk === TURUNCU ? "FFFFFFFF" : SIYAH } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: renk } };
    h.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  };
  sabit.forEach((b, i) => { sayfa.mergeCells(2, i + 1, 3, i + 1); const h = sayfa.getCell(2, i + 1); h.value = b; basBicim(h); });
  gunler.forEach((g, i) => {
    const renk = TIP_RENK[p.gunler[g.gun]] || TURUNCU;
    const h1 = sayfa.getCell(2, ilkGun + i), h2 = sayfa.getCell(3, ilkGun + i);
    h1.value = g.kisa; h2.value = g.no;
    basBicim(h1, renk); basBicim(h2, renk);
    sayfa.getColumn(ilkGun + i).width = 5.2;
  });
  sag.forEach((b, i) => { const c = sonGun + 1 + i; sayfa.mergeCells(2, c, 3, c); const h = sayfa.getCell(2, c); h.value = b; basBicim(h); });
  sayfa.getColumn(1).width = 16; sayfa.getColumn(2).width = 24; sayfa.getColumn(3).width = 10;
  sag.forEach((_, i) => { sayfa.getColumn(sonGun + 1 + i).width = 11; });

  const harf = (c) => sayfa.getColumn(c).letter;
  const ilkVeri = 4;
  p.satirlar.forEach((s, ri) => {
    const h = hesap.satirlar[ri];
    const r = sayfa.getRow(ilkVeri + ri);
    r.getCell(1).value = s.personelKod;
    r.getCell(2).value = s.ad;
    r.getCell(3).value = s.ekip || "—";
    gunler.forEach((g, i) => {
      const hucre = r.getCell(ilkGun + i);
      const v = s.hucre[g.gun] || "";
      hucre.value = /^\d/.test(v) ? Number(v) : (v || null);
      hucre.alignment = { horizontal: "center" };
      const renk = TIP_RENK[p.gunler[g.gun]];
      if (renk) hucre.fill = { type: "pattern", pattern: "solid", fgColor: { argb: renk } };
      if (s.ekipGun[g.gun]) hucre.note = `Bu gün ekibi: ${s.ekipGun[g.gun]}`;
    });
    const n = ilkVeri + ri;
    const c0 = sonGun + 1;
    r.getCell(c0).value = { formula: `SUM(${harf(ilkGun)}${n}:${harf(sonGun)}${n})`, result: h.toplam };
    r.getCell(c0 + 1).value = h.normal;
    r.getCell(c0 + 2).value = h.mesai;
    r.getCell(c0 + 3).value = h.eksik;
    r.getCell(c0 + 4).value = s.odemeTuru || "—";
    r.getCell(c0 + 5).value = Number(s.ucret) || null;
    r.getCell(c0 + 6).value = h.hakedis;
    r.getCell(c0 + 7).value = h.kesinti || null;
    if (h.kesintiKalem?.length) r.getCell(c0 + 7).note = h.kesintiKalem.map((k) => `${k.ad}: ${k.formul} = ${k.tutar} ${k.pb}${k.dusulmedi ? " (düşülmedi)" : ""}`).join("\n");
    r.getCell(c0 + 8).value = (h.avansDusulen ?? h.avans[h.paraBirimi]) || null;
    r.getCell(c0 + 9).value = h.net[h.paraBirimi];
    r.getCell(c0 + 10).value = h.paraBirimi;
    for (let c = c0 + 5; c <= c0 + 9; c += 1) r.getCell(c).numFmt = "#,##0.00";
    if (ri % 2 === 1) [1, 2, 3].forEach((c) => { r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACIK } }; });
  });

  // Toplam satırı: saat sütunlarında formül.
  if (p.satirlar.length) {
    const son = ilkVeri + p.satirlar.length - 1;
    const t = sayfa.getRow(son + 2);
    t.getCell(2).value = "TOPLAM";
    t.font = { bold: true };
    for (let c = ilkGun; c <= sonGun + 4; c += 1) {
      t.getCell(c).value = { formula: `SUM(${harf(c)}${ilkVeri}:${harf(c)}${son})` };
      t.getCell(c).alignment = { horizontal: "center" };
    }
  }

  const o = kitap.addWorksheet("Özet");
  o.getColumn(1).width = 30; o.getColumn(2).width = 48;
  const z = hesap.ozet;
  [
    ["Dönem", baslik],
    ["Durum", p.durum === "kapali" ? "Kapalı" : "Açık"],
    ["Kişi sayısı", z.kisi],
    ["Ekip sayısı", z.ekip],
    ["Toplam çalışma saati", z.toplamSaat],
    ["Normal saat", z.normal],
    ["Mesai saati", z.mesai],
    ["Eksik iş saati", z.eksik],
    ["İzin / rapor / gelmedi (gün)", `${z.izin} / ${z.rapor} / ${z.gelmedi}`],
    ["Hakediş", pbMetni(z.hakedis)],
    ["Kesinti", pbMetni(z.kesinti)],
    ["Avans", pbMetni(z.avans)],
    ["Net", pbMetni(z.net)],
    ...(Object.keys(z.aySonu).length ? [["Ay sonu ödenecek (iki yarı)", pbMetni(z.aySonu)]] : []),
    ["Yemek", pbMetni(z.yemek)],
    ["Kira payı", pbMetni(z.kira)],
    ["Mesai çarpanı", p.ayar.mesaiCarpani],
    ["Normal gün saati", p.ayar.normalSaat],
    ["Hafta içi aşım mesai mi", p.ayar.haftaIciAsim ? "Evet" : "Hayır"],
    ["Tatilde çalışma mesai mi", p.ayar.tatilMesai ? "Evet" : "Hayır"],
    ...(p.ayar.kur && (p.kural || 1) >= 3
      ? [["Kur", Object.entries(p.ayar.kur.oran || {}).map(([pb, v]) => `1 ${p.ayar.kur.ana} = ${v} ${pb}`).join(" · ") || "girilmedi"]] : []),
  ].forEach(([a, b], i) => {
    const r = o.getRow(i + 1);
    r.getCell(1).value = a; r.getCell(2).value = b;
    r.getCell(1).font = { bold: true };
  });

  return kitap.xlsx.writeBuffer();
}

/** Excel'den gün hücrelerini okur. Döner: { degisiklikler: [{ personelKod, gun, deger }], bilinmeyen } */
export async function puantajOku(tampon, p, gunler) {
  const kitap = new ExcelJS.Workbook();
  await kitap.xlsx.load(tampon);
  const sayfa = kitap.getWorksheet("Puantaj") || kitap.worksheets[0];
  if (!sayfa) throw new Error("Dosyada okunabilir bir sayfa yok.");

  let basSatiri = 0, kodSutunu = 0;
  for (let r = 1; r <= Math.min(8, sayfa.rowCount) && !kodSutunu; r += 1) {
    sayfa.getRow(r).eachCell({ includeEmpty: false }, (h, c) => {
      if (String(h.text).trim().toLocaleLowerCase("tr") === "personel kodu") { kodSutunu = c; basSatiri = r; }
    });
  }
  if (!kodSutunu) throw new Error("\"Personel Kodu\" sütunu bulunamadı. Sistemden indirdiğiniz puantaj dosyasını kullanın.");

  // Gün numarası başlık satırında ya da hemen altında olabilir.
  const numaradan = new Map(gunler.map((g) => [g.no, g.gun]));
  const sutunGun = new Map();
  let veriBasi = basSatiri + 1;
  for (let r = basSatiri; r <= basSatiri + 1; r += 1) {
    let bulundu = false;
    sayfa.getRow(r).eachCell({ includeEmpty: false }, (h, c) => {
      const n = Number(h.value);
      if (c > kodSutunu && Number.isInteger(n) && numaradan.has(n) && !sutunGun.has(c)) { sutunGun.set(c, numaradan.get(n)); bulundu = true; }
    });
    if (bulundu) veriBasi = r + 1;
  }
  if (!sutunGun.size) throw new Error("Gün sütunları bulunamadı. Dosya bu döneme ait olmayabilir.");

  const kodlar = new Set(p.satirlar.map((s) => s.personelKod));
  const degisiklikler = [], bilinmeyen = [];
  for (let r = veriBasi; r <= sayfa.rowCount; r += 1) {
    const satir = sayfa.getRow(r);
    const kod = String(satir.getCell(kodSutunu).text || "").trim();
    if (!kod || kod === "TOPLAM") continue;
    if (!kodlar.has(kod)) { if (/^[A-Z]{2,4}-/.test(kod)) bilinmeyen.push(kod); continue; }
    for (const [c, gun] of sutunGun) {
      let v = satir.getCell(c).value;
      if (v && typeof v === "object" && "result" in v) v = v.result;
      degisiklikler.push({ personelKod: kod, gun, deger: v === null || v === undefined ? "" : String(v) });
    }
  }
  return { degisiklikler, bilinmeyen };
}

/* ------------------------------------------------------------------ */
/* Kasa                                                                */
/* ------------------------------------------------------------------ */

const pbSirali = (...toplamlar) => {
  const var_ = new Set(toplamlar.flatMap((t) => Object.keys(t || {})));
  return PB_SIRA.filter((k) => var_.has(k)).concat([...var_].filter((k) => !PB_SIRA.includes(k)));
};

function bantYaz(sayfa, sutun, metin) {
  sayfa.mergeCells(1, 1, 1, sutun);
  const bant = sayfa.getCell(1, 1);
  bant.value = metin;
  bant.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  bant.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SIYAH } };
  bant.alignment = { vertical: "middle", indent: 1 };
  sayfa.getRow(1).height = 26;
}

function baslikYaz(satir, basliklar) {
  basliklar.forEach((b, i) => {
    const h = satir.getCell(i + 1);
    h.value = b;
    h.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TURUNCU } };
    h.alignment = { vertical: "middle", indent: 1 };
  });
  satir.height = 20;
}

/** Aylık kasa dosyası: hareketler + özet (devir, gelir, gider, bakiye, kategori dağılımı). */
export async function kasaYaz(v) {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "KADRO DMS";
  kitap.created = new Date();

  const s = kitap.addWorksheet("Kasa", { views: [{ state: "frozen", ySplit: 2 }] });
  const sutunlar = [["Tarih", 12], ["Tür", 8], ["Kategori", 20], ["Açıklama", 46], ["Proje", 24], ["Personel", 22],
    ["Gelir", 13], ["Gider", 13], ["Para Birimi", 10], ["Kaynak", 9], ["Durum", 15]];
  bantYaz(s, sutunlar.length, `ACME MÜHENDİSLİK — Kasa · ${v.ad}   ·   ${v.satirlar.length} hareket   ·   ${new Date().toLocaleString("tr-TR")}`);
  baslikYaz(s.getRow(2), sutunlar.map(([b]) => b));
  sutunlar.forEach(([, g], i) => { s.getColumn(i + 1).width = g; });

  v.satirlar.forEach((r, i) => {
    const row = s.getRow(i + 3);
    const tutar = Number(String(r.tutar).replace(",", ".")) || 0;
    row.values = [
      bicimlendir(r.tarih, "tarih"), r.tur, r.kategori || "", r.aciklama || "",
      r.projeAd || "", r.personelAd || "",
      r.tur === "Gelir" ? tutar : null, r.tur === "Gelir" ? null : tutar,
      r.paraBirimi || "EUR", r.kaynak || "Elle", r.durumEtiketi || "",
    ];
    row.getCell(1).numFmt = "yyyy-mm-dd";
    row.getCell(7).numFmt = "#,##0.00"; row.getCell(8).numFmt = "#,##0.00";
    if (i % 2 === 1) row.eachCell((h) => { h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACIK } }; });
  });
  if (v.satirlar.length) s.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sutunlar.length } };

  const o = kitap.addWorksheet("Özet");
  const z = v.ozet;
  const pbler = pbSirali(z.devir, z.gelir, z.gider, z.bakiye);
  bantYaz(o, 1 + Math.max(1, pbler.length), `Kasa özeti · ${v.ad}`);
  o.getColumn(1).width = 34;
  pbler.forEach((_, i) => { o.getColumn(i + 2).width = 16; });
  baslikYaz(o.getRow(3), ["", ...pbler]);
  const yaz = (no, etiket, t, kalin) => {
    const row = o.getRow(no);
    row.getCell(1).value = etiket;
    pbler.forEach((pb, i) => { const h = row.getCell(i + 2); h.value = t?.[pb] || 0; h.numFmt = "#,##0.00"; });
    if (kalin) row.font = { bold: true };
  };
  yaz(4, "Devir (önceki aylardan)", z.devir);
  yaz(5, "Gelir", z.gelir);
  yaz(6, "Gider", z.gider);
  yaz(7, "Bakiye (ay sonu)", z.bakiye, true);

  let n = 9;
  baslikYaz(o.getRow(n), ["Kategori dağılımı", ...pbler]);
  for (const k of z.kategoriler) yaz(++n, `${k.tur} · ${k.kategori}`, k.tutar);
  n += 2;
  baslikYaz(o.getRow(n), ["Proje (gelir − gider)", ...pbler]);
  for (const p of z.projeler) yaz(++n, p.ad, p.net);
  if (v.silinen?.length) {
    n += 2;
    o.getRow(n).getCell(1).value = `Not: bu ay ${v.silinen.length} otomatik satır elle silindi; dosyada yer almaz.`;
  }
  return kitap.xlsx.writeBuffer();
}

/** Kasa raporu: her kova bir satır, her para birimi için devir / gelir / gider / bakiye. */
export async function kasaRaporYaz(r, baslik) {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "KADRO DMS";
  kitap.created = new Date();
  const pbler = pbSirali(r.toplam.devir, r.toplam.gelir, r.toplam.gider, r.toplam.bakiye,
    ...r.kovalar.flatMap((k) => [k.devir, k.gelir, k.gider]));
  const alanlar = [["devir", "Devir"], ["gelir", "Gelir"], ["gider", "Gider"], ["net", "Net"], ["bakiye", "Bakiye"]];

  const s = kitap.addWorksheet("Rapor", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  const sutun = 1 + pbler.length * alanlar.length;
  bantYaz(s, Math.max(2, sutun), `ACME MÜHENDİSLİK — ${baslik}`);
  s.getColumn(1).width = 30;
  // 2. satır: para birimi, 3. satır: alan
  pbler.forEach((pb, i) => {
    const c = 2 + i * alanlar.length;
    s.mergeCells(2, c, 2, c + alanlar.length - 1);
    const h = s.getCell(2, c);
    h.value = pb;
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SIYAH } };
    h.alignment = { horizontal: "center" };
  });
  baslikYaz(s.getRow(3), [r.tur === "proje" ? "Proje" : "Dönem", ...pbler.flatMap(() => alanlar.map(([, b]) => b))]);
  for (let c = 2; c <= sutun; c += 1) s.getColumn(c).width = 13;

  const satirYaz = (no, etiket, k, kalin) => {
    const row = s.getRow(no);
    row.getCell(1).value = etiket;
    pbler.forEach((pb, i) => alanlar.forEach(([a], j) => {
      const h = row.getCell(2 + i * alanlar.length + j);
      h.value = k[a]?.[pb] || 0;
      h.numFmt = "#,##0.00";
    }));
    if (kalin) row.font = { bold: true };
  };
  r.kovalar.forEach((k, i) => satirYaz(4 + i, k.ad, k));
  satirYaz(5 + r.kovalar.length, "TOPLAM", r.toplam, true);

  const kt = kitap.addWorksheet("Kategoriler");
  kt.getColumn(1).width = 34;
  baslikYaz(kt.getRow(1), ["Kategori", ...pbler]);
  r.toplam.kategoriler.forEach((k, i) => {
    const row = kt.getRow(2 + i);
    row.getCell(1).value = `${k.tur} · ${k.kategori}`;
    pbler.forEach((pb, j) => { row.getCell(2 + j).value = k.tutar[pb] || 0; row.getCell(2 + j).numFmt = "#,##0.00"; });
  });

  const pr = kitap.addWorksheet("Projeler");
  pr.getColumn(1).width = 34;
  baslikYaz(pr.getRow(1), ["Proje", ...pbler.flatMap((pb) => [`Gelir ${pb}`, `Gider ${pb}`, `Net ${pb}`])]);
  r.toplam.projeler.forEach((p, i) => {
    const row = pr.getRow(2 + i);
    row.getCell(1).value = p.ad;
    pbler.forEach((pb, j) => ["gelir", "gider", "net"].forEach((a, m) => {
      const h = row.getCell(2 + j * 3 + m); h.value = p[a][pb] || 0; h.numFmt = "#,##0.00";
    }));
  });
  return kitap.xlsx.writeBuffer();
}

/* ------------------------------------------------------------------ */
/* Öngörü                                                              */
/* ------------------------------------------------------------------ */

/** Öngörü tablosu: her para birimi ayrı sayfa, sütunlar dönemler. Gerçekleşen sütunlar gri, elle düzeltilen hücre sarı. */
export async function ongoruYaz(v) {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "KADRO DMS";
  kitap.created = new Date();
  const GRI = "FFE7E0D9", SARI = "FFFCEEDC";

  for (const pb of v.pbler) {
    const s = kitap.addWorksheet(`Öngörü ${pb}`, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    const sutun = 1 + v.sutunlar.length;
    bantYaz(s, sutun, `ACME MÜHENDİSLİK — Öngörü · ${pb} · ${v.projeAd}   ·   ${new Date().toLocaleDateString("tr-TR")}`);
    s.getColumn(1).width = 26;
    v.sutunlar.forEach((c, i) => {
      const n = i + 2;
      s.getColumn(n).width = 13;
      const ay = s.getCell(2, n), yari = s.getCell(3, n), durum = s.getCell(4, n);
      ay.value = c.ay; yari.value = `${c.yari}. yarı (${c.aralik})`; durum.value = c.durum === "gercek" ? "gerçekleşen" : "tahmin";
      for (const h of [ay, yari, durum]) {
        h.font = { bold: h !== durum, size: 10, color: { argb: c.durum === "gercek" ? SIYAH : "FFFFFFFF" } };
        h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.durum === "gercek" ? GRI : TURUNCU } };
        h.alignment = { horizontal: "center" };
      }
    });
    s.getCell(4, 1).value = "Kalem"; s.getCell(4, 1).font = { bold: true };

    let r = 5;
    const yaz = (etiket, hucre, kalin) => {
      const row = s.getRow(r++);
      row.getCell(1).value = etiket;
      if (kalin) row.font = { bold: true };
      v.sutunlar.forEach((c, i) => {
        const h = row.getCell(i + 2);
        const x = hucre(c);
        h.value = x?.deger ?? x ?? 0;
        h.numFmt = "#,##0.00";
        if (c.durum === "gercek") h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACIK } };
        if (x?.elle) { h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SARI } }; h.note = `Elle düzeltildi. Sistemin hesabı: ${x.sistem}`; }
      });
    };
    for (const k of v.satirlar.filter((x) => x.tur === "gider")) yaz(k.ad, (c) => v.degerler[k.k][c.donem]?.[pb]);
    yaz("Toplam gider", (c) => v.toplam.gider[c.donem][pb], true);
    yaz("Gelirler", (c) => v.degerler.gelir[c.donem]?.[pb]);
    yaz("Net (gelir − gider)", (c) => v.toplam.net[c.donem][pb], true);
    yaz("Kasa bakiyesi", (c) => v.toplam.bakiye[c.donem][pb], true);
  }

  const k = kitap.addWorksheet("Kaynaklar");
  k.getColumn(1).width = 18; k.getColumn(2).width = 60; k.getColumn(3).width = 80;
  baslikYaz(k.getRow(1), ["Kalem", "Gerçekleşen", "Tahmin"]);
  v.satirlar.forEach((x, i) => { k.getRow(i + 2).values = [x.ad, x.gercek, x.tahmin]; });
  k.getRow(v.satirlar.length + 3).values = ["Kasa bakiyesi", "Kasadaki gerçek bakiye (dönem sonu)", "Bir önceki dönemin bakiyesi + tahmini net"];
  return kitap.xlsx.writeBuffer();
}
