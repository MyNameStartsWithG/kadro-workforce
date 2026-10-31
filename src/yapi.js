/**
 * ACME MÜHENDİSLİK — Klasör yapısı tanımı.
 *
 * Bu dosya tüm uygulamanın TEK KAYNAĞIDIR. Klasör ağacı, diskte açılan
 * dizinler, yapay zekânın seçebileceği hedefler ve kural motorunun
 * anahtar kelimeleri hep buradan okunur.
 *
 * Yeni klasör eklemek için: ilgili yere bir satır ekleyin, uygulamayı
 * yeniden başlatıp "Yapıyı Kur" deyin. Başka hiçbir yeri değiştirmeyin.
 *
 *   c  : klasör kodu (klasör adının başına gelir)
 *   n  : klasör adı
 *   d  : açıklama — arayüzde ve yapay zekâ istemlerinde kullanılır
 *   ch : alt klasörler
 *   anahtar : dosya adında geçtiğinde bu klasörü işaret eden kelimeler
 *   dinamik : bu klasörün altı tablodan doldurulur (personel/proje/arac/musteri)
 *   hedef : false ise belge buraya yerleştirilemez (sadece kapsayıcı)
 */

/** Her personel için birebir açılan 15 klasör. */
export const PERSONEL_SABLON = [
  { c: "01", n: "Kimlik", d: "Kimlik fotokopisi, nüfus kayıt örneği, ikametgâh belgesi.", anahtar: ["kimlik", "nufus", "ikametgah", "tc kimlik", "licna karta", "id kart"] },
  { c: "02", n: "Pasaport", d: "Pasaport ana sayfası; geçerlilik bitiş tarihi takip edilir.", anahtar: ["pasaport", "passport", "pasos"] },
  { c: "03", n: "İş Sözleşmesi", d: "İmzalı sözleşme, ek protokoller ve zam yazıları.", anahtar: ["is sozlesmesi", "hizmet sozlesmesi", "ugovor o radu", "sozlesme", "protokol", "zam yazisi"] },
  { c: "04", n: "Çalışma İzni", d: "Çalışma izni başvurusu, onay belgesi ve uzatma yazışmaları.", anahtar: ["calisma izni", "radna dozvola", "work permit", "izin basvuru"] },
  { c: "05", n: "Oturma İzni", d: "Oturma izni belgeleri; süre bitiminden 60 gün önce hatırlatma.", anahtar: ["oturma izni", "boravak", "residence", "ikamet izni"] },
  { c: "06", n: "Maaş Bordroları", d: "Aylık bordrolar. Dosya adı YIL-AY ile başlar.", anahtar: ["bordro", "maas", "payroll", "obracun", "ucret pusulasi"] },
  { c: "07", n: "Banka Dekontları", d: "Maaş ödeme dekontları ve IBAN bildirim yazısı.", anahtar: ["dekont", "havale", "eft", "iban", "odeme dekontu", "izvod"] },
  { c: "08", n: "Puantajlar", d: "Aylık giriş-çıkış ve devam çizelgeleri.", anahtar: ["puantaj", "devam cizelgesi", "mesai cizelgesi", "timesheet"] },
  { c: "09", n: "İzinler", d: "Yıllık izin, ücretsiz izin, rapor ve mazeret formları.", anahtar: ["izin formu", "yillik izin", "ucretsiz izin", "mazeret", "rapor", "istirahat"] },
  { c: "10", n: "Disiplin", d: "Savunma istemleri, tutanaklar, ihtar yazıları.", anahtar: ["disiplin", "savunma", "tutanak", "ihtar", "uyari yazisi"] },
  { c: "11", n: "İSG", d: "Eğitim katılım belgeleri, taahhütname, işe giriş sağlık raporu.", anahtar: ["isg", "is guvenligi", "saglik raporu", "egitim katilim", "taahhutname", "kkd"] },
  { c: "12", n: "Zimmet", d: "Teslim edilen alet, araç, telefon ve KKD zimmet formları.", anahtar: ["zimmet", "demirbas", "teslim tutanagi"] },
  { c: "13", n: "Performans", d: "Değerlendirme formları, hedefler, terfi notları.", anahtar: ["performans", "degerlendirme", "terfi", "hedef"] },
  { c: "14", n: "Fotoğraflar", d: "Vesikalık ve personel kartı fotoğrafları.", anahtar: ["vesikalik", "fotograf", "foto", "profil"] },
  { c: "15", n: "İşten Ayrılış", d: "İbraname, çıkış bildirgesi, kıdem ve ihbar hesabı.", anahtar: ["ibraname", "isten ayrilis", "cikis bildirgesi", "kidem", "ihbar", "fesih"] },
];

/** Her proje klasörünün altında açılan standart bölümler. */
export const PROJE_SABLON = [
  { c: "01", n: "Sözleşme", d: "İşveren sözleşmesi, ekleri ve teminat mektupları.", anahtar: ["sozlesme", "ugovor", "teminat"] },
  { c: "02", n: "Teklif ve Keşif", d: "Verilen teklifler, keşif özetleri, metraj listeleri.", anahtar: ["teklif", "kesif", "metraj", "ponuda"] },
  { c: "03", n: "Çizimler", d: "Elektrik projeleri, pano şemaları, revizyonlar.", anahtar: ["cizim", "proje pafta", "sema", "dwg", "plan", "revizyon"] },
  { c: "04", n: "Hakediş", d: "Aylık hakediş dosyaları ve onaylı icmaller.", anahtar: ["hakedis", "icmal", "situacija"] },
  { c: "05", n: "Malzeme", d: "Malzeme listeleri, irsaliyeler, sevk belgeleri.", anahtar: ["malzeme", "irsaliye", "sevk", "otpremnica"] },
  { c: "06", n: "Saha Fotoğrafları", d: "İmalat öncesi/sonrası saha kayıtları.", anahtar: ["saha", "imalat foto", "montaj foto"] },
  { c: "07", n: "Yazışmalar", d: "İşveren ve taşeronlarla yazışmalar, tutanaklar.", anahtar: ["yazisma", "tutanak", "mail", "dopis"] },
  { c: "08", n: "Teslim ve Kabul", d: "Geçici/kesin kabul tutanakları, test raporları.", anahtar: ["kabul", "teslim", "test raporu", "devreye alma"] },
];

/** Her araç klasörünün altında açılan standart bölümler. */
export const ARAC_SABLON = [
  { c: "01", n: "Ruhsat", d: "Araç tescil belgesi ve tescil değişiklikleri.", anahtar: ["ruhsat", "tescil", "saobracajna"] },
  { c: "02", n: "Sigorta", d: "Kasko ve trafik sigortası poliçeleri.", anahtar: ["kasko", "trafik sigortasi", "police", "polisa"] },
  { c: "03", n: "Muayene", d: "Periyodik araç muayene raporları.", anahtar: ["muayene", "fenni", "tehnicki pregled"] },
  { c: "04", n: "Bakım ve Onarım", d: "Servis formları, bakım faturaları, lastik değişimi.", anahtar: ["bakim", "servis", "onarim", "lastik"] },
  { c: "05", n: "Yakıt", d: "Yakıt fişleri ve aylık tüketim raporları.", anahtar: ["yakit", "mazot", "benzin", "akaryakit"] },
  { c: "06", n: "Kaza ve Hasar", d: "Kaza tespit tutanakları, hasar dosyaları, ekspertiz.", anahtar: ["kaza", "hasar", "ekspertiz", "tramer"] },
];

/** Her müşteri klasörünün altında açılan standart bölümler. */
export const MUSTERI_SABLON = [
  { c: "01", n: "Teklifler", d: "Müşteriye verilen tüm teklifler.", anahtar: ["teklif", "ponuda", "fiyat"] },
  { c: "02", n: "Sözleşmeler", d: "İmzalı müşteri sözleşmeleri.", anahtar: ["sozlesme", "ugovor"] },
  { c: "03", n: "Yazışmalar", d: "Yazışmalar, toplantı notları, talepler.", anahtar: ["yazisma", "mail", "toplanti"] },
  { c: "04", n: "Cari", d: "Cari hesap mutabakatları ve bakiye yazıları.", anahtar: ["cari", "mutabakat", "bakiye", "ekstre"] },
];

/** Her ev (yurt dışı konaklama) klasörünün altında açılan standart bölümler. */
export const EV_SABLON = [
  { c: "01", n: "Kira Sözleşmesi", d: "Kira sözleşmesi, ekleri ve depozito makbuzu.", anahtar: ["kira sozlesmesi", "ugovor o zakupu", "depozito"] },
  { c: "02", n: "Faturalar", d: "Elektrik, su, doğalgaz, internet ve aidat faturaları.", anahtar: ["elektrik", "su faturasi", "dogalgaz", "internet", "aidat", "struja", "infostan"] },
  { c: "03", n: "Teslim Tutanağı", d: "Evi teslim alırken ve iade ederken tutulan tutanaklar, demirbaş listesi.", anahtar: ["teslim tutanagi", "ev teslim", "demirbas listesi"] },
  { c: "04", n: "Fotoğraflar", d: "Giriş ve çıkıştaki durum fotoğrafları.", anahtar: ["ev foto", "daire foto"] },
];

export const AGAC = [
  {
    c: "00", n: "Şirket Evrakları",
    d: "Şirketin kimliğini oluşturan resmî belgeler. Asıl nüshalar kasada, taramaları burada.",
    not: "Bu bölümdeki hiçbir belge silinmez. Süresi dolanlar 08 - Arşiv altına yıl klasörüyle taşınır.",
    hedef: false,
    ch: [
      { n: "Vergi Evrakları", d: "Vergi levhası, mükellefiyet yazıları, beyanname örnekleri.", anahtar: ["vergi levhasi", "mukellefiyet", "vergi yazisi"] },
      { n: "Ticaret Sicili", d: "Kuruluş gazetesi, sicil tasdiknamesi, imza sirküleri, faaliyet belgesi.", anahtar: ["ticaret sicil", "sicil gazetesi", "imza sirkuleri", "faaliyet belgesi", "apr"] },
      { n: "Ruhsatlar", d: "İşyeri açma ve çalışma ruhsatı, yapı ruhsatları, yetki belgeleri.", anahtar: ["isyeri ruhsati", "acma ruhsati", "yapi ruhsati", "yetki belgesi"] },
      { n: "Sigortalar", d: "İşyeri, mesleki sorumluluk ve nakliyat poliçeleri.", anahtar: ["isyeri sigortasi", "sorumluluk sigortasi", "nakliyat", "police"] },
      { n: "Sözleşmeler", d: "Kira, taşeronluk, tedarikçi ve ortaklık sözleşmelerinin imzalı nüshaları.", anahtar: ["kira sozlesmesi", "taseron", "tedarikci sozlesmesi", "ortaklik"] },
    ],
  },
  {
    c: "01", n: "İnsan Kaynakları (HR)",
    d: "Personel dosyalarının tek adresi. Her çalışan için aynı 15 klasörlü şablon kurulur.",
    not: "İşe giriş sırası: Şablonlar'dan formu kopyala → personel klasörünü aç → dolu belgeyi ilgili numaralı klasöre koy.",
    hedef: false,
    ch: [
      {
        n: "Şablonlar",
        d: "Doldurulmamış boş formlar. Üzerine asla yazılmaz; kopyalanıp kullanılır.",
        not: "Bir form güncellendiğinde eski sürüm Şablonlar / Eski altına alınır.",
        anahtar: ["sablon", "bos form", "template"],
        dosyalar: [
          "İş Sözleşmesi.docx", "Personel Bilgi Formu.docx", "Ücret Bildirim Formu.docx",
          "Zimmet Formu.docx", "İSG Taahhütnamesi.docx", "Gizlilik Taahhütnamesi.docx",
          "Puantaj.xlsx", "İzin Formu.docx", "Fazla Mesai Formu.docx",
        ],
        ch: [{ n: "Eski", d: "Yürürlükten kalkmış form sürümleri.", anahtar: ["eski form"] }],
      },
      {
        n: "Personeller",
        d: "Her çalışan için KDR-YIL-SIRA kodlu bir klasör. Personel tablosundan doldurulur.",
        not: "Personel klasörünün içindeki 15 alt klasör her çalışanda birebir aynıdır.",
        hedef: false,
        dinamik: "personel",
      },
      { n: "Arşiv", d: "İşten ayrılan personelin tam dosyası. Ayrılış tarihinden itibaren 10 yıl saklanır.", anahtar: ["personel arsiv", "ayrilan personel"] },
    ],
  },
  {
    c: "02", n: "Muhasebe",
    d: "Para hareketinin tamamı. Her alt klasör yıl ve ay bazında bölünür.",
    not: "Muhasebe klasörlerinde dosya adı daima YIL-AY ile başlar.",
    hedef: false,
    ch: [
      {
        n: "Maaşlar", d: "Aylık bordro icmalleri, ödeme listeleri ve SGK hizmet dökümleri.", anahtar: ["bordro icmal", "maas listesi", "sgk", "hizmet dokumu"],
        ch: [{ n: "Puantaj", d: "Kapanan 15 günlük puantaj dönemlerinin Excel dosyaları. Dönem kapatılınca sistem kendisi yazar.", anahtar: ["puantaj icmal", "donem puantaj"] }],
      },
      { n: "Kasa", d: "Aylık kasa dosyaları (gelir, gider, devir, bakiye). Kasada her değişiklikte sistem kendisi günceller.", anahtar: ["kasa defteri", "kasa raporu"] },
      { n: "Faturalar", d: "Alış ve satış faturaları; yıl → ay klasörlerine ayrılır.", anahtar: ["fatura", "invoice", "e-arsiv", "e-fatura", "faktura", "racun"] },
      { n: "Banka", d: "Hesap ekstreleri, kredi dosyaları, teminat mektupları.", anahtar: ["ekstre", "hesap ozeti", "kredi", "teminat mektubu", "izvod"] },
      { n: "Vergi", d: "KDV, muhtasar ve geçici vergi beyannameleri ile tahakkuk fişleri.", anahtar: ["kdv", "muhtasar", "beyanname", "tahakkuk", "gecici vergi", "pdv"] },
      { n: "Cari", d: "Müşteri ve tedarikçi cari hesap mutabakatları.", anahtar: ["cari hesap", "mutabakat", "bakiye"] },
    ],
  },
  {
    c: "03", n: "Projeler",
    d: "Sahadaki her iş için ayrı klasör. Proje tablosundan doldurulur.",
    not: "Proje kapandığında klasör olduğu gibi 08 - Arşiv altına, bitiş yılı klasörüne taşınır.",
    hedef: false,
    dinamik: "proje",
  },
  {
    c: "04", n: "Depo",
    d: "Stok listeleri, malzeme giriş-çıkış fişleri, sayım tutanakları, kritik stok takibi.",
    not: "Sayım tutanağı ayda bir alınır ve YIL-AY Sayım adıyla saklanır.",
    anahtar: ["stok", "sayim", "depo", "malzeme giris", "malzeme cikis", "irsaliye"],
  },
  {
    c: "05", n: "Araçlar",
    d: "Şirket araçlarının dosyası. Araç tablosundan doldurulur; her araç plakasıyla bir klasör.",
    not: "Her araç için plakasıyla bir alt klasör açılır.",
    hedef: false,
    dinamik: "arac",
  },
  {
    c: "06", n: "İSG",
    d: "Risk değerlendirmesi, acil durum planı, eğitim kayıtları, KKD zimmetleri, iş kazası tutanakları.",
    not: "Personele ait İSG belgesinin bir kopyası ayrıca o kişinin 11 İSG klasörüne konur.",
    hedef: false,
    ch: [
      { n: "Risk Değerlendirmesi", d: "Saha ve atölye risk analizleri, revizyonları.", anahtar: ["risk degerlendirme", "risk analizi"] },
      { n: "Acil Durum", d: "Acil durum planı, tatbikat kayıtları, kaçış planları.", anahtar: ["acil durum", "tatbikat", "yangin", "kacis plani"] },
      { n: "Eğitim Kayıtları", d: "Toplu İSG eğitim katılım listeleri ve sertifikalar.", anahtar: ["isg egitim", "egitim katilim", "sertifika"] },
      { n: "KKD", d: "Kişisel koruyucu donanım alım ve dağıtım kayıtları.", anahtar: ["kkd", "baret", "eldiven", "koruyucu donanim"] },
      { n: "İş Kazaları", d: "Kaza bildirim formları, tutanaklar, SGK bildirimleri.", anahtar: ["is kazasi", "kaza bildirim", "ramak kala"] },
    ],
  },
  {
    c: "07", n: "Müşteriler",
    d: "Müşteri bazlı teklif, sözleşme ve yazışma dosyaları. Müşteri tablosundan doldurulur.",
    not: "Aynı müşterinin birden çok işi varsa proje dosyaları 03 - Projeler altında kalır.",
    hedef: false,
    dinamik: "musteri",
  },
  {
    c: "08", n: "Arşiv",
    d: "Kapanmış yıllara ait tüm belgeler. Yıl klasörü altında, geldiği bölümün adıyla saklanır.",
    not: "Arşiv salt okunur çalışır. Buraya taşınan klasörün içeriği bir daha değiştirilmez.",
    anahtar: ["arsiv", "kapanmis", "eski yil"],
  },
  {
    c: "09", n: "Konaklama",
    d: "Yurt dışı projelerde kiralanan evler. Ev tablosundan doldurulur; her ev kodu ve adıyla bir klasör.",
    not: "Ev boşaltıldığında teslim tutanağı 03 Teslim Tutanağı klasörüne konur, klasör yerinde kalır.",
    hedef: false,
    dinamik: "ev",
  },
];

export const SABLONLAR = {
  personel: PERSONEL_SABLON,
  proje: PROJE_SABLON,
  arac: ARAC_SABLON,
  musteri: MUSTERI_SABLON,
  ev: EV_SABLON,
};

/** Dinamik klasörün adı nasıl kurulur. */
export const DINAMIK_AD = {
  personel: (r) => `${r.kod} ${r.ad}`.trim(),
  proje: (r) => r.ad,
  arac: (r) => `${r.plaka} ${r.marka || ""}`.trim(),
  musteri: (r) => r.ad,
  ev: (r) => `${r.kod} ${r.ad}`.trim(),
};

const parcala = (d) => (d.c ? `${d.c} - ${d.n}` : d.n);

/**
 * Statik ağacı düz bir yol listesine çevirir.
 * Döner: [{ yol, ad, d, not, hedef, anahtar, dinamik, derinlik, dosyalar }]
 */
export function duzYapi() {
  const out = [];
  const gez = (list, onek, derinlik) => {
    for (const d of list) {
      const ad = parcala(d);
      const yol = onek ? `${onek}/${ad}` : ad;
      out.push({
        yol, ad, kod: d.c || null, isim: d.n,
        d: d.d || "", not: d.not || "",
        hedef: d.hedef !== false && !d.dinamik,
        anahtar: d.anahtar || [],
        dinamik: d.dinamik || null,
        dosyalar: d.dosyalar || [],
        derinlik,
      });
      if (d.ch) gez(d.ch, yol, derinlik + 1);
    }
  };
  gez(AGAC, "", 0);
  return out;
}

/** Belirli bir dinamik türün ağaçtaki kök yolunu bulur. */
export function dinamikKok(tur) {
  const bulunan = duzYapi().find((x) => x.dinamik === tur);
  return bulunan ? bulunan.yol : null;
}
