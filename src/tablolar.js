/**
 * Excel görevi gören tabloların sütun tanımları.
 * Arayüzdeki düzenlenebilir tablo, .xlsx dışa/içe aktarım ve süre uyarıları
 * hepsi bu tanımdan üretilir. Yeni sütun eklemek için buraya bir satır ekleyin.
 *
 *   tur    : metin | tarih | sayi | para | secim | baglanti | salt
 *   hesap  : salt sütunun değeri kaydedilmez, her okumada iliskiler.js hesaplar
 *   detay  : tablo satırlarının ayrıntı sayfası var (#d/tablo/id)
 *   uyari  : gün sayısı — bu tarihe bu kadar gün kaldığında uyarı üretilir
 *   gen    : arayüzdeki sütun genişliği (piksel)
 */

const PARA_BIRIMLERI = ["EUR", "TRY", "RSD"];

/** Kira hangi süre için giriliyor. Günlük kira = kira × F ÷ 365 (F: aylık 12, haftalık 52, günlük 365). */
export const KIRA_PERIYOTLARI = ["Aylık", "Haftalık", "Günlük"];

/** Kasa kategorileri. Maaş, Avans, Yemek ve Kira otomatik satırlarda da kullanılır. */
export const KASA_KATEGORI = [
  "Hakediş / Fatura", "Avans İadesi", "Diğer Gelir",
  "Maaş", "Avans", "Yemek", "Kira",
  "Yakıt", "Ulaşım", "Malzeme", "Fatura (Elektrik, Su, İnternet)", "Vergi / SGK", "Diğer Gider",
];

export const TABLOLAR = {
  personel: {
    ad: "Personel",
    tekil: "personel",
    ikon: "◉",
    aciklama: "Her satır, diskte 15 klasörlü bir personel dosyası açar. Maaş değişiklikleri sadece bundan sonra açılan puantaj dönemlerine yansır.",
    klasorTuru: "personel",
    detay: true,
    kolon: [
      { k: "kod", b: "Personel Kodu", tur: "salt", gen: 130, ipucu: "KDR-YIL-SIRA — otomatik verilir" },
      { k: "ad", b: "Ad Soyad", tur: "metin", gen: 180, zorunlu: true },
      { k: "gorev", b: "Görev", tur: "metin", gen: 150 },
      { k: "departman", b: "Departman", tur: "secim", gen: 130, secenek: ["Saha", "Atölye", "Ofis", "Yönetim", "Muhasebe", "Depo"] },
      { k: "ekip", b: "Ekip", tur: "baglanti", gen: 170, kaynak: "ekip" },
      { k: "ev", b: "Ev", tur: "baglanti", gen: 170, kaynak: "ev" },
      { k: "odemeTuru", b: "Ödeme Türü", tur: "secim", gen: 115, secenek: ["Aylık", "Saatlik"] },
      { k: "ucret", b: "Ücret (aylık / saatlik)", tur: "para", gen: 160 },
      { k: "paraBirimi", b: "Para Birimi", tur: "secim", gen: 105, secenek: PARA_BIRIMLERI, varsayilan: "EUR" },
      { k: "mesaiUcreti", b: "Mesai Ücreti (saatlik)", tur: "para", gen: 160, ipucu: "Boşsa puantaj dönemindeki para birimi ücreti kullanılır" },
      { k: "telefon", b: "Telefon", tur: "metin", gen: 130 },
      { k: "iseGiris", b: "İşe Giriş", tur: "tarih", gen: 115 },
      { k: "sigortaGiris", b: "Sigorta Giriş", tur: "tarih", gen: 125 },
      { k: "calismaIzniBitis", b: "Çalışma İzni Bitiş", tur: "tarih", gen: 145, uyari: 60 },
      { k: "oturmaIzniBitis", b: "Oturma İzni Bitiş", tur: "tarih", gen: 145, uyari: 60 },
      { k: "pasaportBitis", b: "Pasaport Bitiş", tur: "tarih", gen: 130, uyari: 90 },
      { k: "iban", b: "IBAN", tur: "metin", gen: 190 },
      { k: "durum", b: "Durum", tur: "secim", gen: 110, secenek: ["Aktif", "İzinli", "Ayrıldı"], varsayilan: "Aktif",
        ipucu: "Çalışma dönemi girilen kişide bugüne göre otomatik hesaplanır" },
      // Notlar ayrı paneldedir (src/notlar.js); eski "notlar" alanı bir kez oraya taşınır.
    ],
  },

  kontrat: {
    ad: "Çalışma Dönemleri",
    tekil: "çalışma dönemi",
    ikon: "⇥",
    aciklama: "Kişinin hangi tarihler arasında, hangi projede çalıştığı (kontrat). Bitiş tarihi işten çıkış tarihidir ve önceden girilebilir; " +
      "o günden sonra kişi puantaja ve öngörüye girmez, durumu kendiliğinden Ayrıldı olur. İzin kaydı sadece durumu İzinli yapar.",
    kolon: [
      { k: "personelKod", b: "Personel", tur: "baglanti", gen: 200, kaynak: "personel", zorunlu: true },
      { k: "personelAd", b: "Ad Soyad", tur: "salt", gen: 160, hesap: true },
      { k: "tur", b: "Tür", tur: "secim", gen: 100, secenek: ["Çalışma", "İzin"], varsayilan: "Çalışma" },
      { k: "proje", b: "Proje", tur: "baglanti", gen: 190, kaynak: "proje" },
      { k: "baslangic", b: "Başlangıç", tur: "tarih", gen: 120, zorunlu: true },
      { k: "bitis", b: "Bitiş (işten çıkış)", tur: "tarih", gen: 145, uyari: 30, ipucu: "Boş bırakılırsa süresiz" },
      { k: "durumEtiketi", b: "Durum", tur: "salt", gen: 110, hesap: true, pul: true },
      { k: "notlar", b: "Notlar", tur: "metin", gen: 220 },
    ],
  },

  zimmet: {
    ad: "Zimmet",
    tekil: "zimmet kaydı",
    ikon: "▣",
    aciklama: "Kimde ne var. Zimmet bir ekibe ya da bir kişiye yazılır; ekip zimmeti ekibin projesinde görünür.",
    kolon: [
      { k: "sahipTuru", b: "Sahip Türü", tur: "secim", gen: 110, secenek: ["Kişi", "Ekip"], varsayilan: "Kişi" },
      { k: "personelKod", b: "Personel", tur: "baglanti", gen: 170, kaynak: "personel" },
      { k: "ekipKod", b: "Ekip", tur: "baglanti", gen: 160, kaynak: "ekip" },
      { k: "sahipAd", b: "Zimmet Sahibi", tur: "salt", gen: 160, hesap: true },
      { k: "demirbas", b: "Demirbaş", tur: "metin", gen: 200, zorunlu: true },
      { k: "kategori", b: "Kategori", tur: "secim", gen: 130, secenek: ["El Aleti", "Ölçü Cihazı", "Bilgisayar", "Telefon", "Araç", "KKD", "Diğer"] },
      { k: "seriNo", b: "Seri No", tur: "metin", gen: 150 },
      { k: "adet", b: "Adet", tur: "sayi", gen: 70, varsayilan: 1 },
      { k: "teslimTarihi", b: "Teslim Tarihi", tur: "tarih", gen: 125 },
      { k: "iadeTarihi", b: "İade Tarihi", tur: "tarih", gen: 125 },
      { k: "durum", b: "Durum", tur: "secim", gen: 120, secenek: ["Zimmetli", "İade Edildi", "Hasarlı", "Kayıp"], varsayilan: "Zimmetli" },
      { k: "notlar", b: "Notlar", tur: "metin", gen: 200 },
    ],
  },

  ekip: {
    ad: "Ekipler",
    tekil: "ekip",
    ikon: "◎",
    aciklama: "Personel ekiplere, ekipler projelere atanır. Yemek tutarı kişi başı günlüktür; ekip toplamları otomatik hesaplanır.",
    detay: true,
    kolon: [
      { k: "kod", b: "Ekip No", tur: "salt", gen: 90, ipucu: "EKP-01 — otomatik verilir" },
      { k: "ad", b: "Ekip Adı", tur: "metin", gen: 170, zorunlu: true },
      { k: "ekipBasi", b: "Ekip Başı", tur: "baglanti", gen: 180, kaynak: "personel" },
      { k: "proje", b: "Proje", tur: "baglanti", gen: 190, kaynak: "proje" },
      { k: "kisiSayisi", b: "Kişi", tur: "salt", gen: 60, hesap: true },
      { k: "yemekGunluk", b: "Yemek (kişi/gün)", tur: "para", gen: 135 },
      { k: "yemekParaBirimi", b: "Yemek Para Birimi", tur: "secim", gen: 130, secenek: PARA_BIRIMLERI, varsayilan: "EUR" },
      { k: "yemekEkipGunluk", b: "Ekip Yemeği / Gün", tur: "salt", gen: 135, hesap: true },
      { k: "yemekEkipDonem", b: "Ekip Yemeği / 15 Gün", tur: "salt", gen: 150, hesap: true },
      { k: "durum", b: "Durum", tur: "secim", gen: 110, secenek: ["Aktif", "Pasif"], varsayilan: "Aktif" },
      { k: "notlar", b: "Notlar", tur: "metin", gen: 200 },
    ],
  },

  arac: {
    ad: "Araçlar",
    tekil: "araç",
    ikon: "▤",
    aciklama: "Her satır, 05 - Araçlar altında plakalı bir klasör açar.",
    klasorTuru: "arac",
    kolon: [
      { k: "plaka", b: "Plaka", tur: "metin", gen: 120, zorunlu: true },
      { k: "marka", b: "Marka", tur: "metin", gen: 120 },
      { k: "model", b: "Model", tur: "metin", gen: 120 },
      { k: "yil", b: "Yıl", tur: "sayi", gen: 70 },
      { k: "tur", b: "Tür", tur: "secim", gen: 120, secenek: ["Binek", "Panelvan", "Kamyonet", "Kamyon", "İş Makinesi"] },
      { k: "muayeneBitis", b: "Muayene Bitiş", tur: "tarih", gen: 130, uyari: 45 },
      { k: "kaskoBitis", b: "Kasko Bitiş", tur: "tarih", gen: 125, uyari: 30 },
      { k: "trafikBitis", b: "Trafik Sig. Bitiş", tur: "tarih", gen: 140, uyari: 30 },
      { k: "sonBakimKm", b: "Son Bakım (km)", tur: "sayi", gen: 130 },
      { k: "guncelKm", b: "Güncel km", tur: "sayi", gen: 110 },
      { k: "surucu", b: "Sürücü", tur: "metin", gen: 150 },
      { k: "durum", b: "Durum", tur: "secim", gen: 110, secenek: ["Aktif", "Serviste", "Satıldı"], varsayilan: "Aktif" },
    ],
  },

  proje: {
    ad: "Projeler",
    tekil: "proje",
    ikon: "◈",
    aciklama: "Her satır, 03 - Projeler altında 8 bölümlü bir proje klasörü açar. Ayrıntı sayfasında ekipler, kişiler, zimmetler ve evler görünür.",
    klasorTuru: "proje",
    detay: true,
    kolon: [
      { k: "kod", b: "Proje Kodu", tur: "salt", gen: 130 },
      { k: "ad", b: "Proje Adı", tur: "metin", gen: 200, zorunlu: true },
      { k: "musteri", b: "Müşteri", tur: "baglanti", gen: 170, kaynak: "musteri" },
      { k: "yer", b: "Yer", tur: "metin", gen: 140 },
      { k: "baslangic", b: "Başlangıç", tur: "tarih", gen: 115 },
      { k: "bitis", b: "Bitiş", tur: "tarih", gen: 115, uyari: 30 },
      { k: "bedel", b: "Sözleşme Bedeli", tur: "para", gen: 150 },
      { k: "paraBirimi", b: "Para Birimi", tur: "secim", gen: 110, secenek: ["EUR", "RSD", "TRY", "USD"], varsayilan: "EUR" },
      { k: "sorumlu", b: "Saha Sorumlusu", tur: "metin", gen: 150 },
      { k: "ekipSayisi", b: "Ekip", tur: "salt", gen: 60, hesap: true },
      { k: "kisiSayisi", b: "Kişi", tur: "salt", gen: 60, hesap: true },
      { k: "durum", b: "Durum", tur: "secim", gen: 120, secenek: ["Teklif", "Devam Ediyor", "Tamamlandı", "Arşiv"], varsayilan: "Devam Ediyor" },
    ],
  },

  ev: {
    ad: "Evler",
    tekil: "ev",
    ikon: "⌂",
    aciklama: "Yurt dışı konaklama. Her ev 09 - Konaklama altında bir klasör açar. Kira, evde kalan kişi sayısına bölünüp kişinin projesine yazılır; gelmediği gün için kişinin günlük kira payı maaşından kesilir.",
    klasorTuru: "ev",
    detay: true,
    kolon: [
      { k: "kod", b: "Ev No", tur: "salt", gen: 80, ipucu: "EV-01 — otomatik verilir" },
      { k: "ad", b: "Ev Adı", tur: "metin", gen: 160, zorunlu: true },
      { k: "proje", b: "Proje", tur: "baglanti", gen: 190, kaynak: "proje" },
      { k: "ulke", b: "Ülke", tur: "secim", gen: 110, secenek: ["Sırbistan", "Türkiye", "Diğer"], varsayilan: "Sırbistan" },
      { k: "sehir", b: "Şehir", tur: "metin", gen: 120 },
      { k: "adres", b: "Adres", tur: "metin", gen: 220 },
      { k: "yatak", b: "Yatak", tur: "sayi", gen: 70 },
      { k: "doluluk", b: "Doluluk", tur: "salt", gen: 80, hesap: true },
      { k: "kira", b: "Kira", tur: "para", gen: 110 },
      { k: "kiraPeriyodu", b: "Kira Periyodu", tur: "secim", gen: 115, secenek: KIRA_PERIYOTLARI, varsayilan: "Aylık" },
      { k: "paraBirimi", b: "Para Birimi", tur: "secim", gen: 105, secenek: PARA_BIRIMLERI, varsayilan: "EUR" },
      { k: "kisiBasiKira", b: "Kişi Başı Kira (aylık)", tur: "salt", gen: 150, hesap: true },
      { k: "kisiBasiGunluk", b: "Kişi Başı Günlük", tur: "salt", gen: 130, hesap: true },
      { k: "kiraBitis", b: "Kira Bitiş", tur: "tarih", gen: 120, uyari: 30 },
      { k: "evSahibi", b: "Ev Sahibi", tur: "metin", gen: 150 },
      { k: "evSahibiTel", b: "Ev Sahibi Tel.", tur: "metin", gen: 130 },
      { k: "durum", b: "Durum", tur: "secim", gen: 115, secenek: ["Aktif", "Boşaltıldı"], varsayilan: "Aktif" },
      { k: "notlar", b: "Notlar", tur: "metin", gen: 200 },
    ],
  },

  musteri: {
    ad: "Müşteriler",
    tekil: "müşteri",
    ikon: "◇",
    aciklama: "Her satır, 07 - Müşteriler altında 4 bölümlü bir müşteri klasörü açar.",
    klasorTuru: "musteri",
    kolon: [
      { k: "kod", b: "Müşteri Kodu", tur: "salt", gen: 130 },
      { k: "ad", b: "Ünvan", tur: "metin", gen: 210, zorunlu: true },
      { k: "yetkili", b: "Yetkili", tur: "metin", gen: 150 },
      { k: "telefon", b: "Telefon", tur: "metin", gen: 130 },
      { k: "eposta", b: "E-posta", tur: "metin", gen: 180 },
      { k: "ulke", b: "Ülke", tur: "secim", gen: 110, secenek: ["Sırbistan", "Türkiye", "Diğer"], varsayilan: "Sırbistan" },
      { k: "vergiNo", b: "Vergi / PIB No", tur: "metin", gen: 130 },
      { k: "adres", b: "Adres", tur: "metin", gen: 220 },
      { k: "durum", b: "Durum", tur: "secim", gen: 110, secenek: ["Aktif", "Pasif"], varsayilan: "Aktif" },
    ],
  },

  avans: {
    ad: "Avanslar",
    tekil: "avans",
    ikon: "↧",
    aciklama: "Verilen avanslar. Tarihine göre ilgili puantaj döneminde görünür ve ay sonu maaşından düşülür.",
    kolon: [
      { k: "tarih", b: "Tarih", tur: "tarih", gen: 125, zorunlu: true },
      { k: "personelKod", b: "Personel", tur: "baglanti", gen: 200, kaynak: "personel", zorunlu: true },
      { k: "personelAd", b: "Ad Soyad", tur: "salt", gen: 160, hesap: true },
      { k: "tutar", b: "Tutar", tur: "para", gen: 120, zorunlu: true },
      { k: "paraBirimi", b: "Para Birimi", tur: "secim", gen: 105, secenek: PARA_BIRIMLERI, varsayilan: "EUR" },
      { k: "donem", b: "Puantaj Dönemi", tur: "salt", gen: 200, hesap: true },
      { k: "aciklama", b: "Açıklama", tur: "metin", gen: 240 },
    ],
  },

  kasa: {
    ad: "Kasa",
    tekil: "kasa hareketi",
    ikon: "₺",
    aciklama: "Gelir ve giderler. Avans, maaş, yemek ve kira satırlarını sistem kendisi yazar; elle düzeltilen satırı bir daha ezmez.",
    kolon: [
      { k: "tarih", b: "Tarih", tur: "tarih", gen: 125, zorunlu: true },
      { k: "tur", b: "Tür", tur: "secim", gen: 90, secenek: ["Gelir", "Gider"], varsayilan: "Gider", zorunlu: true },
      { k: "kategori", b: "Kategori", tur: "secim", gen: 165, secenek: KASA_KATEGORI },
      { k: "tutar", b: "Tutar", tur: "para", gen: 115, zorunlu: true },
      { k: "paraBirimi", b: "Para Birimi", tur: "secim", gen: 95, secenek: PARA_BIRIMLERI, varsayilan: "EUR" },
      { k: "durumEtiketi", b: "Durum", tur: "salt", gen: 130, hesap: true, pul: true },
      { k: "aciklama", b: "Açıklama", tur: "metin", gen: 270 },
      { k: "proje", b: "Proje", tur: "baglanti", gen: 180, kaynak: "proje" },
      { k: "personelKod", b: "Personel", tur: "baglanti", gen: 170, kaynak: "personel" },
      { k: "sistemTutar", b: "Sistemin Hesabı", tur: "salt", gen: 130, hesap: true },
      { k: "tekrar", b: "Her Ay Tekrarlar", tur: "secim", gen: 125, secenek: ["Hayır", "Evet"], varsayilan: "Hayır" },
      { k: "kaynak", b: "Kaynak", tur: "salt", gen: 85 },
    ],
  },

  belge: {
    ad: "Belge Defteri",
    tekil: "belge kaydı",
    ikon: "▦",
    aciklama: "Sisteme giren her dosyanın kaydı. Düzenlenemez — sadece okunur ve dışa aktarılır. Silinen belgeler Durum sütununda yazar.",
    saltOkunur: true,
    kolon: [
      { k: "tarih", b: "Tarih", tur: "salt", gen: 150 },
      { k: "dosyaAdi", b: "Dosya Adı", tur: "salt", gen: 240 },
      { k: "hedefYol", b: "Yerleştirildiği Klasör", tur: "salt", gen: 340 },
      { k: "belgeTuru", b: "Belge Türü", tur: "salt", gen: 150 },
      { k: "ilgili", b: "İlgili Kişi / Kayıt", tur: "salt", gen: 170 },
      { k: "yontem", b: "Yöntem", tur: "salt", gen: 110 },
      { k: "guven", b: "Güven", tur: "salt", gen: 80 },
      { k: "boyut", b: "Boyut", tur: "salt", gen: 90 },
      { k: "durum", b: "Durum", tur: "salt", gen: 230 },
    ],
  },
};

/** Kod üretimi: KDR-2026-0001, PRJ-2026-0007, MST-2026-0003; ekip ve ev için kısa: EKP-01, EV-01 */
export const KOD_ONEK = { personel: "KDR", proje: "PRJ", musteri: "MST" };
const KISA_ONEK = { ekip: "EKP", ev: "EV" };

/** Kodu otomatik verilen tablolar. */
export const KODLU = ["personel", "proje", "musteri", "ekip", "ev"];

export function sonrakiKod(tur, mevcut) {
  if (KISA_ONEK[tur]) {
    const desen = new RegExp(`^${KISA_ONEK[tur]}-(\\d+)$`);
    const enBuyuk = Math.max(0, ...mevcut.map((r) => Number(desen.exec(r.kod || "")?.[1] || 0)));
    return `${KISA_ONEK[tur]}-${String(enBuyuk + 1).padStart(2, "0")}`;
  }
  const onek = KOD_ONEK[tur];
  if (!onek) return null;
  const yil = new Date().getFullYear();
  const desen = new RegExp(`^${onek}-${yil}-(\\d{4})$`);
  let enBuyuk = 0;
  for (const r of mevcut) {
    const m = desen.exec(r.kod || "");
    if (m) enBuyuk = Math.max(enBuyuk, parseInt(m[1], 10));
  }
  return `${onek}-${yil}-${String(enBuyuk + 1).padStart(4, "0")}`;
}
