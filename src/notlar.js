/**
 * Kişi notları: personel sayfasındaki Notlar paneli. Her not bir ad ve metinden oluşur, ayrı ayrı kaydedilir,
 * düzenlenir ve silinir. Yönetici notudur: çalışan sayfasına, sesli komuta ve Excel'e girmez.
 */
import * as db from "./db.js";

const kayitlar = () => { const v = db.tum(); v.notlar = v.notlar || []; return v.notlar; };

/** Not adı boşsa metnin ilk satırından üretilir. */
function hazirla({ ad, metin }) {
  const m = String(metin ?? "").replace(/\r\n/g, "\n").trim();
  if (!m) throw new Error("Not boş olamaz.");
  const a = String(ad ?? "").trim() || m.split("\n")[0].slice(0, 60);
  if (a.length > 120) throw new Error("Not adı en çok 120 karakter olabilir.");
  return { ad: a, metin: m };
}

export const liste = (personelKod) => kayitlar()
  .filter((n) => n.personelKod === personelKod)
  .sort((a, b) => String(b.guncelleme || b.olusturma).localeCompare(String(a.guncelleme || a.olusturma)));

export function ekle(personelKod, alanlar) {
  if (!db.satirBul("personel", (x) => x.kod === personelKod)) throw new Error(`"${personelKod}" kodlu personel bulunamadı.`);
  const n = { _id: db.yeniId(), personelKod, ...hazirla(alanlar), olusturma: new Date().toISOString(), kullanici: db.ayarlar().kullanici };
  kayitlar().push(n);
  db.yaz();
  return n;
}

export function guncelle(id, alanlar) {
  const n = kayitlar().find((x) => x._id === id);
  if (!n) throw new Error("Not bulunamadı.");
  Object.assign(n, hazirla(alanlar), { guncelleme: new Date().toISOString() });
  db.yaz();
  return n;
}

export function sil(id) {
  const v = db.tum();
  const once = kayitlar().length;
  v.notlar = kayitlar().filter((x) => x._id !== id);
  if (v.notlar.length === once) throw new Error("Not bulunamadı.");
  db.yaz();
}

/** Personel silinince notları da silinir. */
export function kisininNotlariniSil(personelKod) {
  db.tum().notlar = kayitlar().filter((x) => x.personelKod !== personelKod);
}

/**
 * Eski tek satırlık "Notlar" alanı bir kez "Genel not" olarak panele taşınır. Asıl alan silinmez;
 * kişi `notlarTasindi` ile işaretlenir, not sonradan silinse de tekrar taşınmaz.
 */
export function eskiNotlariTasi() {
  let degisti = false;
  for (const p of db.tablo("personel")) {
    if (p.notlarTasindi) continue;
    const metin = String(p.notlar || "").trim();
    if (metin) kayitlar().push({ _id: db.yeniId(), personelKod: p.kod, ad: "Genel not", metin, olusturma: p._olusturma || new Date().toISOString(), kullanici: "taşındı" });
    p.notlarTasindi = true;
    degisti = true;
  }
  if (degisti) db.yaz();
}
