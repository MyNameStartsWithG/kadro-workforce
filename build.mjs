/**
 * Builds the single-file KADRO.exe that is sent to the client.
 * Nothing to install: Node.js, the server code and the UI are inside the exe.
 *
 *   npm run build   →   dist/KADRO.exe
 *
 * To ship it with data already in it (the .json from Settings → Download backup):
 *   node build.mjs --seed "Kadro backup.json" --out dist/client
 * The embedded data is loaded once, the first time the exe is opened on that computer and only if it is empty.
 *
 * To embed the voice-command key (the client does not enter a key in Settings):
 *   node build.mjs --assistant-key key.txt [--seed ...] [--out ...]
 *
 * The packaged version keeps its data under Documents\KADRO (see PACKAGED in server.js).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { rcedit } from "rcedit";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "build");
const DIST = path.join(HERE, "dist");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const SEED = arg("seed") ? path.resolve(arg("seed")) : null;
// Voice-command key (a one-line file). If embedded, the client enters nothing in Settings; the key is never printed.
const KEY = arg("assistant-key") ? path.resolve(arg("assistant-key")) : null;
if (KEY && !/^[A-Za-z0-9_-]{16,200}$/.test(fs.readFileSync(KEY, "utf8").trim())) throw new Error(`${KEY} is not a valid assistant key.`);
if (KEY) console.log("The voice-command key will be embedded.");
const OUT = arg("out") ? path.resolve(arg("out")) : DIST;
const EXE = path.join(OUT, "KADRO.exe");
if (SEED) {
  const v = JSON.parse(fs.readFileSync(SEED, "utf8").replace(/^﻿/, ""));
  const content = v?.app === "Kadro" ? v.data : v;
  if (!Array.isArray(content?.employees)) throw new Error(`${SEED} is not a Kadro backup.`);
  if (content.settings?.apiKey) throw new Error("The backup contains an API key; it is not embedded in an exe sent to a client. Use the file from Settings → Download backup.");
  if (content.settings?.assistantKey) throw new Error("The backup contains a voice-command key; it is not embedded in an exe sent to a client. Use the file from Settings → Download backup.");
  console.log(`Data to embed: ${path.basename(SEED)} · ${content.employees.length} employees, ${content.projects?.length || 0} projects`);
}
const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).version;

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

console.log("1/4  Bundling the server into one file...");
await esbuild.build({
  entryPoints: [path.join(HERE, "server.js")],
  outfile: path.join(BUILD, "server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  logLevel: "error",
});

console.log("2/4  Drawing the icon...");
const ico = path.join(BUILD, "kadro.ico");
makeIcon(ico);

console.log("3/4  Preparing the Node package...");
const config = path.join(BUILD, "sea-config.json");
const blob = path.join(BUILD, "sea-prep.blob");
fs.writeFileSync(config, JSON.stringify({
  main: path.join(BUILD, "server.cjs"),
  output: blob,
  disableExperimentalSEAWarning: true,
  assets: {
    ...Object.fromEntries(["index.html", "app.js", "style.css"].map((name) => [name, path.join(HERE, "public", name)])),
    ...(SEED ? { "seed-data.json": SEED } : {}),
    ...(KEY ? { "assistant-key.txt": KEY } : {}),
  },
}, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "inherit" });

console.log("4/4  Writing KADRO.exe...");
try {
  fs.copyFileSync(process.execPath, EXE);
} catch (e) {
  if (e.code !== "EBUSY" && e.code !== "EPERM") throw e;
  console.error("\nKADRO.exe is open right now. Close the black window and run `npm run build` again.");
  process.exit(1);
}
await rcedit(EXE, {
  icon: ico,
  "file-version": VERSION,
  "product-version": VERSION,
  "version-string": {
    ProductName: "Kadro — Workforce Management",
    FileDescription: "Kadro — Workforce Management",
    CompanyName: "ACME Engineering",
    OriginalFilename: "KADRO.exe",
    InternalName: "KADRO",
    LegalCopyright: "",
  },
});
execFileSync(process.execPath, [
  path.join(HERE, "node_modules", "postject", "dist", "cli.js"),
  EXE, "NODE_SEA_BLOB", blob,
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
], { stdio: ["ignore", "ignore", "inherit"] });

const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(0);
console.log(`\nReady: ${EXE}  (${mb} MB)`);

/** A white "K" on an orange background — a 256px PNG embedded in an ICO. */
function makeIcon(target) {
  const png = path.join(BUILD, "kadro.png");
  const ps = `
Add-Type -AssemblyName System.Drawing
$b = New-Object System.Drawing.Bitmap 256,256
$g = [System.Drawing.Graphics]::FromImage($b)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 44; $path.AddArc(0,0,$r,$r,180,90); $path.AddArc(256-$r,0,$r,$r,270,90)
$path.AddArc(256-$r,256-$r,$r,$r,0,90); $path.AddArc(0,256-$r,$r,$r,90,90); $path.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232,93,4))), $path)
$f = New-Object System.Drawing.Font('Segoe UI', 150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
$g.DrawString('K', $f, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0,8,256,256), $sf)
$b.Save('${png.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });

  const data = fs.readFileSync(png);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6); header.writeUInt8(0, 7);            // 0 = 256px
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(data.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(target, Buffer.concat([header, data]));
}
