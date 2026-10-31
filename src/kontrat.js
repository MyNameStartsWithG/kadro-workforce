/**
 * Çalışma dönemleri (kontratlar): kişinin hangi tarihler arasında, hangi projede çalıştığı.
 *
 * Tür "Çalışma": kişinin işte olduğu aralık. Bitiş boşsa süresizdir; dolu ise işten çıkış tarihidir ve önceden girilebilir.
 * Tür "İzin":    çalışma içinde uzun izin (ör. memlekete dönüş). Sadece durumu "İzinli" yapar, hesaba girmez.
 *
 * Çalışma dönemi olan kişide:
 *  - Durum bugüne göre buradan hesaplanır (Aktif / İzinli / Ayrıldı); elle değiştirilmez.
 *  - Puantaj dönemine, çalışma dönemi o 15 günle kesişiyorsa alınır. Aralık dışındaki günler (kural 2+) işe giriş
 *    öncesi gibi hiçbir hesaba girmez: saat, maaş payı, yemek, kira ve kesinti yok.
 *  - Aralıklar açık puantaj dönemlerine `satir.calisma` olarak kopyalanır ve değiştikçe güncellenir.
 *    Kapalı dönemler kapandığı andaki hâliyle kalır.
 * Çalışma dönemi olmayan kişide her şey eskisi gibi elle girilen duruma göre işler.
 */
import * as db from "./db.js";

export const TURLER = ["Çalışma", "İzin"];

const pad = (n) => String(n).padStart(2, "0");
const bugunMetni = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const tarihMi = (t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t || ""));
const turu = (r) => (r.tur === "İzin" ? "İzin" : "Çalışma");

/** Kişinin kayıtları, başlangıca göre sıralı. */
export const kisininKayitlari = (kod) => db.tablo("kontrat")
  .filter((r) => r.personelKod === kod && tarihMi(r.baslangic))
  .sort((a, b) => a.baslangic.localeCompare(b.baslangic));

/** Kişinin çalışma aralıkları: [[baslangic, bitis | ""], …]. Çalışma kaydı yoksa null (kişi kontratsız). */
export function araliklar(kod) {
  const r = kisininKayitlari(kod).filter((x) => turu(x) === "Çalışma");
  return r.length ? r.map((x) => [x.baslangic, tarihMi(x.bitis) ? x.bitis : ""]) : null;
}

export const icinde = (ar, gun) => ar.some(([b, e]) => gun >= b && (!e || gun <= e));
export const kesisir = (ar, bas, bit) => ar.some(([b, e]) => b <= bit && (!e || e >= bas));

/** Kişinin verilen gündeki durumu. Çalışma kaydı yoksa null (durum elle ayarlanır). */
export function durumHesapla(kod, gun = bugunMetni()) {
  const kayit = kisininKayitlari(kod);
  const ar = araliklar(kod);
  if (!ar) return null;
  if (kayit.some((r) => turu(r) === "İzin" && gun >= r.baslangic && (!tarihMi(r.bitis) || gun <= r.bitis))) return "İzinli";
  if (icinde(ar, gun)) return "Aktif";
  // Henüz başlamamış (ileri tarihli işe alım) kişi de aktif sayılır; puantaja başlangıç gününden itibaren girer.
  return ar.some(([b]) => b > gun) ? "Aktif" : "Ayrıldı";
}

/** Bir kaydın bugünkü hâli (tablo ve kişi sayfasında gösterilir). */
export function kayitDurumu(r, gun = bugunMetni()) {
  if (!tarihMi(r.baslangic)) return "";
  if (r.baslangic > gun) return "Başlamadı";
  if (tarihMi(r.bitis) && r.bitis < gun) return "Bitti";
  return turu(r) === "İzin" ? "İzinde" : "Sürüyor";
}

/** Kayıt kaydedilmeden önce: alanlar ve aynı kişinin diğer kayıtlarıyla çakışma. */
export function dogrula(satir) {
  if (!db.satirBul("personel", (x) => x.kod === satir.personelKod)) {
    throw new Error(satir.personelKod ? `"${satir.personelKod}" kodlu personel bulunamadı.` : "Bir personel seçin.");
  }
  satir.tur = turu(satir);
  if (!tarihMi(satir.baslangic)) throw new Error("Başlangıç tarihi geçersiz.");
  if (satir.bitis && !tarihMi(satir.bitis)) throw new Error("Bitiş tarihi geçersiz.");
  if (satir.bitis && satir.bitis < satir.baslangic) throw new Error("Bitiş tarihi başlangıçtan önce olamaz.");
  if (satir.proje && !db.satirBul("proje", (x) => x.kod === satir.proje)) throw new Error(`"${satir.proje}" kodlu proje bulunamadı.`);
  const son = (r) => (tarihMi(r.bitis) ? r.bitis : "9999-12-31");
  const cakisan = kisininKayitlari(satir.personelKod)
    .find((r) => r._id !== satir._id && turu(r) === satir.tur && r.baslangic <= son(satir) && son(r) >= satir.baslangic);
  if (cakisan) {
    const ad = satir.tur === "İzin" ? "izin" : "çalışma dönemi";
    throw new Error(`Bu tarihler kişinin başka bir ${ad} kaydıyla çakışıyor (${cakisan.baslangic} – ${cakisan.bitis || "süresiz"}). ` +
      "Proje değişiyorsa önceki dönemin bitişini bir gün öncesine çekin.");
  }
}

/** Kişinin durumu çalışma dönemlerinden geliyor mu (kişi sayfasında durum alanı kilitlenir). */
export const durumOtomatikMi = (kod) => Boolean(araliklar(kod));

/**
 * Personel durumlarını bugüne göre günceller ve açık puantaj dönemlerindeki aralık kopyalarını tazeler.
 * Açılışta, kayıt değişince ve saatte bir çalışır; tekrar tekrar çalıştırılabilir. Döner: değişen kayıt sayısı.
 */
export function esitle(gun = bugunMetni()) {
  let degisen = 0;
  for (const p of db.tablo("personel")) {
    const d = durumHesapla(p.kod, gun);
    if (d && p.durum !== d) { p.durum = d; degisen += 1; }
  }
  for (const p of db.tablo("puantaj")) {
    if (p.durum === "kapali" || (p.kural || 1) < 2) continue;
    for (const s of p.satirlar) {
      const ar = araliklar(s.personelKod);
      if (JSON.stringify(ar) === JSON.stringify(s.calisma ?? null)) continue;
      if (ar) s.calisma = ar; else delete s.calisma;
      degisen += 1;
    }
  }
  if (degisen) db.yaz();
  return degisen;
}

/** Süre uyarısı: bitişi yaklaşan çalışma dönemi. Geçmiş, izin ve devamı girilmiş dönemler uyarı vermez. */
export function uyarilsinMi(r, kalan) {
  if (turu(r) !== "Çalışma" || kalan < 0) return false;
  return !kisininKayitlari(r.personelKod).some((x) => x._id !== r._id && turu(x) === "Çalışma" && x.baslangic > r.baslangic);
}
