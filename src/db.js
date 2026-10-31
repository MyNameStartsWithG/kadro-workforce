/**
 * Basit JSON veri deposu. Tüm veriler veri/db.json içinde tutulur —
 * yedeklemek için o tek dosyayı kopyalamak yeterlidir.
 */
import fs from "node:fs";
import path from "node:path";

const BOS = {
  personel: [], zimmet: [], ekip: [], arac: [], proje: [], ev: [], musteri: [], belge: [],
  avans: [], puantaj: [],
  notlar: [],               // kişi notları (personel sayfasındaki Notlar paneli, bkz. notlar.js)
  kontrat: [],              // çalışma dönemleri: kişi × proje × başlangıç–bitiş (bkz. kontrat.js)
  kasa: [],
  kasaSilinen: [],          // elle silinen otomatik kasa satırları: sistem bunları bir daha üretmez
  ongoru: {},
  odeme: [],                // Ödemeler ekranında "ödendi" işaretlenen kalemler (maaş, yemek parası, kira)               // öngörü tablosunda elle düzeltilen tahmin hücreleri
  asistan: [],              // sesli komutla onaylanan işlemler (geri alma bilgisiyle)
  ayarlar: {
    belgeKoku: "",
    apiAnahtari: "",
    aiModu: "karma",          // karma | sadeceAi | sadeceKural
    kullanici: "Yönetici",
    esik: 0.72,               // kural güveni bu değerin altındaysa Claude'a sorulur
  },
};

let dosyaYolu = null;
let veri = null;

export function baslat(veriDizini) {
  fs.mkdirSync(veriDizini, { recursive: true });
  dosyaYolu = path.join(veriDizini, "db.json");
  if (fs.existsSync(dosyaYolu)) {
    try {
      veri = { ...structuredClone(BOS), ...JSON.parse(fs.readFileSync(dosyaYolu, "utf8")) };
      veri.ayarlar = { ...BOS.ayarlar, ...(veri.ayarlar || {}) };
    } catch (e) {
      const yedek = `${dosyaYolu}.bozuk-${Date.now()}`;
      fs.copyFileSync(dosyaYolu, yedek);
      console.error(`[db] db.json okunamadı, yedeklendi: ${yedek}`);
      veri = structuredClone(BOS);
    }
  } else {
    veri = structuredClone(BOS);
    yaz();
  }
  return veri;
}

/** Yedek dosyasına girecek veri: API anahtarları bilgisayardan çıkmaz. */
export function disaAktar() {
  const kopya = structuredClone(veri);
  delete kopya.ayarlar.apiAnahtari;
  delete kopya.ayarlar.asistanAnahtari;
  return kopya;
}

/**
 * Yedekten geri yükler. Mevcut db.json önce veri/yedekler altına kopyalanır.
 * Bu bilgisayara ait ayarlar (belge kökü, API anahtarı) korunur.
 * Döner: yedeklenen dosyanın yolu.
 */
export function iceAktar(gelen) {
  if (!gelen || typeof gelen !== "object" || Array.isArray(gelen)) throw new Error("Yedek dosyası okunamadı.");
  const tablolar = Object.keys(BOS).filter((k) => Array.isArray(BOS[k]));
  if (!tablolar.some((k) => Array.isArray(gelen[k]))) throw new Error("Bu dosya bir KADRO yedeği değil.");
  for (const k of tablolar) {
    if (k in gelen && !Array.isArray(gelen[k])) throw new Error(`Yedekte "${k}" bölümü bozuk.`);
  }
  if ("ongoru" in gelen && (typeof gelen.ongoru !== "object" || Array.isArray(gelen.ongoru))) throw new Error('Yedekte "ongoru" bölümü bozuk.');

  const eskiYedek = yedekAl("yuklemeden-once");

  const buBilgisayar = {
    belgeKoku: veri.ayarlar.belgeKoku, apiAnahtari: veri.ayarlar.apiAnahtari,
    asistanAdres: veri.ayarlar.asistanAdres || "", asistanAnahtari: veri.ayarlar.asistanAnahtari || "",
  };
  veri = { ...structuredClone(BOS), ...structuredClone(gelen) };
  veri.ayarlar = { ...BOS.ayarlar, ...(gelen.ayarlar || {}), ...buBilgisayar };
  yaz();
  return eskiYedek;
}

/** db.json'ı veri/yedekler altına kopyalar. Döner: yedeğin yolu. */
export function yedekAl(etiket) {
  const klasor = path.join(path.dirname(dosyaYolu), "yedekler");
  fs.mkdirSync(klasor, { recursive: true });
  const damga = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  const hedef = path.join(klasor, `db-${damga}-${etiket}.json`);
  fs.copyFileSync(dosyaYolu, hedef);
  return hedef;
}

/**
 * Bütün kayıtları siler, ayarlar (belge kökü, API anahtarı, kur…) kalır. Önce yedek alınır.
 * Exe'ye gömülü başlangıç verisi bir daha yüklenmesin diye işaret bırakılır.
 * Döner: yedeğin yolu.
 */
export function sifirla() {
  const yedek = yedekAl("sifirlamadan-once");
  const ayar = veri.ayarlar;
  veri = structuredClone(BOS);
  veri.ayarlar = { ...BOS.ayarlar, ...ayar, baslangicVerisi: { tarih: new Date().toISOString(), atlandi: "Kayıtlar sıfırlandı." } };
  yaz();
  return yedek;
}

export function tum() { return veri; }
export function tablo(ad) { return veri[ad] || []; }
export function ayarlar() { return veri.ayarlar; }

export function ayarKaydet(yeni) {
  veri.ayarlar = { ...veri.ayarlar, ...yeni };
  yaz();
  return veri.ayarlar;
}

export function yaz() {
  const gecici = `${dosyaYolu}.tmp`;
  fs.writeFileSync(gecici, JSON.stringify(veri, null, 2), "utf8");
  fs.renameSync(gecici, dosyaYolu);
}

export function yeniId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function satirEkle(tabloAdi, satir) {
  const s = { _id: yeniId(), _olusturma: new Date().toISOString(), ...satir };
  veri[tabloAdi].push(s);
  yaz();
  return s;
}

export function satirGuncelle(tabloAdi, id, alanlar) {
  const s = veri[tabloAdi].find((x) => x._id === id);
  if (!s) return null;
  Object.assign(s, alanlar, { _guncelleme: new Date().toISOString() });
  yaz();
  return s;
}

export function satirSil(tabloAdi, id) {
  const i = veri[tabloAdi].findIndex((x) => x._id === id);
  if (i < 0) return false;
  veri[tabloAdi].splice(i, 1);
  yaz();
  return true;
}

export function satirBul(tabloAdi, esle) {
  return veri[tabloAdi].find(esle) || null;
}
