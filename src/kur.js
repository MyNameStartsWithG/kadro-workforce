/**
 * Sabit kur: elle girilen oranlar (online kur yok).
 *
 * Ayar: { ana: "EUR", oran: { RSD: 117, TRY: 45 } } → 1 EUR = 117 RSD, 1 EUR = 45 TRY.
 * Ana para birimi özetlerde "≈ toplam" için kullanılır. Puantaj dönemi açılırken kur döneme kopyalanır;
 * ödeme ve kesintiler dönemin kuruyla çevrilir, sonradan değişen kur açılmış dönemleri etkilemez.
 */
import * as db from "./db.js";

export const PARA_BIRIMLERI = ["EUR", "TRY", "RSD"];
export const VARSAYILAN_KUR = { ana: "EUR", oran: { RSD: 117 } };

const sayi = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const tr = (n, basamak = 4) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: basamak });

/** Gelen kur ayarını doğrular; geçersiz oranlar atılır. */
export function dogrula(k) {
  const ana = PARA_BIRIMLERI.includes(k?.ana) ? k.ana : "EUR";
  const oran = {};
  for (const pb of PARA_BIRIMLERI) {
    if (pb === ana) continue;
    const v = k?.oran?.[pb];
    if (v === undefined || v === null || v === "") continue;
    const n = sayi(v);
    if (!(n > 0) || n > 1e9) throw new Error(`Kur geçersiz: 1 ${ana} = ${v} ${pb}. Sıfırdan büyük bir sayı yazın.`);
    oran[pb] = Number(n.toPrecision(10));   // 1 RSD = 0,008547008547 EUR gibi küçük oranlar da korunur
  }
  return { ana, oran };
}

/** Ayarlardaki güncel kur. */
export function kurAyari() {
  try { return dogrula(db.ayarlar().kur || VARSAYILAN_KUR); } catch { return { ...VARSAYILAN_KUR }; }
}

const oranlar = (kur) => ({ ...(kur?.oran || {}), [kur?.ana || "EUR"]: 1 });

/** 1 kaynak = x hedef. Kur yoksa null. */
export function carpan(kaynak, hedef, kur) {
  if (kaynak === hedef) return 1;
  const o = oranlar(kur);
  return o[kaynak] && o[hedef] ? o[hedef] / o[kaynak] : null;
}

/** Tutarı çevirir; kur yoksa null. */
export function cevir(tutar, kaynak, hedef, kur) {
  const c = carpan(kaynak, hedef, kur);
  return c === null ? null : tutar * c;
}

/** Çevirinin okunur hâli: "÷ 117", "× 117"; ikisi de ana değilse ana üzerinden "÷ 117 × 45". */
export function cevirmeMetni(kaynak, hedef, kur) {
  const c = carpan(kaynak, hedef, kur);
  if (c === null || c === 1) return "";
  const ana = kur?.ana || "EUR", o = oranlar(kur);
  if (kaynak !== ana && hedef !== ana) return `÷ ${tr(o[kaynak])} × ${tr(o[hedef])}`;
  return c < 1 ? `÷ ${tr(1 / c)}` : `× ${tr(c)}`;
}

/** { EUR: 10, RSD: 1170 } → ana para biriminde toplam; kuru olmayanlar `eksik`te. */
export function anaToplam(toplam, kur) {
  const ana = kur?.ana || "EUR";
  let tutar = 0;
  const eksik = [];
  for (const [pb, v] of Object.entries(toplam || {})) {
    if (!v) continue;
    const c = cevir(v, pb, ana, kur);
    if (c === null) eksik.push(pb); else tutar += c;
  }
  return { pb: ana, tutar: Math.round(tutar * 100) / 100, eksik };
}
