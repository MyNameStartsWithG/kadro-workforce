# ACME MÜHENDİSLİK — Belge Yönetim Sistemi

Şirketin klasör düzenini yöneten, gelen belgeleri okuyup doğru klasöre yerleştiren
ve personel / araç / proje kayıtlarını Excel gibi tutan lokal bir uygulama.

Her şey **bu bilgisayarda** çalışır. Belgeler hiçbir buluta gitmez.
Tek istisna: yapay zekâ katmanını açarsanız, sınıflandırılacak belge Claude'a gönderilir.

---

## Kurulum

1. **Node.js** kurulu olmalı — [nodejs.org](https://nodejs.org) adresinden "LTS" sürümünü indirip kurun.
2. `KADRO-DMS` klasörünü müşterinin bilgisayarına kopyalayın.
3. **`baslat.bat`** dosyasına çift tıklayın.

İlk çalıştırmada gerekli paketler otomatik kurulur (birkaç dakika, internet gerekir).
Sonraki açılışlarda doğrudan başlar ve tarayıcı kendiliğinden açılır:
`http://localhost:4360`

Kapatmak için siyah komut penceresini kapatmanız yeterli.

### Kurulumsuz tek dosya (KADRO.exe)

Node.js kurulu olmayan bir bilgisayara göndermek için:

```
npm install
npm run paketle
```

`dagitim/KADRO.exe` (ve gönderim için `dagitim/KADRO.zip`) üretilir. Node.js, sunucu ve arayüz
exe'nin içindedir; karşı taraf sadece çift tıklar. Paketli sürümde veriler exe'nin yanına değil,
**Belgeler\KADRO** klasörüne yazılır (exe İndirilenler'den ya da zip içinden açılsa bile veri kaybolmaz).

**Hazır veriyle göndermek:** Önce Ayarlar → Yedeği indir ile veriyi alın, sonra:

```
node paketle.mjs --veri "KADRO yedek.json" --cikti dagitim/musteri
```

Veri exe'nin içine gömülür. Exe karşı bilgisayarda **ilk kez** açıldığında ve orada hiç kayıt yoksa veri bir kez yüklenir,
klasör yapısı kurulur, puantaj ve kasa Excel dosyaları yazılır. O bilgisayarda kayıt varsa hiçbir şeye dokunulmaz;
yedek dosyası zip'e ayrıca konursa Ayarlar → Yedekten yükle ile elle açılabilir. API anahtarı içeren yedek gömülmez.

**Bugünkü müşteri paketi (2.5.x):** örnek veri YOK, sesli komut anahtarı gömülü:

```
node paketle.mjs --asistan-anahtari <anahtar.txt>
```

`dagitim/KADRO.zip` = KADRO.exe + `BENİ OKU.txt` (güncelleme adımları; şablonu `dagitim/musteri/BENİ OKU.txt`).
Müşteri eski exe'nin yerine koyar; kayıtları `Belgeler\KADRO`'te kalır, yeni sürüm ilk açılışta otomatik yedek alır.

---

## İlk 5 dakika

| Sıra | Yapılacak | Nerede |
|------|-----------|--------|
| 1 | **Ayarlar** → belge kökünü kontrol edin (ağ sürücüsü de olabilir) | Ayarlar |
| 2 | **Yapıyı Diske Kur** — 9 ana bölüm ve alt klasörleri açılır | Panel |
| 3 | Personel satırlarını girin — her satır 15 klasörlü dosyayı otomatik açar | Personel |
| 4 | Araç, proje, müşteri kayıtlarını girin | ilgili sekmeler |
| 5 | Bir belgeyi sürükleyip bırakın, öneriyi onaylayın | Belge Yükle |

---

## Ekranlar

### Panel
Sayılar, **süre uyarıları** ve yapıyı kurma düğmesi.
Çalışma izni, oturma izni, pasaport, araç muayenesi ve poliçe bitişleri
yaklaştığında burada listelenir — süresi geçenler kırmızı.

### Öngörü
Menüde **Genel → Öngörü**. Sütunlar 15 günlük dönemlerdir ve tablo sağa sola kaydırılır.
Üstteki **‹‹ 3 ay / Bugün / 3 ay ››** düğmeleri tabloyu kaydırır. Gri sütunlar **gerçekleşen**, turuncu başlıklı sütunlar **tahmin**dir.
Bu dönem altı çizili başlıkla gösterilir.

| Satır | Gerçekleşen | Tahmin |
|---|---|---|
| Maaşlar | Puantaj hakedişi (mesai hariç) | Personelin güncel maaşı. Aylık: maaşın yarısı. Saatlik: iş günü × normal saat × ücret |
| Mesai | Puantajdaki mesai ücreti | Kişinin son 4 kapanmış dönemdeki mesai ortalaması |
| Yemek | Puantajda çalışılan günler | Ekip yemek tutarı × ekipteki kişi × çalışma günü |
| Ev kiraları | Kasadaki kira | Evlerin kirası, ayın ilk yarısına |
| Diğer giderler / Gelirler | Kasa | Kasadaki ileri tarihli satırlar ve "her ay tekrarlar" işaretli satırlar |
| Kasa bakiyesi | Kasadaki bakiye | Önceki bakiye + tahmini net |

- **Proje filtresi** sadece o projenin maliyetlerini gösterir. **EUR / TRY / RSD** sekmeleri para birimini seçer.
- **Hücreye tıklayınca** altta o tutarın kaynağı listelenir: hangi kişi, ekip, ev ya da kasa satırından geldiği.
- **Tahmini düzeltmek:** Tahmin hücresine tutar yazıp Enter'a basılır (1.500 ya da 1500,50 yazılabilir). Hücre sarıya döner.
  Hücreyi boşaltınca ya da ayrıntıdaki "Sistemin hesabına dön" düğmesine basınca sistemin tahminine dönülür.
  Düzeltme, yapıldığı proje görünümünde geçerlidir.
- Maaş, ekip ya da ev bilgisi değişince tahminler hemen güncellenir. Gerçekleşen dönemler değişmez.
- **Excel'e aktar:** Her para birimi ayrı sayfa olarak iner. Elle düzeltilen hücreler sarıdır ve notunda sistemin hesabı yazar.

### Klasör Ağacı
Diskteki **gerçek** durum. Yanındaki sayı o klasördeki dosya adedi.
Bir klasör seçince açıklamasını, kuralını, tam yolunu ve içindeki dosyaları görürsünüz.
"Klasörü aç" düğmesi Windows Gezgini'nde açar.

**Yanlış yüklenen belgeyi silmek:** Dosyanın satırındaki **Sil** düğmesi. Dosya kalıcı silinmez,
ağacın en üstündeki **_Silinenler** klasörüne asıl klasör yapısıyla taşınır; Belge Defteri'nin "Durum" sütununa
"Silindi (tarih, kullanıcı)" yazılır.
- _Silinenler'de dosyanın yanında **Geri yükle** (eski yerine koyar) ve **Kalıcı sil** (diskten tamamen siler, geri alınamaz) var.
- Dosya Excel ya da başka bir programda açıksa silinmez; program kapatılıp tekrar denenir.

### Belge Yükle
Dosyayı sürükleyip bırakın. Sistem hedefi önerir, siz onaylayana kadar **hiçbir şey taşınmaz**.
- Hedefi beğenmezseniz açılır listeden değiştirin.
- Dosya adı önerisi de düzenlenebilir (bordro/fatura gibi belgelere `YIL-AY` öneki eklenir).
- Onaylayınca dosya gerçek klasöre taşınır ve **Belge Defteri**'ne kaydedilir.

### Tablolar — Personel, Zimmet, Araçlar, Projeler, Müşteriler
Excel gibi çalışır: hücreye tıklayıp yazın, başka yere tıklayınca kaydedilir.

- **Excel'e aktar** → biçimli `.xlsx` iner (dondurulmuş başlık, filtre, açılır listeler).
- **Excel'den yükle** → aynı dosyayı Excel'de düzenleyip geri yükleyin.
  Personel kodu / plaka eşleşen satırlar **güncellenir**, yenileri **eklenir**.
- Yeni satır eklendiğinde diskteki klasörü şablonuyla birlikte otomatik açılır.
- Bir kaydın adını değiştirirseniz diskteki klasör de yeniden adlandırılır.
- Kayıt silmek **diskteki klasörü silmez** — belgeler yerinde kalır.

### Ekipler, Evler ve ayrıntı sayfaları
- Evlerde **Kira Periyodu** (Aylık / Haftalık / Günlük) seçilir. "Kişi Başı Kira (aylık)" ve "Kişi Başı Günlük" kendiliğinden hesaplanır.
Bağlar şöyle kurulur: personel bir **ekibe**, ekip bir **projeye** atanır. Yurt dışında personel bir **eve** atanır.
Tüm bağlar kodla tutulur, bu yüzden isim değişse de bağ kopmaz.

- Satırın başındaki **↗** işareti kaydın ayrıntı sayfasını açar. Personel, ekip, proje ve ev için ayrıntı sayfası var.
  Bilgiler bu sayfada da düzenlenebilir.
- **Ekip sayfası:** Üye ekleme ve çıkarma, ekibe zimmet yazma. Yemek tutarı kişi başı günlük girilir;
  ekip toplamı (günlük ve 15 günlük) otomatik hesaplanır.
- **Ev sayfası:** Kişi yerleştirme ve çıkarma, doluluk takibi (yatak sayısı aşılırsa uyarı verir).
  Kira kişi başına bölünür ve her kişinin projesine yazılır.
- **Proje sayfası:** Bağlı ekipler, kişiler, zimmetler ve evler tek sayfada. Yanında yemek, kira ve maaş özeti.
- **Zimmet** ya bir ekibe ya da bir kişiye yazılır (Sahip Türü). Üzerinde açık zimmet olan ekip silinemez.
- **Maaş bölümü:** Personelde Ödeme Türü (Aylık/Saatlik), Ücret ve Para Birimi alanları var.
  Her değişiklik tarihiyle personelin **Maaş Geçmişi**'ne yazılır.
- **Çalışanın gözünden:** Personel sayfasının sağ üstündeki düğme, çalışanın göreceği sayfayı açar:
  - ekibi, projesi, kaldığı ev, kira payı ve günlük yemek parası;
  - seçilen tarihlerin puantajı gün gün; gelmediği günler kırmızı. Üstteki çubuktan **en fazla iki dönem**
    seçilir (dönem çipine tıklamak seçime ekler ya da çıkarır; üçüncüye tıklanırsa ona en uzak olan çıkar) ya da
    **Tarih aralığı**na iki gün yazılır (ör. 03.10 – 20.11). Aralık ikiden çok döneme denk gelirse son iki dönem gösterilir
    ve çubukta uyarı çıkar. **Bu ay** ve **Son 2 dönem** kısayolları var.
    Seçilen günlerin çalışılan gün, toplam / normal / mesai saati, gelmedi, izin ve rapor sayıları üstte toplanır;
  - hakediş hesabı satır satır (seçilen her dönem için, dönemin tamamı): maaşın yarısı / çalışılan saat, mesai,
    her kesinti formülüyle, avans, net; ayın 2. yarısında "Ay sonunda alacağınız" (ayrı büyük rakam kutusu yok);
  - **Ödemeleriniz · yemek parası:** sadece seçilen ayın yemek parası kalemleri (ödendi / bekliyor); maaş ödemeleri yazılmaz;
  - çalışma dönemleri (kontratları) ve belgelerinin (çalışma izni, oturma izni, pasaport) bitiş tarihleri.

  Yönetici notları, IBAN, telefon, kasa ve başka çalışanların bilgisi bu sayfada yer almaz.
  **Yazdır / PDF** şunları basar: ad, kod, ekip ve proje, puantaj (gün ızgarası ve saat toplamları), hakediş hesabı ve o ayın
  yemek parası ödemeleri. Ücret, ev, çalışma dönemleri ve belgeler PDF'e girmez.
  PDF dosya adı olarak "Puantaj ve hakediş <ad> <ilk gün>_<son gün>" önerilir.
  İleride çalışan portalı bu sayfayı gösterecek.
- **Notlar paneli:** Personel sayfasında, Bilgiler kartının altında. Not adı ve not yazılıp **Kaydet**'e basılır;
  her not ayrı kaydedilir. Altta kaydedilmiş notların adları ve tarihleri sıralanır (son değişen en üstte).
  Ada tıklayınca not açılır; sağdaki **✎** notu düzenlemek için forma alır, **✕** onay sorup siler.
  Not adı boş bırakılırsa notun ilk satırı ad olur. Notlar yöneticiye özeldir: çalışan sayfasına, sesli komuta ve Excel'e girmez.
  Personeldeki eski tek satırlık "Notlar" alanı ilk açılışta bir kez "Genel not" adıyla bu panele taşındı ve tablodan kalktı.
- **Sigorta Giriş:** Personelde İşe Giriş'in yanında tarih alanı. Tabloda, kişi sayfasında ve Excel'de görünür.
- **Çalışma Dönemleri (kontrat):** Kişinin hangi tarihler arasında, hangi projede çalıştığı. Kişi sayfasındaki
  **Çalışma Dönemleri** kartından ya da menüdeki **Çalışma Dönemleri** tablosundan girilir.
  - Tür **Çalışma**: başlangıç zorunlu; **Bitiş (işten çıkış)** boşsa süresiz. Çıkış tarihi önceden girilebilir
    (kartta süresiz dönemin yanında **Çıkış tarihi gir** düğmesi var). Proje değişiyorsa önceki dönem bir gün önce bitirilip
    yeni proje için yeni dönem açılır; aynı kişinin çalışma dönemleri çakışamaz.
  - Tür **İzin**: uzun izin (ör. memlekete dönüş). Sadece durumu İzinli yapar, maaş hesabını değiştirmez.
  - Çalışma dönemi girilen kişinin **durumu bugüne göre kendiliğinden** hesaplanır (Aktif / İzinli / Ayrıldı) ve
    Bilgiler kartında kilitlenir. İleri tarihli işe alım, başlayana kadar Aktif görünür. Çıkış günü geçince kişi Ayrıldı olur.
  - **Puantaj:** Yeni dönem açılırken kişi, çalışma dönemi o 15 günle kesişiyorsa alınır. Çalışma dönemi dışındaki günler
    taralı görünür ve hiçbir hesaba girmez (saat, maaş payı, yemek, kira, kesinti). Aylıkçı dönemin bir kısmında çalışıyorsa
    günlük maaş × gün alır. Tarihler açık dönemlere hemen yansır; kapalı dönemler kapandığı hâliyle kalır.
    Eski kurallı (kural 1) dönemlerde uygulanmaz.
  - **Öngörü:** Tahminde kişi sadece çalışma dönemi içindeki günler için sayılır (maaş, mesai ve yemek).
  - **Uyarı:** Bitişine 30 gün kalan çalışma dönemi Panel'deki süre uyarılarına düşer ve kişinin sayfasına bağlanır.
    Devamı (sonraki dönem) girilmişse uyarı vermez.
  - Çalışma dönemi olmayan kişide her şey eskisi gibi elle girilen duruma göre işler.

### Puantaj
Ay iki döneme bölünür: **1–15** ve **16–ay sonu**. Üstteki ‹ › oklarıyla dönemler arasında gezilir.

- **Dönemi aç:** Kişilerin o günkü maaşı, ekibi, ekiplerin yemek tutarı ve ev kira payları döneme kopyalanır.
  Bundan sonra personel kartında yapılan maaş değişikliği bu dönemi etkilemez.
- **Hücreler:** Saat yazılır (8, 10,5). Harf kodları: `İ` izin, `R` rapor, `–` gelmedi.
  Enter ve ok tuşlarıyla hücreler arasında gezilir. Excel'den kopyalanan bir blok doğrudan yapıştırılabilir.
- **Gün başlığına tıklama:** Gün tipi değişir: Normal / Mesai günü / Tatil. Varsayılan olarak Cumartesi mesai günü, Pazar tatildir.
  Aynı menüden "boş hücrelere 8 yaz", "önceki günü kopyala" ve "sütunu temizle" seçilebilir.
- **Hücreye sağ tıklama:** Kod seçilir ve o günün ekibi değiştirilir (dönem ortasında başka ekibe geçen kişi için).
  Başka ekipte geçen günlerin köşesinde turuncu bir işaret görünür.
- **Satır menüsü (⋯):** Boş normal günleri doldurma, ekibi tarih aralığında değiştirme, satırı temizleme ve dönemden çıkarma.
- **Yan panel (sağdaki "Panel" sekmesi):**
  - İstatistikler. Değere tıklayınca hesap makinesine eklenir.
  - Mesai ayarları: mesai hesabı (sabit saatlik ücret ya da çarpan), para birimine göre mesai ücreti (EUR / TRY / RSD),
    normal gün saati, hafta içi aşım ve tatil kuralı, aylıkçıda eksik saat kesintisi.
  - Hesap makinesi.
- **Hesap (Ekim 2026'dan itibaren açılan dönemler):**
  - **Mesai:** mesai saati × sabit saatlik mesai ücreti. Ücret paneldeki para birimi ücretidir; personel kartında
    "Mesai Ücreti" girilmişse o kişi için o kullanılır. Ücret dönem açılırken önceki dönemden devralınır.
  - Saatlik çalışan: normal saat × ücret + mesai.
  - Aylık çalışan: maaşın yarısı + mesai. Dönem içinde işe girdiyse: günlük maaş × işe girişten sonraki gün sayısı.
  - **Kesinti sadece `–` (gelmedi) yazılan günlerde:**

    | Çalışan | Gelmediği her gün kesilen |
    |---|---|
    | Aylık | günlük maaş (maaş × 12 ÷ 365) + günlük kira payı + günlük yemek |
    | Saatlik | günlük kira payı + günlük yemek (çalışmadığı saat zaten ödenmez) |

    Boş hücre, izin (`İ`), rapor (`R`) ve işe giriş tarihinden önceki günler kesinti doğurmaz. İşe giriş öncesi günler çizgili görünür.
    Günlük kira payı = ev kirası × F ÷ 365 ÷ evde kalan kişi (F: aylık kira 12, haftalık 52, günlük 365).
  - **Farklı para birimi:** Kira, yemek ya da avans maaştan farklı para birimindeyse dönemin kuruyla maaşın
    para birimine çevrilip düşülür (ör. 600 RSD yemek ÷ 117 = 5,13 EUR). Kur Ayarlar'dan gelir (aşağıda "Para birimi ve kur").
    O para biriminin kuru girilmemişse düşülmez, satırda uyarı çıkar.
  - **Kesinti dökümü:** Kesinti rakamına tıklayınca kalem kalem formül açılır. Örnek (aylık 1000 EUR, kira 550 EUR / 3 kişi, yemek 600 RSD, 1 gün gelmedi):

    | Kalem | Formül | Tutar |
    |---|---|---|
    | Günlük maaş | 1 gün × 1.000 EUR × 12 ÷ 365 | 32,88 EUR |
    | Kira payı | 1 gün × 550 EUR × 12 ÷ 365 ÷ 3 kişi | 6,03 EUR |
    | Yemek | 1 gün × 600 RSD ÷ 117 | 5,13 EUR |
    | **Toplam** | | **44,04 EUR** |

    Aynı döküm kişi kartındaki "Devamsızlık ve Kesinti" tablosunda ve puantaj Excel'inde (Kesinti hücresinin notu) de yazar.
    Günlük maaş 30'a değil 365 ÷ 12'ye bölünür: 12 × 30 = 360 gün eder, yılın 5 günü hesap dışı kalırdı.
  - Net = hakediş − kesinti − avans. 2. yarıda "Ay Sonu Ödenecek" sütunu iki dönemin netini toplar.
  - **Eski dönemler** eski kuralla kalır. Ekim 2026 öncesi açılanlar: mesai çarpanla, kesinti eksik saat × saat değeri.
    13 Ekim 2026 öncesi açılanlar: kur çevirisi yok (farklı para birimindeki kesinti ve avans düşülmez).
    Açık bir eski dönem, paneldeki "Yeni kurallara geçir" düğmesiyle yeni hesaba alınabilir.
  - Panelde dönemin kuru yazar. Ayarlar'da kur değişirse açık dönemde "Güncel kuru al" düğmesi çıkar; kapalı dönem değişmez.
- **Dönemi kapat:** Hücreler kilitlenir ve Excel dosyası `02 - Muhasebe/Maaşlar/Puantaj/` klasörüne yazılır.
  Maaşlar kasaya kendiliğinden düşmez; **Ödemeler** ekranında "bekliyor" olarak görünür.

### Avanslar ve Çalışan İstatistikleri
- **Avanslar** tablosuna tarih, kişi ve tutar girilir. Avans tarihine göre ilgili puantaj döneminde görünür
  ve aynı anda kasaya gider olarak yazılır.
- **Çalışan İstatistikleri** tüm dönemleri kişi ve proje bazında toplar. Proje görünümünde her günün saati ve tutarı,
  kişinin o gün çalıştığı ekibin projesine yazılır. Kişi kartındaki "Çalışma Özeti" bilgileri dönem dönem gösterir.
- Kişi kartındaki **"Devamsızlık ve Kesinti"** kartı kişinin zarar istatistiğidir: kaç gün gelmediği (tarihleriyle),
  maaşından kesilen günlük maaş, kira payı ve yemek; dönem dönem ve toplam.

### Ödemeler
Menüde **Puantaj, Maaş ve Kasa → Ödemeler**. Ay ay açılır; vadesi gelmiş ödenmemiş kalem sayısı menüde kırmızı sayaçla görünür.

| Kalem | Ne zaman listelenir | Vade |
|---|---|---|
| Ev kiraları | Ayın 1. yarısı açılınca | Ayın 1'i |
| Yemek paraları (kişi başı, önden) | Her dönem açılınca | Dönemin ilk günü (1'i ve 16'sı) |
| Saatlik ücretler | Dönem kapanınca | Dönemin ertesi günü (16'sı ve sonraki ayın 1'i) |
| Aylık maaşlar | Ayın 2. yarısı kapanınca | Sonraki ayın 1'i |

- Satırdaki kutuya tik atınca kalem **ödendi** olur ve ödeme tarihiyle kasaya gider olarak düşer.
  Ödeme tarihi grubun üstünden seçilir.
- **Ödenen tutar değiştirilebilir:** Örneğin hesaplanan 100 € yerine 90 € ya da 110 € ödendiyse "Ödenen" kutusuna yazılır.
  Fark satırda görünür, kasaya ödenen tutar yazılır. "Not" alanına sebep yazılabilir (ör. "elden, yuvarlandı").
- **Tümü ödendi:** Grubun üstündeki düğme, gruptaki bütün ödenmemiş kalemleri tek seferde ödendi yapar.
- Tik kaldırılırsa ödendi işareti ve kasadaki satır silinir.
- Ödendikten sonra hesap değişirse (ör. dönem yeniden açılıp saat düzeltildiyse) satırda "hesap değişti" uyarısı çıkar.
- Satırın altındaki küçük yazı hesabın dökümüdür: hakediş, mesai, kesinti (kaç gün gelmedi), avans.

### Kasa
Menüde **Puantaj, Maaş ve Kasa → Kasa**. Ekran ay ay açılır; ‹ › oklarıyla aylar arasında gezilir.

- **Özet:** Devir (önceki aylardan kalan), gelir, gider ve ay sonu bakiye. Kur çevirisi yapılmaz; EUR, TRY ve RSD ayrı satırlarda görünür.
- **+ Gelir / + Gider:** Elle satır eklenir. Satır Excel gibi düzenlenir ve başka yere tıklayınca kaydedilir.
  "Her Ay Tekrarlar" işareti, kira dışı sabit giderler içindir (öngörü tablosu bunları kullanacak).
- **Otomatik satırlar** (açık turuncu zeminli, "Otomatik" etiketli). Bunları sistem yazar:

  | Kaynak | Ne zaman | Tarih | Proje |
  |---|---|---|---|
  | Avans | Avans girilince, değişince ya da silinince | Avansın tarihi | O gün kişinin ekibinin projesi |
  | Ödeme (maaş, yemek, kira) | Ödemeler ekranında "ödendi" işaretlenince | Ödeme tarihi | Kişinin projesi; kira evde kalanların projelerine bölünür |

  Maaş ödemesi avanslar düşülmüş tutardır. Avans ayrı satır olduğu için toplamları hakedişe eşittir.
- **Elle düzeltme:** Otomatik bir satırın tutarı, tarihi, projesi vb. değiştirilirse satır "Elle düzeltildi" olur ve
  sistem onu bir daha ezmez. "Sistemin Hesabı" sütununda sistemin bulduğu tutar görünmeye devam eder.
  "Elle düzeltildi" etiketine tıklanırsa düzeltme silinir ve satır sistemin hesabına döner.
- **Otomatik satırı silme:** Sistem o satırı bir daha yazmaz. Kasa ekranındaki "Geri getir" düğmesi o ayın silinen otomatik satırlarını geri yazar.
- **Aylık dosya:** `02 - Muhasebe/Kasa/2026-10 Kasa.xlsx`, kasada her değişiklikte kendiliğinden güncellenir.
  Dosya o sırada Excel'de açıksa güncellenemez. Kasa ekranında uyarı çıkar; dosya kapandıktan sonraki ilk değişiklikte yazılır.
- **Raporlar sekmesi:** 15 gün, aylık, çeyrek, yarıyıl, yıllık ve proje bazlı. Her satırda devir, gelir, gider, net ve bakiye bulunur.
  Satıra tıklayınca altta o dönemin kategori ve proje dağılımı açılır. Proje filtresi ve "Raporu Excel'e aktar" de var.

### Para birimi ve kur (Ayarlar)
- **Ana para birimi** seçilir (varsayılan EUR) ve diğerlerinin karşılığı elle yazılır: `1 EUR = 117 RSD`, `1 EUR = 45 TRY`.
  Kur internetten çekilmez. Ana para birimi değiştirilirse girilen oranlar yeni anaya göre kendiliğinden yeniden yazılır.
- Kur, puantaj dönemi **açılırken** döneme kopyalanır; sonradan değişen kur açılmış dönemleri etkilemez
  (açık dönemde panelden "Güncel kuru al" ile yenilenir).
- Kasa, Ödemeler ve puantaj panelindeki **"≈ EUR"** satırı, birden çok para birimindeki toplamların ana para birimindeki
  karşılığıdır (bilgi amaçlı). Kasa satırları kendi para biriminde kalır.

### Belge Defteri
Sisteme giren her dosyanın kaydı: ne zaman, hangi klasöre, hangi yöntemle,
kaç güvenle yerleştirildi. Düzenlenemez; sadece okunur ve Excel'e aktarılır.
Silinen, geri yüklenen ve kalıcı silinen belgeler "Durum" sütununda tarihiyle yazar.

### Sesli komut
Her ekranın sağ altındaki turuncu **mikrofon** düğmesi. Mikrofona dokunup konuşun, bitince tekrar dokunun
(ya da alttaki kutuya yazın). Örnekler:

> "Cem bugün gelmedi, Tolga 10 saat çalıştı" · "Mehmet'e 100 euro avans verdim" ·
> "60 euro yakıt aldım" · "Cem'in eylül ikinci yarı ücreti ödendi" · "Tolga'yı Novi Sad Elektrik ekibine al" ·
> "Murat bu ay ne alacak?" · "Bugün kimler gelmedi?"

- **Hiçbir şey siz Onayla'ya basmadan yazılmaz.** Her iş bir kart olarak gelir: kim, hangi gün, ne değişiyor
  (ör. "8 saat → gelmedi"). Birden çok kart gelirse "Hepsini onayla" da var.
- İsim belirsizse ("Demir") asistan hangisi olduğunu sorar; cevabı aynı konuşmada verin ("Ahet olan").
  "Yeni konuşma" önceki konuşmayı unutturur.
- Yapılabilenler: puantaj (saat, izin, rapor, gelmedi), avans, kasaya gelir/gider, ödemeyi "ödendi" işaretleme,
  personelin ekibi/evi/görevi/durumu ve sorular (puantaj, hakediş, ödemeler, kasa, avanslar).
- Yapılamayanlar: silme, maaş/ücret değiştirme, puantaj dönemi açma/kapatma, kapalı döneme yazma, ayarlar. Bunlar ekrandan yapılır.
- Ekip ya da ev değişikliği açık puantaj dönemine yansımaz (her değişiklik sadece yeni dönemleri etkiler); kart bunu yazar.
- Çalışma dönemi girilmiş kişinin durumu sesle değiştirilmez (durum dönemlerden hesaplanır); asistan bunu söyler.
- **Son işlemler** (panelin altı): sesle yazılan her işlem, söylenen cümleyle birlikte. **Geri al** kaydı eski hâline döndürür;
  kayıt sonradan elle değiştirildiyse geri alma durur ve elle düzeltmeniz istenir.
- Kurulum: müşteriye giden exe'de anahtar gömülü gelir, bir şey girilmez. Gömülü değilse **Ayarlar → Sesli komut** bölümüne
  anahtar girilir (girilen anahtar gömülü olanın önüne geçer). Adres boş kalırsa varsayılan sunucu
  (`https://n8n.example.com`) kullanılır; sunucu değişirse adres alanına yeni adres yazılır. Ses ve cümle bu sunucuya
  (n8n → Groq ile yazıya dökme, DeepSeek ile anlama) gider. Personel adları ve sorulan puantaj/avans/ödeme/kasa bilgisi
  gider; IBAN, telefon, pasaport ve notlar gitmez. Anahtar yedeğe girmez.
- **Komut kaydı:** her komut (söylenen cümle, asistanın çağırdığı işlemler ve sonuçları, süre, token) ve kart
  olayı (onay, vazgeç, geri alma, süresi dolma) önce bu bilgisayara (`veri/asistan-kayit/<ay>.jsonl`), sonra
  sunucudaki `kadro_kayit` tablosuna yazılır (müşteri onayıyla, asistanı iyileştirmek için). Ses kaydedilmez.
  Gönderim en fazla 15 dakikada bir, toplu; internet yoksa kayıt bekler, sonra gider.
- Mikrofon bu bilgisayarda (`localhost`) çalışır. Telefondan kullanmak için programın HTTPS bir adresle açılması gerekir
  (tarayıcılar şifresiz adreste mikrofon vermez).

---

## Yapay zekâ katmanı nasıl çalışır

İki aşamalıdır:

**1. Kural motoru** — dosya adındaki anahtar kelimeleri ve tablolardaki
isim / plaka / proje adlarını eşleştirir. Anında, ücretsiz, internetsiz.

> `2026-03 Mehmet Kılıç Bordro.pdf`
> → `01 - İnsan Kaynakları (HR)/Personeller/KDR-2026-0001 Mehmet Kılıç/06 Maaş Bordroları` (%90)

**2. Claude** — kural yeterince emin olamazsa devreye girer ve belgenin
**içini okur**: PDF'in sayfalarını, taranmış kimlik/pasaport görsellerini.
Kişiyi, tarihi ve belge türünü belgeden çıkarır.

### Modlar (Ayarlar ekranından)

| Mod | Açıklama |
|-----|----------|
| **Kural + yapay zekâ** | Önerilen. Kural emin olamazsa Claude'a sorulur. |
| **Sadece yapay zekâ** | Her belge Claude'a gider. En isabetli, en pahalı. |
| **Sadece kural** | Tamamen offline ve ücretsiz. Hiçbir belge dışarı çıkmaz. |

### API anahtarı
`console.anthropic.com` adresinden alınır, **Ayarlar** ekranına girilir.
Anahtar `veri/db.json` içinde bu bilgisayarda saklanır. Kullanılan model: `claude-opus-5`.

Anahtar girilmezse uygulama **durmaz** — sadece kural motoruyla çalışmaya devam eder.

---

## Dosya adı önerileri

Sistem, tarih içeren belgeleri standart biçime çevirir:

- Bordro, puantaj, dekont, fatura, ekstre, hakediş → `2026-03 ...` (yıl-ay öneki)
- Diğer tarihli belgeler → `2026-03-14 ...`
- Zaten tarihle başlayan dosya adlarına dokunulmaz.

Aynı adda dosya varsa üzerine yazılmaz; sonuna ` (2)`, ` (3)` eklenir.

---

## Klasör düzenini değiştirmek

Tüm yapı tek bir dosyada tanımlıdır: **`src/yapi.js`**

Yeni klasör eklemek, açıklama değiştirmek ya da anahtar kelime eklemek için
o dosyayı düzenleyin, uygulamayı yeniden başlatıp **Yapıyı Kur** deyin.
Var olan klasörlere ve belgelere dokunulmaz, sadece eksikler açılır.

Aynı dosyada dört şablon var:
- `PERSONEL_SABLON` — her çalışanda açılan 15 klasör
- `PROJE_SABLON` — her projede açılan 8 bölüm
- `ARAC_SABLON` — her araçta açılan 6 bölüm
- `MUSTERI_SABLON` — her müşteride açılan 4 bölüm

Tablo sütunlarını değiştirmek için: **`src/tablolar.js`**
(`uyari: 60` yazan alanlar, bitişine 60 gün kala uyarı üretir.)

---

## Yedekleme

| Ne | Nerede |
|----|--------|
| Tüm kayıtlar (personel, ekipler, zimmet, evler, puantaj, avans, kasa, öngörü, belge defteri) | `veri/db.json` — **tek dosya** |
| Belgeler | Ayarlar'daki belge kökü klasörü |

KADRO.exe ile bu klasörler `Belgeler\KADRO` altındadır.

### Veriyi başka bilgisayara taşımak (Ayarlar → Veri ve yedek)
1. Veriyi giren bilgisayarda **Yedeği indir**'e basın. `KADRO yedek 2026-10-09.json` adlı tek bir dosya iner.
2. Dosyayı karşı tarafa gönderin (e-posta, USB…).
3. Karşı bilgisayarda KADRO.exe'yi açın, **Ayarlar → Yedekten yükle…** ile dosyayı seçin.
   - O bilgisayardaki kayıtlar yedektekilerle **değiştirilir**. Eski kayıtlar önce `veri/yedekler/` klasörüne kaydedilir; yanlışlıkla yüklenirse oradan geri yüklenebilir.
   - Belge kökü ve API anahtarı o bilgisayardaki gibi kalır. API anahtarı yedek dosyasına hiç yazılmaz.
   - Eski sürümden alınmış yedek ya da düz `db.json` da yüklenebilir. Eksik alanlar yükleme sırasında tamamlanır.
4. Belgeler (PDF, fotoğraf) yedeğe girmez. Gerekirse belge kökü klasörünü ayrıca kopyalayın.

### Kayıtları sıfırlamak (Ayarlar → Kayıtları sıfırla)
Deneme kayıtlarından kurtulup temiz başlamak için **Tüm kayıtları sil…** düğmesi.
1. İlk pencere neyin silineceğini sayılarıyla gösterir. İsteğe bağlı: **Belge klasörünü de temizle**.
2. İkinci pencerede kutuya **SİL** yazılır; düğme ancak o zaman açılır.

- Silinenler: personel, ekip, proje, ev, araç, müşteri, zimmet, avans, puantaj, kasa, öngörü düzeltmeleri, ödemeler ve Belge Defteri.
- Kalanlar: ayarlar (belge kökü, kur, API anahtarı, kullanıcı adı).
- Silmeden önce otomatik yedek alınır: `veri/yedekler/db-…-sifirlamadan-once.json`. Yanlışlıkla silindiyse
  **Yedekten yükle…** ile bu dosya seçilir, her şey geri gelir.
- "Belge klasörünü de temizle" işaretlenirse belgeler silinmez: klasör `ACME MUHENDISLIK (eski 2026-10-14)` adıyla
  kenara alınır, yerine boş klasör yapısı kurulur. İşaretlenmezse belgeler olduğu gibi kalır.
- Sıfırlamadan sonra exe'nin içindeki hazır örnek veri bir daha yüklenmez.

### Test için ayrı veri klasörü
KADRO.exe normalde veriyi `Belgeler\KADRO` altında tutar. Gerçek veriye dokunmadan denemek için exe'yi
`KADRO_KLASOR` ortam değişkeniyle başlatın. PowerShell'de:
```powershell
$env:KADRO_KLASOR = "C:\KADRO-test"; $env:PORT = "4370"; .\KADRO.exe
```

---

## Sorun giderme

**"Node.js kurulu değil" yazıyor**
nodejs.org adresinden LTS sürümünü kurup `baslat.bat`'ı tekrar çalıştırın.

**Tarayıcı açılmıyor**
Elle `http://localhost:4360` adresine gidin. Komut penceresi açık olmalı.

**Port kullanımda hatası**
Başka bir kopya çalışıyor olabilir. Komut pencerelerini kapatın ya da
`baslat.bat` içine `set PORT=4370` satırı ekleyin.

**Excel geri yüklenmiyor**
Sistemden indirdiğiniz dosyayı kullanın — başlık satırı sütunları tanımak için gerekli.
Başlık metinlerini değiştirmeyin; satır ekleyip veri yazmak serbesttir.

**Yapay zekâ çalışmıyor**
Ayarlar ekranında "açık" yazıyor mu, internet var mı kontrol edin.
Sorun sürerse uygulama sessizce kural motoruna düşer ve çalışmaya devam eder.

---

## Teknik özet

- Node.js + Express lokal sunucu, `127.0.0.1` üzerinde dinler (dışarıya açık değildir)
- Veri: tek JSON dosyası — veritabanı sunucusu gerekmez
- Excel: ExcelJS ile gerçek `.xlsx` üretimi ve okuma
- Yapay zekâ: Anthropic SDK, `claude-opus-5`, PDF ve görsel girdi desteği
- Belge kökünün dışına yazma girişimleri reddedilir
