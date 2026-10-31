/**
 * Müşteriye gönderilecek tek dosyalık KADRO.exe'yi üretir.
 * Kurulum gerektirmez: Node.js, sunucu kodu ve arayüz exe'nin içindedir.
 *
 *   npm run paketle   →   dagitim/KADRO.exe
 *
 * Müşteriye hazır veriyle göndermek için (Ayarlar → Yedeği indir ile alınan .json):
 *   node paketle.mjs --veri "KADRO yedek.json" --cikti dagitim/musteri
 * Gömülen veri, exe o bilgisayarda ilk açıldığında ve sistem boşsa bir kez yüklenir.
 *
 * Sesli komut anahtarını gömmek için (müşteri Ayarlar'a anahtar girmez):
 *   node paketle.mjs --asistan-anahtari anahtar.txt [--veri ...] [--cikti ...]
 *
 * Paketli sürüm verileri Belgeler\KADRO altında tutar (bkz. server.js PAKETLI).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { rcedit } from "rcedit";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const INSA = path.join(BURASI, "insa");
const DAGITIM = path.join(BURASI, "dagitim");
const arg = (ad) => { const i = process.argv.indexOf(`--${ad}`); return i > 0 ? process.argv[i + 1] : null; };
const VERI = arg("veri") ? path.resolve(arg("veri")) : null;
// Sesli komut anahtarı (tek satırlık dosya). Gömülürse müşteri Ayarlar'a bir şey girmez; anahtar ekrana basılmaz.
const ANAHTAR = arg("asistan-anahtari") ? path.resolve(arg("asistan-anahtari")) : null;
if (ANAHTAR && !/^[A-Za-z0-9_-]{16,200}$/.test(fs.readFileSync(ANAHTAR, "utf8").trim())) throw new Error(`${ANAHTAR} geçerli bir asistan anahtarı değil.`);
if (ANAHTAR) console.log("Sesli komut anahtarı gömülecek.");
const CIKTI = arg("cikti") ? path.resolve(arg("cikti")) : DAGITIM;
const EXE = path.join(CIKTI, "KADRO.exe");
if (VERI) {
  const v = JSON.parse(fs.readFileSync(VERI, "utf8").replace(/^﻿/, ""));
  const icerik = v?.uygulama === "KADRO DMS" ? v.veri : v;
  if (!Array.isArray(icerik?.personel)) throw new Error(`${VERI} bir KADRO yedeği değil.`);
  if (icerik.ayarlar?.apiAnahtari) throw new Error("Yedekte API anahtarı var; müşteriye giden exe'ye gömülmez. Ayarlar → Yedeği indir ile alınan dosyayı kullanın.");
  if (icerik.ayarlar?.asistanAnahtari) throw new Error("Yedekte sesli komut anahtarı var; müşteriye giden exe'ye gömülmez. Ayarlar → Yedeği indir ile alınan dosyayı kullanın.");
  console.log(`Gömülecek veri: ${path.basename(VERI)} · ${icerik.personel.length} personel, ${icerik.proje?.length || 0} proje`);
}
const SURUM = JSON.parse(fs.readFileSync(path.join(BURASI, "package.json"), "utf8")).version;

fs.rmSync(INSA, { recursive: true, force: true });
fs.mkdirSync(INSA, { recursive: true });
fs.mkdirSync(DAGITIM, { recursive: true });
fs.mkdirSync(CIKTI, { recursive: true });

console.log("1/4  Sunucu tek dosyada birleştiriliyor...");
await esbuild.build({
  entryPoints: [path.join(BURASI, "server.js")],
  outfile: path.join(INSA, "server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  logLevel: "error",
});

console.log("2/4  Simge çiziliyor...");
const ico = path.join(INSA, "kadro.ico");
simgeUret(ico);

console.log("3/4  Node paketi hazırlanıyor...");
const yapilandirma = path.join(INSA, "sea-config.json");
const blob = path.join(INSA, "sea-prep.blob");
fs.writeFileSync(yapilandirma, JSON.stringify({
  main: path.join(INSA, "server.cjs"),
  output: blob,
  disableExperimentalSEAWarning: true,
  assets: {
    ...Object.fromEntries(["index.html", "app.js", "style.css"].map((ad) => [ad, path.join(BURASI, "public", ad)])),
    ...(VERI ? { "baslangic-verisi.json": VERI } : {}),
    ...(ANAHTAR ? { "asistan-anahtari.txt": ANAHTAR } : {}),
  },
}, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", yapilandirma], { stdio: "inherit" });

console.log("4/4  KADRO.exe yazılıyor...");
try {
  fs.copyFileSync(process.execPath, EXE);
} catch (e) {
  if (e.code !== "EBUSY" && e.code !== "EPERM") throw e;
  console.error("\nKADRO.exe şu an açık. Siyah pencereyi kapatıp `npm run paketle` komutunu tekrar çalıştırın.");
  process.exit(1);
}
await rcedit(EXE, {
  icon: ico,
  "file-version": SURUM,
  "product-version": SURUM,
  "version-string": {
    ProductName: "KADRO Belge Yönetim Sistemi",
    FileDescription: "KADRO Belge Yönetim Sistemi",
    CompanyName: "ACME Mühendislik",
    OriginalFilename: "KADRO.exe",
    InternalName: "KADRO",
    LegalCopyright: "",
  },
});
execFileSync(process.execPath, [
  path.join(BURASI, "node_modules", "postject", "dist", "cli.js"),
  EXE, "NODE_SEA_BLOB", blob,
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
], { stdio: ["ignore", "ignore", "inherit"] });

const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(0);
console.log(`\nHazır: ${EXE}  (${mb} MB)`);

/** Turuncu zemin üzerinde beyaz "E" — ICO içine 256px PNG gömülür. */
function simgeUret(hedef) {
  const png = path.join(INSA, "kadro.png");
  const ps = `
Add-Type -AssemblyName System.Drawing
$b = New-Object System.Drawing.Bitmap 256,256
$g = [System.Drawing.Graphics]::FromImage($b)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)
$yol = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 44; $yol.AddArc(0,0,$r,$r,180,90); $yol.AddArc(256-$r,0,$r,$r,270,90)
$yol.AddArc(256-$r,256-$r,$r,$r,0,90); $yol.AddArc(0,256-$r,$r,$r,90,90); $yol.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232,93,4))), $yol)
$f = New-Object System.Drawing.Font('Segoe UI', 150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
$g.DrawString('E', $f, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0,8,256,256), $sf)
$b.Save('${png.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });

  const veri = fs.readFileSync(png);
  const baslik = Buffer.alloc(22);
  baslik.writeUInt16LE(0, 0); baslik.writeUInt16LE(1, 2); baslik.writeUInt16LE(1, 4);
  baslik.writeUInt8(0, 6); baslik.writeUInt8(0, 7);            // 0 = 256px
  baslik.writeUInt16LE(1, 10); baslik.writeUInt16LE(32, 12);
  baslik.writeUInt32LE(veri.length, 14); baslik.writeUInt32LE(22, 18);
  fs.writeFileSync(hedef, Buffer.concat([baslik, veri]));
}
