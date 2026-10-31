/**
 * Test verisi: açık olan KADRO'ya (varsayılan http://127.0.0.1:4360) API üzerinden kayıt ekler.
 * Var olan kayıtlara dokunmaz, üstüne ekler. Kayıtlar elle girilmiş gibi işlenir
 * (kodlar, klasörler, maaş geçmişi, kasa satırları sistemin kendisi tarafından üretilir).
 *
 *   node test-verisi.mjs            → 4360 portundaki KADRO'ya ekler
 *   node test-verisi.mjs 4370       → başka porttaki (ör. test klasörlü) KADRO'ya ekler
 *
 * Tarihler 9 Ekim 2026'ya göre seçildi: geçmiş, kritik (≤15 gün), yaklaşan (≤60 gün) ve uzak tarihler karışık.
 */
const PORT = process.argv[2] || 4360;
const API = `http://127.0.0.1:${PORT}/api`;
const BUGUN = "2026-10-09";

async function j(yol, method = "GET", govde) {
  const r = await fetch(API + yol, { method, headers: { "Content-Type": "application/json" }, body: govde ? JSON.stringify(govde) : undefined });
  const v = await r.json();
  if (!r.ok) throw new Error(`${method} ${yol}: ${v.hata}`);
  return v;
}
const ekle = async (tablo, satir) => (await j(`/tablo/${tablo}`, "POST", satir)).satir;
const guncelle = async (tablo, id, alanlar) => (await j(`/tablo/${tablo}/${id}`, "PUT", alanlar)).satir;

const mevcut = await j("/durum");
console.log(`KADRO ${mevcut.surum} · ${mevcut.sayilar.personel} personel, ${mevcut.sayilar.proje} proje var`);
const eskiPersonel = (await j("/tablo/personel")).satirlar;
if (eskiPersonel.length + 13 > 15) throw new Error(`Zaten ${eskiPersonel.length} personel var; 13 kişi daha eklenirse 15'i geçer.`);
if ((await j("/tablo/personel")).satirlar.some((p) => p.ad === "Mehmet Kaya")) throw new Error("Test verisi zaten eklenmiş görünüyor.");
const projeKod = (await j("/tablo/proje")).satirlar[0]?.kod;     // sizin eklediğiniz Sirbistan-1
const ekipKod = (await j("/tablo/ekip")).satirlar[0]?.kod;       // Sirbistan1
const evKod = (await j("/tablo/ev")).satirlar[0]?.kod;           // Sirbistan-ev-1
const musteriKod = (await j("/tablo/musteri")).satirlar[0]?.kod; // Mr

/* ---------------- müşteriler ve projeler ---------------- */
console.log("— müşteriler, projeler");
const m2 = await ekle("musteri", { ad: "Hotel Vojvodina d.o.o.", yetkili: "Milan Petrović", telefon: "+381 21 555 0101", eposta: "milan@hotelvojvodina.rs", ulke: "Sırbistan", vergiNo: "108765432", adres: "Bulevar Oslobođenja 12, Novi Sad", durum: "Aktif" });
const m3 = await ekle("musteri", { ad: "Marmara Gıda A.Ş.", yetkili: "Ayla Karaca", telefon: "0216 555 44 33", eposta: "ayla.karaca@marmaragida.com.tr", ulke: "Türkiye", vergiNo: "6120456789", adres: "Tuzla OSB 3. Cad. No:8, İstanbul", durum: "Aktif" });

const P2 = await ekle("proje", { ad: "Novi Sad Otel Elektrik", musteri: m2.kod, yer: "Novi Sad", baslangic: "2026-06-01", bitis: "2027-06-30", bedel: "1200000", paraBirimi: "EUR", sorumlu: "Murat Aydın", durum: "Devam Ediyor" });
const P3 = await ekle("proje", { ad: "İstanbul Fabrika Otomasyon", musteri: m3.kod, yer: "Tuzla, İstanbul", baslangic: "2026-09-01", bitis: "2026-10-25", bedel: "18500000", paraBirimi: "TRY", sorumlu: "Kemal Yılmaz", durum: "Devam Ediyor" });
const P4 = await ekle("proje", { ad: "Belgrad AVM Bakım", musteri: musteriKod, yer: "Belgrad", baslangic: "2025-03-01", bitis: "2026-07-31", bedel: "250000", paraBirimi: "EUR", sorumlu: "Yigit", durum: "Tamamlandı" });
const P5 = await ekle("proje", { ad: "Niš Lojistik Depo (teklif)", musteri: m2.kod, yer: "Niš", baslangic: "2027-01-15", bitis: "2027-09-30", bedel: "480000", paraBirimi: "EUR", sorumlu: "Murat Aydın", durum: "Teklif" });

/* ---------------- ekipler ---------------- */
console.log("— ekipler");
const E2 = await ekle("ekip", { ad: "Novi Sad Elektrik", proje: P2.kod, yemekGunluk: "1200", yemekParaBirimi: "RSD", durum: "Aktif", notlar: "Yemek Sırp dinarı ile ödeniyor" });
const E3 = await ekle("ekip", { ad: "Novi Sad Mekanik", proje: P2.kod, yemekGunluk: "11", yemekParaBirimi: "EUR", durum: "Aktif" });
const E4 = await ekle("ekip", { ad: "İstanbul Montaj", proje: P3.kod, yemekGunluk: "450", yemekParaBirimi: "TRY", durum: "Aktif" });

/* ---------------- evler (tür adda ve notta) ---------------- */
console.log("— evler");
const EV2 = await ekle("ev", { ad: "Novi Sad Daire 3+1", proje: P2.kod, ulke: "Sırbistan", sehir: "Novi Sad", adres: "Futoška 45, kat 3", yatak: "5", kira: "900", paraBirimi: "EUR", kiraBitis: "2026-10-20", evSahibi: "Dragana Ilić", evSahibiTel: "+381 63 111 2233", durum: "Aktif", notlar: "Tür: daire 3+1. Kira sözleşmesi 11 gün sonra bitiyor" });
const EV3 = await ekle("ev", { ad: "Novi Sad Müstakil Ev", proje: P2.kod, ulke: "Sırbistan", sehir: "Novi Sad", adres: "Sremska 7, Petrovaradin", yatak: "2", kira: "95000", paraBirimi: "RSD", kiraBitis: "2027-09-01", evSahibi: "Zoran Jovanović", evSahibiTel: "+381 64 222 3344", durum: "Aktif", notlar: "Tür: müstakil ev, bahçeli. 2 yatak ama 3-4 kişi kalıyor: kapasite aşımı (test)" });
const EV4 = await ekle("ev", { ad: "Belgrad Apart 1+1", proje: projeKod, ulke: "Sırbistan", sehir: "Belgrad", adres: "Knez Mihailova 20, daire 4", yatak: "2", kira: "650", paraBirimi: "EUR", kiraBitis: "2026-09-30", evSahibi: "Ana Marković", evSahibiTel: "+381 65 333 4455", durum: "Aktif", notlar: "Tür: apart, kısa dönem kiralık. Şu an boş; kira sözleşmesi bitti" });
await ekle("ev", { ad: "Novi Sad Konteyner Kamp", proje: P2.kod, ulke: "Sırbistan", sehir: "Novi Sad", adres: "Şantiye sahası", yatak: "8", kira: "300", paraBirimi: "EUR", kiraBitis: "2026-05-31", evSahibi: "—", durum: "Boşaltıldı", notlar: "Tür: şantiye konteyneri. Boşaltıldı, kira artık yazılmıyor" });

/* ---------------- personel: 13 kişi ---------------- */
console.log("— personel");
const izin = (calisma, oturma, pasaport) => ({ calismaIzniBitis: calisma, oturmaIzniBitis: oturma, pasaportBitis: pasaport });
const kisiler = [
  // uzun dönem, aylık
  { ad: "Murat Aydın", gorev: "Ekip Başı", departman: "Saha", ekip: E2.kod, ev: EV2.kod, odemeTuru: "Aylık", ucret: "2400", paraBirimi: "EUR", telefon: "+381 60 100 0001", iseGiris: "2017-01-10", ...izin("2028-01-10", "2028-01-10", "2032-05-20"), iban: "TR33 0006 1005 1978 6457 8413 26", notlar: "Uzun dönem. Novi Sad ekip başı" },
  { ad: "Mehmet Kaya", gorev: "Elektrik Ustası", departman: "Saha", ekip: E2.kod, ev: EV2.kod, odemeTuru: "Aylık", ucret: "1800", paraBirimi: "EUR", telefon: "+381 60 100 0002", iseGiris: "2019-04-15", ...izin("2027-04-15", "2027-04-15", "2031-02-10"), notlar: "Uzun dönem" },
  { ad: "Oğuz Koç", gorev: "Mekanik Usta", departman: "Saha", ekip: E3.kod, ev: EV3.kod, odemeTuru: "Aylık", ucret: "1700", paraBirimi: "EUR", telefon: "+381 60 100 0003", iseGiris: "2022-09-12", ...izin("2027-09-12", "2027-09-12", "2030-08-01"), notlar: "Eylül 2. yarıda birkaç gün Elektrik ekibinde çalıştı" },
  { ad: "Emre Şahin", gorev: "Tesisatçı", departman: "Saha", ekip: E3.kod, ev: EV3.kod, odemeTuru: "Aylık", ucret: "160000", paraBirimi: "RSD", telefon: "+381 60 100 0004", iseGiris: "2023-02-20", ...izin("2027-02-20", "2027-02-20", "2029-11-15"), notlar: "Maaşı dinar" },
  { ad: "Kemal Yılmaz", gorev: "Otomasyon Teknikeri", departman: "Saha", ekip: E4.kod, odemeTuru: "Aylık", ucret: "65000", paraBirimi: "TRY", telefon: "0532 100 00 05", iseGiris: "2020-03-02", iban: "TR12 0001 2009 4520 0058 0012 34", notlar: "Türkiye'de çalışıyor; izin belgesi gerekmiyor" },
  // uzun dönem, saatlik
  { ad: "Hasan Çelik", gorev: "Kaynakçı", departman: "Saha", ekip: E3.kod, ev: EV3.kod, odemeTuru: "Saatlik", ucret: "11", paraBirimi: "EUR", telefon: "+381 60 100 0006", iseGiris: "2021-06-01", ...izin("2026-11-30", "2026-11-30", "2026-09-30"), notlar: "Pasaportu süresi geçti, yenileniyor. Çalışma izni 52 gün sonra bitiyor" },
  { ad: "Serkan Arslan", gorev: "Elektrikçi", departman: "Saha", ekip: E2.kod, ev: EV2.kod, odemeTuru: "Saatlik", ucret: "10", paraBirimi: "EUR", telefon: "+381 60 100 0007", iseGiris: "2024-05-06", ...izin("2026-10-12", "2026-10-12", "2033-03-03"), notlar: "Çalışma izni 3 gün sonra bitiyor (kritik)" },
  { ad: "Cem Polat", gorev: "Elektrikçi", departman: "Saha", ekip: ekipKod, ev: evKod, odemeTuru: "Saatlik", ucret: "12", paraBirimi: "EUR", telefon: "+381 60 100 0008", iseGiris: "2025-02-03", ...izin("2027-02-03", "2027-02-03", "2034-07-07") },
  { ad: "Volkan Demir", gorev: "Montajcı", departman: "Saha", ekip: E4.kod, odemeTuru: "Saatlik", ucret: "380", paraBirimi: "TRY", telefon: "0533 100 00 09", iseGiris: "2025-11-17", durum: "İzinli", notlar: "Yıllık izinde (Eylül 2. yarı)" },
  // kısa dönem
  { ad: "Ali Yıldız", gorev: "Elektrikçi", departman: "Saha", ekip: E2.kod, ev: EV2.kod, odemeTuru: "Saatlik", ucret: "9.5", paraBirimi: "EUR", telefon: "+381 60 100 0010", iseGiris: "2026-09-14", ...izin("2026-12-14", "2026-12-14", "2030-01-20"), notlar: "Kısa dönem: 3 aylık sözleşme (14.09–14.12)" },
  { ad: "Burak Öztürk", gorev: "Yardımcı", departman: "Saha", ekip: E3.kod, ev: EV3.kod, odemeTuru: "Saatlik", ucret: "950", paraBirimi: "RSD", telefon: "+381 60 100 0011", iseGiris: "2026-08-25", ...izin("2026-11-25", "2026-11-25", "2029-04-04"), notlar: "Kısa dönem. 5 Ekim'de ayrıldı" },
  { ad: "Selin Aksoy", gorev: "PLC Programcı", departman: "Saha", ekip: E4.kod, odemeTuru: "Saatlik", ucret: "520", paraBirimi: "TRY", telefon: "0534 100 00 12", iseGiris: "2026-09-01", notlar: "Kısa dönem: sadece İstanbul projesi süresince" },
  { ad: "Tolga Er", gorev: "Yardımcı", departman: "Saha", ekip: ekipKod, ev: evKod, odemeTuru: "Aylık", ucret: "1100", paraBirimi: "EUR", telefon: "+381 60 100 0013", iseGiris: "2026-11-02", ...izin("2027-11-02", "2027-11-02", "2036-01-01"), notlar: "Henüz başlamadı: 2 Kasım'da işe giriyor (öngörüde Kasım'dan itibaren görünür)" },
];
const K = {};
for (const k of kisiler) K[k.ad] = await ekle("personel", { durum: "Aktif", ...k });
await guncelle("ekip", E2._id, { ekipBasi: K["Murat Aydın"].kod });
await guncelle("ekip", E3._id, { ekipBasi: K["Oğuz Koç"].kod });
await guncelle("ekip", E4._id, { ekipBasi: K["Kemal Yılmaz"].kod });
// Maaş geçmişi için bir zam: Mehmet 1700 → 1800 (yeni dönemlere yansır).
await guncelle("personel", K["Mehmet Kaya"]._id, { ucret: "1700" });
await guncelle("personel", K["Mehmet Kaya"]._id, { ucret: "1800" });

/* ---------------- araçlar ve zimmet ---------------- */
console.log("— araçlar, zimmet");
await ekle("arac", { plaka: "NS 123-AB", marka: "Renault", model: "Master", yil: "2021", tur: "Panelvan", muayeneBitis: "2026-10-30", kaskoBitis: "2027-03-01", trafikBitis: "2026-10-15", sonBakimKm: "84000", guncelKm: "91200", surucu: "Murat Aydın", durum: "Aktif" });
await ekle("arac", { plaka: "34 KDR 034", marka: "Fiat", model: "Doblo", yil: "2023", tur: "Kamyonet", muayeneBitis: "2027-06-01", kaskoBitis: "2026-09-20", trafikBitis: "2027-06-01", sonBakimKm: "30000", guncelKm: "38500", surucu: "Kemal Yılmaz", durum: "Aktif" });
const z = (x) => ekle("zimmet", { adet: "1", durum: "Zimmetli", ...x });
await z({ sahipTuru: "Ekip", ekipKod: E2.kod, demirbas: "Hilti TE 30 kırıcı-delici", kategori: "El Aleti", seriNo: "HT-30-55821", teslimTarihi: "2026-06-03" });
await z({ sahipTuru: "Ekip", ekipKod: E2.kod, demirbas: "Fluke 1664 FC tesisat test cihazı", kategori: "Ölçü Cihazı", seriNo: "FL-1664-0098", teslimTarihi: "2026-06-03" });
await z({ sahipTuru: "Ekip", ekipKod: E3.kod, demirbas: "Kaynak makinesi Lincoln 200A", kategori: "El Aleti", seriNo: "LN-200-7781", teslimTarihi: "2026-06-10" });
await z({ sahipTuru: "Ekip", ekipKod: E4.kod, demirbas: "Dizüstü bilgisayar (PLC yazılımlı)", kategori: "Bilgisayar", seriNo: "DL-5540-1120", teslimTarihi: "2026-09-01" });
await z({ sahipTuru: "Ekip", ekipKod: ekipKod, demirbas: "Seyyar iskele", kategori: "Diğer", adet: "2", teslimTarihi: "2026-08-15" });
await z({ sahipTuru: "Kişi", personelKod: K["Murat Aydın"].kod, demirbas: "Şirket telefonu Samsung A54", kategori: "Telefon", seriNo: "IMEI 3567…0012", teslimTarihi: "2026-01-05" });
await z({ sahipTuru: "Kişi", personelKod: K["Kemal Yılmaz"].kod, demirbas: "Dizüstü bilgisayar Lenovo T14", kategori: "Bilgisayar", seriNo: "LN-T14-8890", teslimTarihi: "2024-02-01" });
await z({ sahipTuru: "Kişi", personelKod: K["Hasan Çelik"].kod, demirbas: "Kaynak maskesi", kategori: "KKD", teslimTarihi: "2026-06-10", durum: "Hasarlı", notlar: "Camı çatlak, değişecek" });
await z({ sahipTuru: "Kişi", personelKod: K["Burak Öztürk"].kod, demirbas: "Baret + emniyet kemeri", kategori: "KKD", teslimTarihi: "2026-08-25", iadeTarihi: "2026-10-05", durum: "İade Edildi" });

/* ---------------- avanslar (kasaya kendiliğinden düşer) ---------------- */
console.log("— avanslar");
const avans = (ad, tarih, tutar, paraBirimi, aciklama = "") => ekle("avans", { personelKod: K[ad]?.kod || ad, tarih, tutar, paraBirimi, aciklama });
await avans("Emre Şahin", "2026-09-05", "20000", "RSD", "Ev eşyası");
await avans("Kemal Yılmaz", "2026-09-10", "10000", "TRY");
await avans(eskiPersonel.find((p) => p.odemeTuru === "Aylık")?.kod || eskiPersonel[0].kod, "2026-09-12", "5000", "TRY", "Bayram öncesi");
await avans("Ali Yıldız", "2026-09-20", "200", "EUR", "İlk ay");
await avans("Selin Aksoy", "2026-10-03", "5000", "TRY");
await avans("Hasan Çelik", "2026-10-06", "150", "EUR", "Pasaport harcı");

/* ---------------- puantaj ---------------- */
console.log("— puantaj");
const ekip = (ad) => K[ad]?.ekip;
const saat = {
  // ekip → Cumartesi kaç saat çalışır (mesai)
  [E2.kod]: 6, [E3.kod]: 5, [E4.kod]: 0, [ekipKod]: 4,
};
async function doldur(donem, { sonGun = "9999", istisna = () => null } = {}) {
  const p = await j(`/puantaj/${donem}`, "POST");
  // Henüz işe başlamamış kişiler dönemden çıkarılır.
  for (const s of p.kayit.satirlar) {
    const kisi = [...Object.values(K), ...eskiPersonel].find((x) => x.kod === s.personelKod);
    if (kisi?.iseGiris && kisi.iseGiris > p.gunler.at(-1).gun) await j(`/puantaj/${donem}/satir/${s.personelKod}`, "DELETE");
  }
  const guncel = await j(`/puantaj/${donem}`);
  const degisiklikler = [];
  for (const s of guncel.kayit.satirlar) {
    const kisi = [...Object.values(K), ...eskiPersonel].find((x) => x.kod === s.personelKod);
    for (const g of guncel.gunler) {
      if (g.gun > sonGun) continue;
      const tip = guncel.kayit.gunler[g.gun];
      let deger = tip === "normal" ? "8" : tip === "mesai" ? String(saat[s.ekip] || 0 || "") : "";
      if (deger === "0") deger = "";
      if (kisi?.iseGiris && g.gun < kisi.iseGiris) deger = "";
      const ozel = istisna(kisi?.ad || s.ad, g.gun, tip);
      if (ozel !== null) deger = ozel;
      if (deger) degisiklikler.push({ personelKod: s.personelKod, gun: g.gun, deger });
    }
  }
  await j(`/puantaj/${donem}/hucre`, "PUT", { degisiklikler });
  return guncel;
}

// Eylül 1. yarı: Hasan 2 gün rapor, Emre 1 gün izin, Burak 2 gün gelmedi, Mehmet bir gün 10 saat.
await doldur("2026-09-1", {
  istisna: (ad, gun) => ({
    "Hasan Çelik|2026-09-08": "R", "Hasan Çelik|2026-09-09": "R",
    "Emre Şahin|2026-09-11": "İ",
    "Burak Öztürk|2026-09-03": "–", "Burak Öztürk|2026-09-04": "–",
    "Mehmet Kaya|2026-09-10": "10",
  })[`${ad}|${gun}`] ?? null,
});
// Eylül 2. yarı: Volkan tüm dönem izinli, Ali bir gün 6 saat, Oğuz 21–25 Eylül Elektrik ekibinde.
await doldur("2026-09-2", {
  istisna: (ad, gun, tip) => {
    if (ad === "Volkan Demir") return tip === "normal" ? "İ" : "";
    return ({ "Ali Yıldız|2026-09-17": "6", "Serkan Arslan|2026-09-29": "–" })[`${ad}|${gun}`] ?? null;
  },
});
await j("/puantaj/2026-09-2/ekip-gun", "PUT", { personelKod: K["Oğuz Koç"].kod, gunler: ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"], ekip: E2.kod });
await j("/puantaj/2026-09-2/ayar", "PUT", { ayar: { mesaiCarpani: 1.5 } });
for (const d of ["2026-09-1", "2026-09-2"]) {
  const r = await j(`/puantaj/${d}/kapat`, "POST");
  console.log(`   ${d} kapandı · kasaya ${r.kasa.eklenen} satır · ${r.dosya || r.dosyaHatasi}`);
}

// Burak 5 Ekim'de ayrıldı; Ekim 1. yarı onsuz açılır ve 8 Ekim'e kadar doldurulur (bu dönem açık kalır).
await guncelle("personel", K["Burak Öztürk"]._id, { durum: "Ayrıldı" });
await guncelle("personel", K["Volkan Demir"]._id, { durum: "Aktif", notlar: "Eylül 2. yarı yıllık izindeydi" });
await doldur("2026-10-1", {
  sonGun: "2026-10-08",
  istisna: (ad, gun) => ({ "Selin Aksoy|2026-10-06": "R", "Cem Polat|2026-10-02": "10" })[`${ad}|${gun}`] ?? null,
});

/* ---------------- kasa: elle gelir / gider ---------------- */
console.log("— kasa");
const kasa = (x) => ekle("kasa", { tekrar: "Hayır", ...x });
await kasa({ tarih: "2026-09-15", tur: "Gelir", kategori: "Hakediş / Fatura", aciklama: "Hakediş #4 — Hotel Vojvodina", proje: P2.kod, tutar: "85000", paraBirimi: "EUR", tekrar: "Evet" });
await kasa({ tarih: "2026-09-30", tur: "Gelir", kategori: "Hakediş / Fatura", aciklama: "Hakediş #1 — Marmara Gıda", proje: P3.kod, tutar: "2750000", paraBirimi: "TRY" });
await kasa({ tarih: "2026-10-05", tur: "Gelir", kategori: "Hakediş / Fatura", aciklama: "Sirbistan-1 ara hakediş", proje: projeKod, tutar: "1500000", paraBirimi: "TRY" });
await kasa({ tarih: "2026-09-01", tur: "Gider", kategori: "Diğer Gider", aciklama: "Belgrad ofis kirası", tutar: "1200", paraBirimi: "EUR", tekrar: "Evet" });
await kasa({ tarih: "2026-09-10", tur: "Gider", kategori: "Fatura (Elektrik, Su, İnternet)", aciklama: "Ofis internet (SBB)", tutar: "3500", paraBirimi: "RSD", tekrar: "Evet" });
await kasa({ tarih: "2026-09-08", tur: "Gider", kategori: "Yakıt", aciklama: "Renault Master yakıt", proje: P2.kod, tutar: "180", paraBirimi: "EUR" });
await kasa({ tarih: "2026-09-18", tur: "Gider", kategori: "Malzeme", aciklama: "NYM kablo 3x2,5 — 2000 m", proje: P2.kod, tutar: "4200", paraBirimi: "EUR" });
await kasa({ tarih: "2026-09-26", tur: "Gider", kategori: "Vergi / SGK", aciklama: "Eylül SGK primleri", tutar: "85000", paraBirimi: "TRY", tekrar: "Evet" });
await kasa({ tarih: "2026-10-02", tur: "Gider", kategori: "Ulaşım", aciklama: "İstanbul–Belgrad uçak (2 kişi)", proje: projeKod, tutar: "380", paraBirimi: "EUR" });
await kasa({ tarih: "2026-11-10", tur: "Gider", kategori: "Malzeme", aciklama: "PLC panosu (planlı alım)", proje: P3.kod, tutar: "320000", paraBirimi: "TRY" });

const son = await j("/durum");
console.log("\nBitti:", JSON.stringify(son.sayilar));
console.log(`Uyarı listesi: ${(await j("/uyarilar")).length} kayıt (Panel'de)`);
