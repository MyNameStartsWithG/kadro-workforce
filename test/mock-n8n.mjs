// Sahte n8n: /webhook/kadro/transcribe ve /webhook/kadro/assist ile aynı sözleşmeyi konuşur.
// "Model" kurallı: cümledeki anahtar kelimeye göre araç çağırır. Her istek gunluk.jsonl'e yazılır.
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.argv[2] || 4499);
const GUNLUK = process.argv[3] || "gunluk.jsonl";
const ANAHTAR = "test-anahtar";
fs.writeFileSync(GUNLUK, "");

const bugun = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
let sayac = 0;
const cagri = (name, args) => ({ id: `call_${++sayac}`, name, arguments: JSON.stringify(args) });

function model(body) {
  const sys = body.system || "";
  const kod = (ad) => sys.split("\n").find((l) => l.includes(ad))?.split(" | ")[0];
  const m = body.messages;
  const son = m.at(-1);
  if (son.role === "tool") {
    const araclar = [];
    for (let i = m.length - 1; i >= 0 && m[i].role === "tool"; i -= 1) araclar.unshift(m[i]);
    const hata = araclar.find((t) => t.content.startsWith("HATA"));
    if (hata) return { say: `Yapamadım: ${hata.content.slice(6)}` };
    const liste = araclar.find((t) => t.name === "odeme_listesi");
    if (liste) {
      const satir = liste.content.split("\n").find((l) => l.includes("Saatlik ücret") && l.includes("ödenmedi"));
      if (!satir) return { say: "Ödenmemiş saatlik ücret yok." };
      return { tool_calls: [cagri("odeme_isaretle", { anahtar: /anahtar=(\S+)/.exec(satir)[1], tutar: 300 })] };
    }
    return { say: `Bilgi: ${araclar.map((t) => t.content).join(" ").slice(0, 300)}` };
  }
  const u = son.content.toLocaleLowerCase("tr");
  const onceki = m.filter((x) => x.role === "assistant" && x.content).map((x) => x.content).join(" ");
  if (u.includes("ahet") && onceki.includes("Hangi Demir")) return { tool_calls: [cagri("puantaj_yaz", { degisiklikler: [{ personelKod: kod("Ahet Demir"), gun: bugun(), deger: "İ" }] })] };
  if (u.includes("demir")) return { say: "Hangi Demir? Ahet Demir mi, Volkan Demir mi?" };
  if (u.includes("gelmedi") && u.includes("çalıştı")) {
    return { tool_calls: [cagri("puantaj_yaz", { degisiklikler: [
      { personelKod: kod("Cem Polat"), gun: bugun(), deger: "–" },
      { personelKod: kod("Tolga Er"), gun: bugun(), deger: "10" },
    ] })] };
  }
  if (u.includes("uydurma")) return { tool_calls: [cagri("avans_ekle", { personelKod: "KDR-1999-9999", tutar: 10 })] };
  if (u.includes("eylül")) return { tool_calls: [cagri("puantaj_yaz", { degisiklikler: [{ personelKod: kod("Cem Polat"), gun: "2026-09-10", deger: "8" }] })] };
  if (u.includes("yakıt") && u.includes("ve")) {
    return { tool_calls: [
      cagri("kasa_ekle", { tur: "Gider", kategori: "Yakıt", tutar: 60, aciklama: "Araç yakıtı" }),
      cagri("avans_ekle", { personelKod: kod("Murat Aydın"), tutar: 50 }),
    ] };
  }
  if (u.includes("avans")) return { tool_calls: [cagri("avans_ekle", { personelKod: kod("Mehmet Kaya"), tutar: 100, paraBirimi: "EUR" })] };
  if (u.includes("ne alacak")) return { tool_calls: [cagri("kisi_ozeti", { personelKod: kod("Murat Aydın") })] };
  if (u.includes("ödendi")) return { tool_calls: [cagri("odeme_listesi", { personelKod: kod("Cem Polat"), ay: "2026-10" })] };
  if (u.includes("izinli")) return { tool_calls: [cagri("personel_guncelle", { personelKod: kod("Tolga Er"), durum: "İzinli" })] };
  if (u.includes("ekib")) return { tool_calls: [cagri("personel_guncelle", { personelKod: kod("Tolga Er"), ekip: "EKP-02" })] };
  if (u.includes("boş")) return { error_code: "model_empty", error: "The model returned an empty answer." };
  return { say: "Bunu ekrandan yapmalısınız." };
}

http.createServer(async (req, res) => {
  const parcalar = [];
  for await (const p of req) parcalar.push(p);
  const govde = Buffer.concat(parcalar);
  const yaz = (kod, v) => { res.writeHead(kod, { "Content-Type": "application/json" }); res.end(JSON.stringify(v)); };
  const kayit = { yol: req.url, anahtar: req.headers["x-api-key"] === ANAHTAR, boyut: govde.length };
  try {
    if (req.headers["x-api-key"] !== ANAHTAR) { fs.appendFileSync(GUNLUK, JSON.stringify(kayit) + "\n"); return yaz(403, { error: "The API key was rejected.", error_code: "bad_key" }); }
    if (req.url === "/webhook/kadro/transcribe") {
      const fd = await new Response(govde, { headers: { "content-type": req.headers["content-type"] } }).formData();
      const ses = fd.get("audio");
      const ham = (await ses.text()).trim();
      // Gerçek ses (tarayıcının sahte mikrofonu): ikili veri, sabit bir cümle döndür.
      const metin = ham.includes("�") ? "Murat bu ay ne alacak?" : ham;
      kayit.sesBoyutu = ses.size;
      Object.assign(kayit, { dosya: ses.name, tur: ses.type, dil: fd.get("language"), ipucu: fd.get("prompt"), metin });
      fs.appendFileSync(GUNLUK, JSON.stringify(kayit) + "\n");
      return yaz(200, metin ? { no_speech: false, transcript: metin, language: "turkish" } : { no_speech: true, transcript: "" });
    }
    if (req.url === "/webhook/kadro/assist") {
      const body = JSON.parse(govde.toString("utf8"));
      const cevap = model(body);
      if (!cevap.error_code) cevap.usage = { prompt_tokens: 3000, completion_tokens: 40, prompt_cache_hit_tokens: 2800 };
      Object.assign(kayit, { ham: govde.toString("utf8"), cevap });
      fs.appendFileSync(GUNLUK, JSON.stringify(kayit) + "\n");
      return yaz(200, cevap);
    }
    if (req.url === "/webhook/kadro/log") {
      // Gerçek akış gibi: kayitlar dizisi ister, satır sayısını döndürür. Alınanlar ayrı dosyaya.
      const body = JSON.parse(govde.toString("utf8"));
      if (!Array.isArray(body.kayitlar) || !body.kayitlar.length) return yaz(400, { error: "kayitlar bos" });
      if (process.env.MOCK_LOG_KAPALI) return yaz(503, { error: "gecici olarak kapali" });
      for (const k of body.kayitlar) fs.appendFileSync(GUNLUK.replace(/\.jsonl$/, "-kayit.jsonl"), JSON.stringify(k) + "\n");
      Object.assign(kayit, { adet: body.kayitlar.length });
      fs.appendFileSync(GUNLUK, JSON.stringify(kayit) + "\n");
      return yaz(200, { ok: true, adet: body.kayitlar.length });
    }
    yaz(404, { code: 404, message: "The requested webhook is not registered." });
  } catch (e) { yaz(500, { message: e.message }); }
}).listen(PORT, "127.0.0.1", () => console.log(`sahte n8n ${PORT}`));
