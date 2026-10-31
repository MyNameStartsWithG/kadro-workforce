/* KADRO Belge Yönetim Sistemi — arayüz */

const ana = document.getElementById("ana");
const gezinti = document.getElementById("gezinti");

const S = { durum: null, uyarilar: [], hedefler: [], agac: null, acik: new Set(), secili: null };

/* ---------------- yardımcılar ---------------- */

const kacir = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstElementChild; };

async function api(yol, secenek = {}) {
  const y = await fetch(`/api${yol}`, {
    ...secenek,
    headers: secenek.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...(secenek.headers || {}) },
  });
  const metin = await y.text();
  let veri; try { veri = metin ? JSON.parse(metin) : {}; } catch { veri = { hata: metin.slice(0, 200) }; }
  if (!y.ok) throw new Error(veri.hata || `Sunucu hatası (${y.status})`);
  return veri;
}

let bildirimSayaci = 0;
function bildir(baslik, mesaj = "", tip = "") {
  const kutu = document.getElementById("bildirimler");
  const id = ++bildirimSayaci;
  const b = el(`<div class="bildirim ${tip}" data-b="${id}"><div><b>${kacir(baslik)}</b>${mesaj ? kacir(mesaj) : ""}</div></div>`);
  kutu.appendChild(b);
  setTimeout(() => b.remove(), tip === "hata" ? 8000 : 4200);
}
const hataBildir = (e) => bildir("İşlem tamamlanamadı", e.message || String(e), "hata");

function onay(baslik, mesaj, onayYazi = "Evet, devam et") {
  return new Promise((coz) => {
    const p = el(`<div class="pano"><div class="pano-ic">
      <div class="pano-bas"><h3>${kacir(baslik)}</h3></div>
      <div class="pano-govde">${kacir(mesaj)}</div>
      <div class="pano-alt"><button class="dg" data-h>Vazgeç</button><button class="dg bas" data-e>${kacir(onayYazi)}</button></div>
    </div></div>`);
    const kapat = (v) => { p.remove(); coz(v); };
    p.querySelector("[data-h]").onclick = () => kapat(false);
    p.querySelector("[data-e]").onclick = () => kapat(true);
    p.onclick = (ev) => { if (ev.target === p) kapat(false); };
    document.getElementById("panoAlani").appendChild(p);
    p.querySelector("[data-e]").focus();
  });
}

const boyutMetni = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

function gunFarki(tarih) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih || "")) return null;
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  return Math.round((new Date(tarih + "T00:00:00") - bugun) / 86400000);
}

/* ---------------- gezinti ---------------- */

const MENU = [
  { grup: "Genel" },
  { id: "panel", ad: "Panel", ik: "◆" },
  { id: "ongoru", ad: "Öngörü", ik: "◔" },
  { id: "agac", ad: "Klasör Ağacı", ik: "▤" },
  { id: "yukle", ad: "Belge Yükle", ik: "↑" },
  { grup: "Kayıtlar" },
  { id: "t/personel", ad: "Personel", ik: "◉", sayac: "personel" },
  { id: "t/kontrat", ad: "Çalışma Dönemleri", ik: "⇥", sayac: "kontrat" },
  { id: "t/ekip", ad: "Ekipler", ik: "◎", sayac: "ekip" },
  { id: "t/zimmet", ad: "Zimmet", ik: "▣", sayac: "zimmet" },
  { id: "t/proje", ad: "Projeler", ik: "◈", sayac: "proje" },
  { id: "t/ev", ad: "Evler", ik: "⌂", sayac: "ev" },
  { id: "t/arac", ad: "Araçlar", ik: "▤", sayac: "arac" },
  { id: "t/musteri", ad: "Müşteriler", ik: "◇", sayac: "musteri" },
  { grup: "Puantaj, Maaş ve Kasa" },
  { id: "puantaj", ad: "Puantaj", ik: "▥" },
  { id: "t/avans", ad: "Avanslar", ik: "↧", sayac: "avans" },
  { id: "odemeler", ad: "Ödemeler", ik: "✓", sayac: "odemeBekleyen", alarm: true },
  { id: "kasa", ad: "Kasa", ik: "₺" },
  { id: "istatistik", ad: "Çalışan İstatistikleri", ik: "▲" },
  { grup: "Kayıt Defteri" },
  { id: "t/belge", ad: "Belge Defteri", ik: "▦", sayac: "belge" },
  { id: "ayarlar", ad: "Ayarlar", ik: "⚙" },
];

function gezintiCiz() {
  let su = (location.hash || "#panel").slice(1);
  if (su.startsWith("d/")) su = `t/${su.split("/")[1]}`;
  if (su.startsWith("puantaj/")) su = "puantaj";
  if (su.startsWith("kasa/") || su === "t/kasa") su = "kasa";
  if (su.startsWith("odemeler/")) su = "odemeler";
  if (su.startsWith("calisan/")) su = "t/personel";
  gezinti.innerHTML = "";
  for (const m of MENU) {
    if (m.grup) { gezinti.appendChild(el(`<div class="nav-baslik">${kacir(m.grup)}</div>`)); continue; }
    const sayi = m.sayac ? S.durum?.sayilar?.[m.sayac] : null;
    const alarm = m.id === "panel" && S.uyarilar.length;
    const rz = alarm ? `<span class="rz alarm">${S.uyarilar.length}</span>`
      : (sayi ? `<span class="rz ${m.alarm ? "alarm" : ""}" ${m.alarm ? `title="Vadesi gelmiş, ödenmemiş kalem"` : ""}>${sayi}</span>` : "");
    const a = el(`<a class="nav-og ${su === m.id ? "aktif" : ""}" href="#${m.id}">
      <span class="ik">${m.ik}</span><span>${kacir(m.ad)}</span>${rz}</a>`);
    gezinti.appendChild(a);
  }
}

function ustBilgiCiz() {
  const d = S.durum;
  document.getElementById("markaAlt").textContent = d ? `sürüm ${d.surum} · port ${d.port}` : "";
  document.getElementById("kokYolu").textContent = d ? d.belgeKoku : "";
  const n = document.getElementById("aiDurum");
  n.className = `durum-nokta ${d?.apiAnahtariVar ? "acik" : "kapali"}`;
  n.querySelector("span").textContent = d?.apiAnahtariVar
    ? `yapay zekâ açık · ${{ karma: "karma", sadeceAi: "tam AI", sadeceKural: "kural" }[d.aiModu]}`
    : "yapay zekâ kapalı";
}

/* ---------------- PANEL ---------------- */

async function panelCiz() {
  const d = S.durum;
  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas">
    <div><h2>Panel</h2><p>Sistemin özeti, yaklaşan süreler ve hızlı işlemler.</p></div>
    <div class="bas-arac">
      <button class="dg" data-is="yenile">Yenile</button>
      <button class="dg bas" data-is="kur">Yapıyı Diske Kur</button>
    </div></div>`));

  if (!d.kurulu) {
    ana.appendChild(el(`<div class="kart"><div class="kart-govde">
      <div style="display:flex;gap:13px;align-items:flex-start">
        <span style="color:var(--accent);font-size:20px;line-height:1">!</span>
        <div style="min-width:0"><div style="font-weight:600;margin-bottom:3px">Klasör yapısı henüz diskte yok</div>
        <div style="color:var(--text-2);font-size:13px">
          "Yapıyı Diske Kur" düğmesine basınca <code style="font-family:var(--f-mono);font-size:12px;overflow-wrap:anywhere">${kacir(d.belgeKoku)}</code>
          altında tüm bölümler açılır. Var olan klasörlere dokunulmaz.</div></div>
      </div></div></div>`));
  }

  const s = d.sayilar;
  ana.appendChild(el(`<div class="izgara">
    <a class="sayac" href="#t/personel"><b>${s.personel}</b><span>Personel</span><span class="ek">15 klasörlü dosya</span></a>
    <a class="sayac" href="#t/ekip"><b>${s.ekip}</b><span>Aktif ekip</span><span class="ek">yemek ve zimmet</span></a>
    <a class="sayac" href="#t/zimmet"><b>${s.zimmet}</b><span>Açık zimmet</span><span class="ek">iade bekleyen</span></a>
    <a class="sayac" href="#t/proje"><b>${s.proje}</b><span>Aktif proje</span><span class="ek">devam eden iş</span></a>
    <a class="sayac" href="#t/ev"><b>${s.ev}</b><span>Ev</span><span class="ek">yurt dışı konaklama</span></a>
    <a class="sayac" href="#t/arac"><b>${s.arac}</b><span>Araç</span><span class="ek">muayene ve poliçe takibi</span></a>
    <a class="sayac" href="#t/musteri"><b>${s.musteri}</b><span>Müşteri</span><span class="ek">cari ve teklif</span></a>
    <a class="sayac" href="#t/belge"><b>${s.belge}</b><span>Kayıtlı belge</span><span class="ek">sisteme giren dosya</span></a>
  </div>`));

  const uyariKart = el(`<div class="kart">
    <div class="kart-bas"><h3>Süre Uyarıları</h3><div class="sag">
      <span style="font-family:var(--f-mono);font-size:10px;color:var(--muted)">${S.uyarilar.length} kayıt</span>
    </div></div><div id="uyariGovde"></div></div>`);
  ana.appendChild(uyariKart);

  const g = uyariKart.querySelector("#uyariGovde");
  if (!S.uyarilar.length) {
    g.appendChild(el(`<div class="bos"><div class="bs">Yaklaşan bir süre yok</div>
      <p>Çalışma izni, oturma izni, pasaport, araç muayenesi, poliçe ve çalışma dönemi (işten çıkış) bitişleri yaklaştığında burada listelenir.</p></div>`));
  } else {
    for (const u of S.uyarilar.slice(0, 40)) {
      const metin = u.kalan < 0 ? `${Math.abs(u.kalan)} gün geçti` : u.kalan === 0 ? "bugün" : `${u.kalan} gün kaldı`;
      const sat = el(`<a class="uyari-sat" href="${u.href || `#t/${u.tablo}`}">
        <span class="pul ${u.seviye}">${metin}</span>
        <span class="kim">${kacir(u.kim)}</span>
        <span class="ne">${kacir(u.alan)}</span>
        <span class="tr">${kacir(u.tarih)}</span></a>`);
      g.appendChild(sat);
    }
  }

  ana.appendChild(el(`<div class="kart">
    <div class="kart-bas"><h3>Nasıl Çalışır</h3></div>
    <div class="kart-govde" style="display:grid;gap:11px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
      ${[
        ["Kayıt gir", "Personel, araç, proje veya müşteri satırı eklediğinizde diskte klasörü şablonuyla birlikte otomatik açılır."],
        ["Belgeyi bırak", "Belge Yükle ekranına dosyayı sürükleyin. Sistem dosya adını ve PDF/görsel içeriğini okuyup hedef klasörü önerir."],
        ["Onayla", "Öneriyi kabul edin ya da hedefi değiştirin. Dosya gerçek klasöre taşınır, Belge Defteri'ne kaydedilir."],
        ["Excel'e aktar", "Her tablo tek tıkla .xlsx iner; Excel'de düzenleyip geri yükleyebilirsiniz."],
      ].map(([b, a]) => `<div><div style="font-family:var(--f-disp);font-weight:600;font-size:15px;margin-bottom:3px">${b}</div>
        <div style="color:var(--text-2);font-size:13px;line-height:1.5">${a}</div></div>`).join("")}
    </div></div>`));

  ana.querySelector('[data-is="yenile"]').onclick = async () => { await durumYukle(); yonlendir(); };
  ana.querySelector('[data-is="kur"]').onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const r = await api("/kur", { method: "POST" });
      bildir("Yapı kuruldu", `${r.acilan.length} klasör açıldı, ${r.mevcut} klasör zaten vardı.`, "iyi");
      await durumYukle(); yonlendir();
    } catch (e) { hataBildir(e); ev.target.disabled = false; }
  };
}

/* ---------------- KLASÖR AĞACI ---------------- */

async function agacCiz() {
  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas">
    <div><h2>Klasör Ağacı</h2><p>Diskteki gerçek durum. Sayılar o klasördeki dosya adedini gösterir.</p></div>
    <div class="bas-arac">
      <button class="dg" data-is="tumu">Tümünü aç</button>
      <button class="dg" data-is="yenile">Yenile</button>
      <button class="dg bas" data-is="kur">Yapıyı Kur</button>
    </div></div>`));

  const duzen = el(`<div class="agac-duzen">
    <div class="kart"><div class="kart-bas"><h3>Klasörler</h3>
      <div class="sag"><span id="toplamDosya" style="font-family:var(--f-mono);font-size:10px;color:var(--muted)"></span></div></div>
      <div class="agac" id="agacKok"></div></div>
    <div class="kart"><div class="kart-govde" id="agacDetay"></div></div>
  </div>`);
  ana.appendChild(duzen);

  ana.querySelector('[data-is="yenile"]').onclick = () => { S.agac = null; agacCiz(); };
  ana.querySelector('[data-is="kur"]').onclick = async () => {
    try { const r = await api("/kur", { method: "POST" });
      bildir("Yapı kuruldu", `${r.acilan.length} klasör açıldı.`, "iyi");
      S.agac = null; agacCiz();
    } catch (e) { hataBildir(e); }
  };
  ana.querySelector('[data-is="tumu"]').onclick = (ev) => {
    const ac = S.acik.size < 6;
    S.acik.clear();
    if (ac) (function gez(l) { for (const d of l) if (d.ch?.length) { S.acik.add(d.yol); gez(d.ch); } })(S.agac?.ch || []);
    ev.target.textContent = ac ? "Tümünü kapat" : "Tümünü aç";
    agacGovdeCiz();
  };

  if (!S.agac) {
    document.getElementById("agacKok").innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;
    try { S.agac = await api("/agac"); } catch (e) { hataBildir(e); return; }
  }
  agacGovdeCiz();
}

function agacGovdeCiz() {
  const kok = document.getElementById("agacKok");
  if (!kok) return;
  const a = S.agac;
  document.getElementById("toplamDosya").textContent = a.kurulmamis ? "" : `${a.toplamDosya} dosya`;

  if (a.kurulmamis || !a.ch.length) {
    kok.innerHTML = `<div class="bos"><div class="bs">Yapı diskte yok</div>
      <p>Yukarıdaki "Yapıyı Kur" düğmesine basın; tüm bölümler tek seferde açılsın.</p></div>`;
    document.getElementById("agacDetay").innerHTML = "";
    return;
  }

  const liste = (dugumler) => {
    const ul = document.createElement("ul");
    for (const d of dugumler) {
      const li = document.createElement("li");
      const acik = S.acik.has(d.yol);
      const m = /^(\d{2}|KDR-\d{4}-\d{4}|PRJ-\d{4}-\d{4}|MST-\d{4}-\d{4}|EV-\d+)[ -]+(.*)$/.exec(d.ad);
      const derinlik = d.yol.split("/").length - 1;
      const sat = el(`<button class="d-sat k${derinlik} ${S.secili === d.yol ? "sec" : ""}" data-yol="${kacir(d.yol)}">
        <span class="ok ${d.ch.length ? (acik ? "acik" : "") : "yaprak"}">▶</span>
        ${m ? `<span class="kod">${kacir(m[1])}</span><span class="ad">${kacir(m[2])}</span>` : `<span class="ad">${kacir(d.ad)}</span>`}
        <span class="adet ${d.toplamDosya ? "dolu" : ""}">${d.toplamDosya || ""}</span></button>`);
      li.appendChild(sat);
      if (d.ch.length && acik) li.appendChild(liste(d.ch));
      ul.appendChild(li);
    }
    return ul;
  };

  kok.innerHTML = "";
  kok.appendChild(liste(a.ch));

  kok.onclick = (ev) => {
    const sat = ev.target.closest(".d-sat");
    if (!sat) return;
    const yol = sat.dataset.yol;
    const bul = (l) => { for (const d of l) { if (d.yol === yol) return d; const r = bul(d.ch || []); if (r) return r; } return null; };
    const dugum = bul(a.ch);
    if (ev.target.closest(".ok") && dugum?.ch.length) {
      S.acik.has(yol) ? S.acik.delete(yol) : S.acik.add(yol);
    } else {
      if (S.secili === yol && dugum?.ch.length) { S.acik.has(yol) ? S.acik.delete(yol) : S.acik.add(yol); }
      S.secili = yol;
      if (dugum?.ch.length) S.acik.add(yol);
    }
    agacGovdeCiz();
    if (dugum) agacDetayCiz(dugum);
  };

  if (S.secili) {
    const bul = (l) => { for (const d of l) { if (d.yol === S.secili) return d; const r = bul(d.ch || []); if (r) return r; } return null; };
    const d = bul(a.ch);
    if (d) agacDetayCiz(d);
    else document.getElementById("agacDetay").innerHTML = `<div class="bos"><div class="bs">Klasör artık yok</div><p>Soldan başka bir klasör seçin.</p></div>`;
  } else {
    document.getElementById("agacDetay").innerHTML =
      `<div class="bos"><div class="bs">Bir klasör seçin</div><p>Seçtiğiniz klasörün açıklamasını, kurallarını ve içindeki dosyaları burada görürsünüz.</p></div>`;
  }
}

function agacDetayCiz(d) {
  const hedef = document.getElementById("agacDetay");
  if (!hedef) return;
  const parcalar = d.yol.split("/");
  hedef.innerHTML = "";
  hedef.appendChild(el(`<div style="font-family:var(--f-mono);font-size:11px;color:var(--muted);margin-bottom:9px">
    ${parcalar.map((p, i) => `${i ? '<span style="opacity:.5"> \\ </span>' : ""}${kacir(p)}`).join("")}</div>`));
  hedef.appendChild(el(`<h3 style="font-family:var(--f-disp);font-size:26px;font-weight:700;margin:0;letter-spacing:-.01em">${kacir(d.ad)}</h3>`));
  if (d.d) hedef.appendChild(el(`<p style="margin:9px 0 0;color:var(--text-2);max-width:64ch;font-size:14.5px;line-height:1.55">${kacir(d.d)}</p>`));
  if (d.not) hedef.appendChild(el(`<div style="margin-top:12px;padding:10px 13px;background:var(--accent-wash);border-left:2px solid var(--accent);border-radius:0 3px 3px 0;font-size:13px;color:var(--text-2);max-width:64ch">${kacir(d.not)}</div>`));
  const silinen = d.yol.split("/")[0] === SILINENLER;
  if (silinen) hedef.appendChild(el(`<div class="o-not" style="margin-top:12px;max-width:64ch">Silinen belgeler burada, asıl klasör yapısıyla durur.
    "Geri yükle" dosyayı eski yerine koyar. "Kalıcı sil" diskten tamamen siler; geri alınamaz.</div>`));

  const yolCubugu = el(`<div class="yol-cubugu"><code>${kacir(d.yol)}</code>
    <button class="dg ufak" data-kopyala>Kopyala</button>
    <button class="dg ufak" data-ac>Klasörü aç</button></div>`);
  hedef.appendChild(yolCubugu);
  yolCubugu.querySelector("[data-kopyala]").onclick = (ev) => {
    navigator.clipboard.writeText(d.yol).then(() => { ev.target.textContent = "Kopyalandı"; setTimeout(() => ev.target.textContent = "Kopyala", 1500); });
  };
  yolCubugu.querySelector("[data-ac]").onclick = async () => {
    try { await api("/klasor-ac", { method: "POST", body: JSON.stringify({ yol: d.yol }) }); }
    catch (e) { hataBildir(e); }
  };

  hedef.appendChild(el(`<div style="display:flex;align-items:center;gap:11px;margin:22px 0 10px">
    <h4 style="font-family:var(--f-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0;font-weight:600">Bu klasördeki dosyalar</h4>
    <div style="flex:1;height:1px;background:var(--line)"></div>
    <span style="font-family:var(--f-mono);font-size:10px;color:var(--accent);font-weight:600">${String(d.dosyaSayisi).padStart(2, "0")}</span></div>`));

  if (!d.dosyalar.length) {
    hedef.appendChild(el(`<div style="padding:14px 0;color:var(--muted);font-size:13.5px">Bu klasör henüz boş.${d.ch.length ? ` ${d.ch.length} alt klasörü var.` : ""}</div>`));
  } else {
    const kutu = el(`<div style="border:1px solid var(--line);border-radius:3px;overflow:hidden"></div>`);
    for (const f of d.dosyalar) {
      const uz = (f.ad.split(".").pop() || "").slice(0, 4);
      const sat = el(`<div class="dosya-sat"><span class="uz">${kacir(uz)}</span>
        <span class="nm" title="${kacir(f.ad)}">${kacir(f.ad)}</span>
        <span class="mt">${boyutMetni(f.boyut)} · ${new Date(f.tarih).toLocaleDateString("tr-TR")}</span>
        ${silinen
          ? `<button class="dg ufak" data-geri>Geri yükle</button><button class="dg ufak tehlike" data-kalici>Kalıcı sil</button>`
          : `<button class="dg ufak tehlike" data-sil title="Silinenler klasörüne taşır">Sil</button>`}</div>`);
      sat.querySelector("[data-sil]")?.addEventListener("click", () => belgeIslem("sil", d, f.ad));
      sat.querySelector("[data-geri]")?.addEventListener("click", () => belgeIslem("geri", d, f.ad));
      sat.querySelector("[data-kalici]")?.addEventListener("click", () => belgeIslem("kalici-sil", d, f.ad));
      kutu.appendChild(sat);
    }
    hedef.appendChild(kutu);
  }
}

const SILINENLER = "_Silinenler";

/** Klasör ağacında dosya silme (Silinenler'e taşıma), geri yükleme ve kalıcı silme. */
async function belgeIslem(is, d, ad) {
  const metin = {
    sil: ["Belge silinsin mi?", `"${ad}" Silinenler klasörüne taşınır ve Belge Defteri'ne "silindi" notu düşülür. Gerekirse oradan geri yükleyebilirsiniz.`, "Sil"],
    geri: ["Belge geri yüklensin mi?", `"${ad}" eski yerine, ${d.yol.split("/").slice(1).join(" \ ") || "belge köküne"} klasörüne geri konur.`, "Geri yükle"],
    "kalici-sil": ["Kalıcı olarak silinsin mi?", `"${ad}" diskten tamamen silinir. Bu işlem geri alınamaz.`, "Kalıcı sil"],
  }[is];
  if (!(await onay(...metin))) return;
  try {
    const r = await api(`/belge/${is}`, { method: "POST", body: JSON.stringify({ klasor: d.yol, ad }) });
    bildir({ sil: "Belge silindi", geri: "Belge geri yüklendi", "kalici-sil": "Belge kalıcı silindi" }[is],
      is === "sil" ? "Silinenler klasörüne taşındı." : is === "geri" ? r.yol : "", "iyi");
    S.agac = await api("/agac");
    await durumYukle(); gezintiCiz();
    agacGovdeCiz();
  } catch (e) { hataBildir(e); }
}

/* ---------------- BELGE YÜKLE ---------------- */

async function yukleCiz() {
  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas">
    <div><h2>Belge Yükle</h2><p>Dosyaları bırakın; sistem hangi klasöre ait olduklarını bulup önersin. Onaylayana kadar hiçbir şey taşınmaz.</p></div>
  </div>`));

  const modAd = { karma: "Kural + yapay zekâ", sadeceAi: "Sadece yapay zekâ", sadeceKural: "Sadece kural" }[S.durum.aiModu];
  const uyari = !S.durum.apiAnahtariVar && S.durum.aiModu !== "sadeceKural"
    ? `<div class="o-not" style="margin-bottom:12px">API anahtarı girilmediği için yapay zekâ katmanı çalışmıyor; sadece dosya adı kuralları uygulanıyor.
       <a href="#ayarlar">Ayarlar</a> ekranından anahtarı girebilirsiniz.</div>` : "";
  if (uyari) ana.appendChild(el(uyari));

  const birak = el(`<button class="birak" id="birakAlani">
    <div class="ikon">↓</div>
    <div class="bs">Dosyayı sürükle bırak</div>
    <div class="ac">ya da tıklayıp bilgisayarınızdan seçin — aynı anda 30 dosyaya kadar</div>
    <div class="tur">Aktif mod: ${kacir(modAd)} · PDF ve görseller içeriğinden okunur</div>
  </button>`);
  ana.appendChild(birak);

  const girdi = el(`<input type="file" multiple hidden>`);
  ana.appendChild(girdi);
  const sonucAlani = el(`<div id="sonucAlani"></div>`);
  ana.appendChild(sonucAlani);

  birak.onclick = () => girdi.click();
  girdi.onchange = () => { if (girdi.files.length) dosyaGonder([...girdi.files]); girdi.value = ""; };
  for (const olay of ["dragenter", "dragover"]) birak.addEventListener(olay, (e) => { e.preventDefault(); birak.classList.add("uzerinde"); });
  for (const olay of ["dragleave", "drop"]) birak.addEventListener(olay, (e) => { e.preventDefault(); birak.classList.remove("uzerinde"); });
  birak.addEventListener("drop", (e) => { const f = [...(e.dataTransfer?.files || [])]; if (f.length) dosyaGonder(f); });

  if (!S.hedefler.length) { try { S.hedefler = await api("/hedefler"); } catch { /* yoksay */ } }
}

async function dosyaGonder(dosyalar) {
  const alan = document.getElementById("sonucAlani");
  const bekle = el(`<div class="kart" style="margin-top:14px"><div class="kart-govde" style="display:flex;gap:11px;align-items:center">
    <span class="yukleniyor"></span><span>${dosyalar.length} dosya inceleniyor… PDF içerikleri okunduğu için birkaç saniye sürebilir.</span></div></div>`);
  alan.prepend(bekle);

  const fd = new FormData();
  for (const f of dosyalar) fd.append("dosyalar", f);
  try {
    const { sonuclar } = await api("/yukle", { method: "POST", body: fd });
    bekle.remove();
    if (!S.hedefler.length) S.hedefler = await api("/hedefler");
    for (const s of sonuclar.reverse()) alan.prepend(oneriKarti(s));
  } catch (e) { bekle.remove(); hataBildir(e); }
}

function hedefSecenekleri(secili) {
  const gruplar = new Map();
  for (const h of S.hedefler) {
    const ust = h.yol.split("/")[0];
    if (!gruplar.has(ust)) gruplar.set(ust, []);
    gruplar.get(ust).push(h);
  }
  let out = `<option value="">— klasör seçin —</option>`;
  for (const [ust, liste] of gruplar) {
    out += `<optgroup label="${kacir(ust)}">`;
    for (const h of liste) {
      const etiket = h.yol.split("/").slice(1).join(" / ") || h.yol;
      out += `<option value="${kacir(h.yol)}" ${h.yol === secili ? "selected" : ""}>${kacir(etiket)}</option>`;
    }
    out += `</optgroup>`;
  }
  return out;
}

function oneriKarti(s) {
  if (s.hata) {
    return el(`<div class="oneri" style="margin-top:14px"><div class="o-bas">
      <span class="dn">${kacir(s.dosyaAdi)}</span><span class="rozet yok">hata</span></div>
      <div class="o-govde"><div class="o-not">${kacir(s.hata)}</div></div></div>`);
  }

  const yzd = Math.round((s.guven || 0) * 100);
  const sinif = yzd >= 70 ? "" : yzd >= 45 ? "dusuk" : "cok-dusuk";
  const rozet = s.yontem === "claude" ? `<span class="rozet ai">yapay zekâ</span>`
    : s.yontem === "kural" ? `<span class="rozet kural">kural</span>`
    : `<span class="rozet yok">bulunamadı</span>`;

  const k = el(`<div class="oneri" style="margin-top:14px" data-fis="${kacir(s.fis)}">
    <div class="o-bas">
      <span class="dn">${kacir(s.dosyaAdi)}</span>
      <span style="font-family:var(--f-mono);font-size:11px;color:var(--muted)">${boyutMetni(s.boyut || 0)}</span>
      ${rozet}
      <span class="guven"><span class="cubuk"><i class="${sinif}" style="width:${yzd}%"></i></span><span class="yzd">%${yzd}</span></span>
    </div>
    <div class="o-govde">
      ${s.gerekce ? `<div class="o-gerekce">${kacir(s.gerekce)}</div>` : ""}
      ${(s.notlar || []).map((n) => `<div class="o-not">${kacir(n)}</div>`).join("")}
      <div class="ikili">
        <div class="alan"><label>Hedef klasör</label>
          <select data-hedef>${hedefSecenekleri(s.hedefYol)}</select></div>
        <div class="alan"><label>Kaydedilecek dosya adı</label>
          <input class="mono" data-ad value="${kacir(s.onerilenAd || s.dosyaAdi)}"></div>
      </div>
      <div class="o-arac">
        <button class="dg bas" data-onayla>Klasöre yerleştir</button>
        <button class="dg tehlike" data-iptal>Vazgeç</button>
        ${s.ai?.okundu && s.ai.okundu !== "yok" ? `<span style="font-family:var(--f-mono);font-size:10px;color:var(--muted);align-self:center">
          belge içeriği okundu (${kacir({ pdf: "PDF", gorsel: "görsel", metin: "metin" }[s.ai.okundu])})</span>` : ""}
      </div>
    </div></div>`);

  const secim = k.querySelector("[data-hedef]");
  const adGirdi = k.querySelector("[data-ad]");

  secim.onchange = async () => {
    try {
      const r = await api("/ad-oner", { method: "POST", body: JSON.stringify({ dosyaAdi: s.dosyaAdi, hedefYol: secim.value }) });
      adGirdi.value = r.ad;
    } catch { /* önemsiz */ }
  };

  k.querySelector("[data-onayla]").onclick = async (ev) => {
    if (!secim.value) return bildir("Hedef seçilmedi", "Önce bir klasör seçin.", "hata");
    ev.target.disabled = true;
    try {
      const elleMi = secim.value !== s.hedefYol;
      const r = await api("/yerlestir", {
        method: "POST",
        body: JSON.stringify({
          fis: s.fis, hedefYol: secim.value, dosyaAdi: adGirdi.value,
          belgeTuru: s.belgeTuru, ilgili: s.ilgili,
          yontem: elleMi ? "elle" : s.yontem, guven: elleMi ? null : s.guven,
        }),
      });
      k.replaceWith(el(`<div class="oneri" style="margin-top:14px"><div class="o-bas">
        <span class="dn">${kacir(r.yerlesen.ad)}</span><span class="rozet kural" style="background:var(--iyi);color:#fff">yerleştirildi</span></div>
        <div class="o-govde"><div class="o-gerekce" style="font-family:var(--f-mono);font-size:12px">${kacir(r.yerlesen.yol)}</div></div></div>`));
      bildir("Belge yerleştirildi", r.yerlesen.yol, "iyi");
      S.agac = null;
      await durumYukle(); gezintiCiz();
    } catch (e) { hataBildir(e); ev.target.disabled = false; }
  };

  k.querySelector("[data-iptal]").onclick = async () => {
    try { await api("/iptal", { method: "POST", body: JSON.stringify({ fis: s.fis }) }); } catch { /* yoksay */ }
    k.remove();
  };
  return k;
}

/* ---------------- TABLOLAR ---------------- */

const tabloDurum = {};

async function tabloCiz(tabloAdi) {
  ana.innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;
  let veri;
  try { veri = await api(`/tablo/${tabloAdi}`); } catch (e) { hataBildir(e); return; }
  const { tanim, satirlar } = veri;
  tabloDurum[tabloAdi] = { tanim, satirlar, filtre: tabloDurum[tabloAdi]?.filtre || "" };

  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas">
    <div><h2>${kacir(tanim.ad)}</h2><p>${kacir(tanim.aciklama)}</p></div>
    <div class="bas-arac">
      <button class="dg" data-is="excel-in">Excel'e aktar</button>
      ${tanim.saltOkunur ? "" : `<button class="dg" data-is="excel-yuk">Excel'den yükle</button>
      <button class="dg bas" data-is="ekle">+ Yeni ${kacir(tanim.tekil)}</button>`}
    </div></div>`));

  const arac = el(`<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
    <div class="ara-kutu"><input placeholder="Tabloda ara…" value="${kacir(tabloDurum[tabloAdi].filtre)}"></div>
    <span id="satirSayi" style="font-family:var(--f-mono);font-size:11px;color:var(--muted)"></span>
    ${tanim.saltOkunur ? "" : `<span style="font-family:var(--f-mono);font-size:10.5px;color:var(--muted);margin-left:auto">
      Hücreyi düzenleyip başka yere tıklayın — kayıt anında saklanır.</span>`}
  </div>`);
  ana.appendChild(arac);

  const sar = el(`<div class="tablo-sar"><table class="gr"><thead></thead><tbody></tbody></table></div>`);
  ana.appendChild(sar);

  const excelGirdi = el(`<input type="file" accept=".xlsx" hidden>`);
  ana.appendChild(excelGirdi);

  ana.querySelector('[data-is="excel-in"]').onclick = () => { location.href = `/api/tablo/${tabloAdi}/excel`; };
  if (!tanim.saltOkunur) {
    ana.querySelector('[data-is="excel-yuk"]').onclick = () => excelGirdi.click();
    ana.querySelector('[data-is="ekle"]').onclick = () => {
      tabloDurum[tabloAdi].satirlar.unshift({ _id: null, _yeni: true });
      gridCiz(tabloAdi);
      sar.querySelector("tbody tr input:not([disabled])")?.focus();
    };
    excelGirdi.onchange = async () => {
      if (!excelGirdi.files[0]) return;
      const fd = new FormData(); fd.append("dosya", excelGirdi.files[0]);
      try {
        const r = await api(`/tablo/${tabloAdi}/excel`, { method: "POST", body: fd });
        bildir("Excel içe aktarıldı",
          `${r.eklenen} yeni, ${r.guncellenen} güncellendi${r.atlanan.length ? `, ${r.atlanan.length} satır atlandı` : ""}.`, "iyi");
        if (r.atlanan.length) console.warn("Atlanan satırlar:", r.atlanan);
        await durumYukle(); gezintiCiz(); tabloCiz(tabloAdi);
      } catch (e) { hataBildir(e); }
      excelGirdi.value = "";
    };
  }

  arac.querySelector("input").oninput = (ev) => { tabloDurum[tabloAdi].filtre = ev.target.value; gridCiz(tabloAdi); };
  gridCiz(tabloAdi);
}

function gridCiz(tabloAdi) {
  const { tanim, satirlar, filtre } = tabloDurum[tabloAdi];
  const tablo = ana.querySelector("table.gr");
  const bas = tablo.querySelector("thead");
  const govde = tablo.querySelector("tbody");

  bas.innerHTML = `<tr>${tanim.detay ? `<th class="detay-s"></th>` : ""}${tanim.kolon.map((k) => `<th style="min-width:${k.gen}px">${kacir(k.b)}</th>`).join("")}${tanim.saltOkunur ? "" : `<th class="sil-s"></th>`}</tr>`;

  const q = filtre.trim().toLocaleLowerCase("tr");
  const gorunen = q
    ? satirlar.filter((s) => s._yeni || tanim.kolon.some((k) => String(s[k.k] || "").toLocaleLowerCase("tr").includes(q)))
    : satirlar;
  ana.querySelector("#satirSayi").textContent = `${gorunen.length} / ${satirlar.length} kayıt`;

  govde.innerHTML = "";
  if (!gorunen.length) {
    govde.innerHTML = `<tr><td colspan="${tanim.kolon.length + 2}"><div class="bos">
      <div class="bs">${q ? "Eşleşen kayıt yok" : "Henüz kayıt yok"}</div>
      <p>${q ? "Aramayı değiştirip tekrar deneyin." : tanim.saltOkunur ? "Belge yükledikçe bu defter kendiliğinden dolar." : `Sağ üstteki "+ Yeni ${kacir(tanim.tekil)}" ile ilk kaydı ekleyin.`}</p>
    </div></td></tr>`;
    return;
  }

  for (const satir of gorunen) {
    const tr = document.createElement("tr");
    if (satir._yeni) tr.className = "yeni";
    if (satir.kaynak && satir.kaynak !== "Elle") tr.classList.add("oto");
    tr.dataset.id = satir._id || "";

    if (tanim.detay) {
      const td = document.createElement("td");
      td.className = "detay-h";
      td.innerHTML = satir._id ? `<a href="#d/${tabloAdi}/${satir._id}" title="Ayrıntı sayfası">↗</a>` : "";
      tr.appendChild(td);
    }

    for (const k of tanim.kolon) {
      const td = document.createElement("td");
      const deger = satir[k.k] ?? "";
      if (k.tur === "salt") {
        td.className = `salt ${k.k === "kod" ? "kod" : ""} ${k.hesap ? "hesap" : ""}`;
        if (k.pul && deger) td.innerHTML = pulHtml(deger, satir);
        else td.textContent = deger || (satir._yeni && k.k === "kod" ? "otomatik" : "—");
      } else if (k.tur === "secim") {
        td.innerHTML = `<select data-k="${k.k}"><option value=""></option>${k.secenek.map((o) =>
          `<option ${o === deger ? "selected" : ""}>${kacir(o)}</option>`).join("")}</select>`;
      } else if (k.tur === "baglanti") {
        td.innerHTML = `<select data-k="${k.k}">${baglantiSecenekleri(k.kaynak, deger)}</select>`;
      } else {
        const tip = k.tur === "tarih" ? "date" : (k.tur === "sayi" || k.tur === "para") ? "number" : "text";
        td.innerHTML = `<input type="${tip}" data-k="${k.k}" value="${kacir(deger)}" ${k.tur === "para" ? 'step="0.01"' : ""}>`;
        if (k.uyari) {
          const kalan = gunFarki(deger);
          if (kalan !== null && kalan <= 0) td.classList.add("tehlike");
          else if (kalan !== null && kalan <= k.uyari) td.classList.add("dikkat");
        }
      }
      tr.appendChild(td);
    }

    if (!tanim.saltOkunur) {
      const td = document.createElement("td");
      td.innerHTML = `<button class="sat-sil" title="Satırı sil">×</button>`;
      td.querySelector("button").onclick = () => satirSil(tabloAdi, satir, tr);
      tr.appendChild(td);
    }
    govde.appendChild(tr);
  }

  if (tanim.saltOkunur || govde.dataset.bagli) return;

  // Dinleyiciler tbody'ye BİR KEZ bağlanır. gridCiz her çağrıldığında yeniden
  // bağlanırsa aynı satır için kaydetme birden çok kez tetiklenir.
  govde.dataset.bagli = "1";
  govde.addEventListener("input", (ev) => {
    const tr = ev.target.closest("tr");
    if (tr) tr.classList.add("kirli");
  });
  govde.addEventListener("focusout", (ev) => {
    const tr = ev.target.closest("tr");
    if (!tr || !tr.classList.contains("kirli")) return;
    // Odak hâlâ aynı satırdaysa kaydetme.
    setTimeout(() => { if (!tr.contains(document.activeElement)) satirKaydet(tabloAdi, tr); }, 0);
  });
}

/** Durum sütunu (ör. kasa: Otomatik / Elle düzeltildi) renkli etiket olarak çizilir. */
function pulHtml(deger, satir) {
  const geri = deger === "Elle düzeltildi";
  const ipucu = geri ? `Sistemin hesabı: ${satir.sistemTutar || "—"}. Tıklayınca sistemin hesabına geri döner.` : "";
  const sinif = { "Otomatik": "otomatik", "Elle düzeltildi": "duzeltildi geri", "Elle girildi": "elle" }[deger] || "";
  return `<span class="pul-d ${sinif}"
    ${geri ? `data-geri="${kacir(satir._id)}" title="${kacir(ipucu)}"` : ""}>${kacir(deger)}</span>`;
}

/** Kaydedilen satırın salt-okunur hücrelerini yerinde tazeler (odağı bozmadan). */
function satirTazele(tabloAdi, tr, satir) {
  const { tanim } = tabloDurum[tabloAdi];
  const kayma = tanim.detay ? 1 : 0;
  if (kayma && satir._id) tr.children[0].innerHTML = `<a href="#d/${tabloAdi}/${satir._id}" title="Ayrıntı sayfası">↗</a>`;
  tanim.kolon.forEach((k, i) => {
    const td = tr.children[i + kayma];
    if (!td) return;
    if (k.tur === "salt") {
      if (k.pul && satir[k.k]) td.innerHTML = pulHtml(satir[k.k], satir); else td.textContent = satir[k.k] || "—";
    }
    if (k.uyari) {
      const kalan = gunFarki(satir[k.k]);
      td.classList.toggle("tehlike", kalan !== null && kalan <= 0);
      td.classList.toggle("dikkat", kalan !== null && kalan > 0 && kalan <= k.uyari);
    }
  });
}

async function satirKaydet(tabloAdi, tr) {
  const { tanim, satirlar } = tabloDurum[tabloAdi];
  const id = tr.dataset.id;
  const satir = id ? satirlar.find((s) => s._id === id) : satirlar.find((s) => s._yeni);
  if (!satir) return;

  const gelen = {};
  for (const alan of tr.querySelectorAll("[data-k]")) gelen[alan.dataset.k] = alan.value;

  const eksik = tanim.kolon.find((k) => k.zorunlu && !String(gelen[k.k] || "").trim());
  if (eksik) {
    if (satir._yeni && Object.values(gelen).every((v) => !String(v).trim())) return; // boş yeni satır: sessizce bırak
    tr.classList.remove("kirli");
    return bildir("Eksik alan", `"${eksik.b}" doldurulmadan kaydedilemez.`, "hata");
  }

  try {
    const y = satir._yeni
      ? await api(`/tablo/${tabloAdi}`, { method: "POST", body: JSON.stringify(gelen) })
      : await api(`/tablo/${tabloAdi}/${id}`, { method: "PUT", body: JSON.stringify(gelen) });

    Object.assign(satir, y.satir);
    delete satir._yeni;
    tr.classList.remove("kirli", "yeni");
    tr.dataset.id = y.satir._id;
    // Tabloyu baştan çizmek yerine hücreleri yerinde tazeliyoruz; aksi hâlde
    // kullanıcı bir sonraki satıra geçerken odağı kaybediyor.
    satirTazele(tabloAdi, tr, y.satir);

    if (y.uyari) {
      bildir("Kaydedildi, ama dikkat", y.uyari, "hata");
    } else if (y.klasorRaporu?.acilan?.length) {
      bildir("Kayıt eklendi", `${y.klasorYolu} klasörü ${y.klasorRaporu.acilan.length} alt klasörle açıldı.`, "iyi");
      S.agac = null;
    } else if (y.adDegisikligi) {
      bildir("Klasör yeniden adlandırıldı", `${y.adDegisikligi.eski} → ${y.adDegisikligi.yeni}`, "iyi");
      S.agac = null;
    } else {
      bildir("Kaydedildi", "", "iyi");
    }
    S.hedefler = [];
    await durumYukle(); gezintiCiz();
    tabloDurum[tabloAdi].kaydedilince?.();
  } catch (e) {
    hataBildir(e);
    tr.classList.add("kirli");
  }
}

async function satirSil(tabloAdi, satir, tr) {
  const { tanim, satirlar } = tabloDurum[tabloAdi];
  if (satir._yeni) {
    satirlar.splice(satirlar.indexOf(satir), 1);
    return gridCiz(tabloAdi);
  }
  const etiket = satir.ad || satir.plaka || satir.kod || satir.aciklama || satir.demirbas || "bu kayıt";
  const mesaj = tanim.klasorTuru
    ? `"${etiket}" tablodan silinecek. Diskteki klasör ve içindeki belgeler SİLİNMEZ, oldukları yerde kalır.`
    : satir.kaynak && satir.kaynak !== "Elle"
      ? `"${etiket}" sistemin yazdığı bir satır. Silerseniz sistem bunu bir daha yazmaz (Kasa ekranından geri getirilebilir).`
      : `"${etiket}" silinecek.`;
  const ok = await onay("Kayıt silinsin mi?", mesaj, "Sil");
  if (!ok) return;
  try {
    const y = await api(`/tablo/${tabloAdi}/${satir._id}`, { method: "DELETE" });
    satirlar.splice(satirlar.indexOf(satir), 1);
    tr.remove();
    bildir("Kayıt silindi", y.uyari || "", "iyi");
    S.hedefler = [];
    await durumYukle(); gezintiCiz(); gridCiz(tabloAdi);
    tabloDurum[tabloAdi].kaydedilince?.();
  } catch (e) { hataBildir(e); }
}

/* ---------------- bağlantılar ---------------- */

/** Bağlantı sütunlarının (ekip, ev, proje, personel, müşteri) seçenek kaynakları. */
const KAYNAKLAR = ["personel", "musteri", "proje", "ekip", "ev"];

async function kaynaklariYukle(haric) {
  await Promise.all(KAYNAKLAR.filter((k) => k !== haric).map(async (k) => {
    try { const v = await api(`/tablo/${k}`); tabloDurum[k] = { ...v, filtre: tabloDurum[k]?.filtre || "" }; }
    catch { /* yoksay */ }
  }));
}

const kayitlar = (ad) => (tabloDurum[ad]?.satirlar || []).filter((r) => !r._yeni);
const kayitEtiketi = (r) => (r.kod ? `${r.kod} — ${r.ad}` : r.ad);

function baglantiSecenekleri(kaynakAdi, deger) {
  let out = `<option value=""></option>`;
  let bulundu = false;
  for (const r of kayitlar(kaynakAdi)) {
    const v = r.kod || r.ad;
    if (v === deger) bulundu = true;
    out += `<option value="${kacir(v)}" ${v === deger ? "selected" : ""}>${kacir(kayitEtiketi(r))}</option>`;
  }
  if (deger && !bulundu) out += `<option value="${kacir(deger)}" selected>${kacir(deger)}</option>`;
  return out;
}

/* ---------------- AYRINTI SAYFALARI ---------------- */

const sayiMetni = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const toplamMetni = (t) => {
  const p = Object.entries(t || {}).filter(([, v]) => v);
  return p.length ? p.map(([pb, v]) => `${sayiMetni(v)} ${pb}`).join(" · ") : "—";
};
/** Toplamın ana para birimindeki karşılığı (Ayarlar'daki ya da dönemin kuru). */
function anaTutar(toplam, kur = S.durum?.kur) {
  const ana = kur?.ana || "EUR";
  const o = { ...(kur?.oran || {}), [ana]: 1 };
  let t = 0;
  const eksik = [];
  for (const [pb, v] of Object.entries(toplam || {})) { if (!v) continue; if (o[pb]) t += v / o[pb]; else eksik.push(pb); }
  return { pb: ana, t: Math.round(t * 100) / 100, eksik };
}
/** Birden çok para birimi varsa "≈ 1.234 EUR"; tek ve ana para birimiyse boş. */
function anaKarsilik(toplam, kur = S.durum?.kur) {
  const dolu = Object.entries(toplam || {}).filter(([, v]) => v);
  const ana = kur?.ana || "EUR";
  if (!dolu.length || (dolu.length === 1 && dolu[0][0] === ana)) return "";
  const a = anaTutar(toplam, kur);
  return `≈ ${sayiMetni(a.t)} ${a.pb}${a.eksik.length ? ` (${a.eksik.join(", ")} kuru yok)` : ""}`;
}
/** Özet tablolarına ana para birimi satırı: her sütunun ≈ karşılığı. */
function anaSatirHtml(kolonlar, kur = S.durum?.kur) {
  const ana = kur?.ana || "EUR";
  const pbler = new Set(kolonlar.flatMap((t) => Object.entries(t || {}).filter(([, v]) => v).map(([k]) => k)));
  if (!pbler.size || (pbler.size === 1 && pbler.has(ana))) return "";
  return `<tr class="ana-sat" title="Ayarlar'daki kurla ${ana} karşılığı (bilgi amaçlı)"><td class="pb">≈ ${ana}</td>${kolonlar.map((t) => {
    const a = anaTutar(t, kur);
    return `<td>${sayiMetni(a.t)}${a.eksik.length ? `<span class="soluk"> + ${a.eksik.join(", ")}</span>` : ""}</td>`;
  }).join("")}</tr>`;
}
const kurEsit = (a, b) => (a?.ana || "EUR") === (b?.ana || "EUR") &&
  ["EUR", "TRY", "RSD"].every((pb) => (a?.oran?.[pb] ?? null) === (b?.oran?.[pb] ?? null));
const kurMetni = (kur) => (kur ? Object.entries(kur.oran || {}).map(([pb, v]) => `1 ${kur.ana} = ${sayiMetni(v)} ${pb}`).join(" · ") || "kur girilmemiş" : "kur yok");

const ucretMetni = (p) => p.odemeTuru && p.ucret
  ? `${p.odemeTuru} · ${sayiMetni(p.ucret)} ${p.paraBirimi || ""}${p.odemeTuru === "Saatlik" ? "/saat" : "/ay"}` : "maaş girilmemiş";
const bugunMetni = () => new Date().toISOString().slice(0, 10);

function alanHtml(k, deger) {
  if (k.tur === "salt") return `<div class="deger-salt ${k.k === "kod" ? "kod" : ""}">${kacir(deger || "—")}</div>`;
  if (k.tur === "secim") {
    return `<select data-k="${k.k}"><option value=""></option>${k.secenek.map((o) =>
      `<option ${o === deger ? "selected" : ""}>${kacir(o)}</option>`).join("")}</select>`;
  }
  if (k.tur === "baglanti") return `<select data-k="${k.k}">${baglantiSecenekleri(k.kaynak, deger)}</select>`;
  const tip = k.tur === "tarih" ? "date" : (k.tur === "sayi" || k.tur === "para") ? "number" : "text";
  return `<input type="${tip}" data-k="${k.k}" value="${kacir(deger)}" ${k.tur === "para" ? 'step="0.01"' : ""}>`;
}

function kart(baslik, sag = "") {
  return el(`<div class="kart"><div class="kart-bas"><h3>${kacir(baslik)}</h3>${sag ? `<div class="sag">${sag}</div>` : ""}</div>
    <div class="kart-govde"></div></div>`);
}

function metrikler(liste) {
  return `<div class="metrikler">${liste.map(([b, a, ek]) =>
    `<div class="metrik"><b>${kacir(b)}</b><span>${kacir(a)}</span>${ek ? `<small>${kacir(ek)}</small>` : ""}</div>`).join("")}</div>`;
}

function kisiSatiri(p, { cikar, ek } = {}) {
  return `<div class="liste-sat">
    <a class="kod" href="#d/personel/${p._id}">${kacir(p.kod)}</a>
    <span class="ad">${kacir(p.ad)}</span>
    <span class="mt">${kacir([ek, p.gorev, ucretMetni(p)].filter(Boolean).join(" · "))}</span>
    ${cikar ? `<button class="dg ufak tehlike" data-cikar="${p._id}">${kacir(cikar)}</button>` : ""}</div>`;
}

function zimmetSatiri(z) {
  return `<div class="liste-sat">
    <span class="pul-k ${z.sahipTuru === "Ekip" ? "ekip" : ""}">${z.sahipTuru === "Ekip" ? "ekip" : "kişi"}</span>
    <span class="ad">${kacir(z.demirbas)}${Number(z.adet) > 1 ? ` × ${kacir(z.adet)}` : ""}</span>
    <span class="mt">${kacir([z.kategori, z.seriNo, z.sahipAd, z.durum].filter(Boolean).join(" · "))}</span></div>`;
}

const bosSatir = (metin) => `<div class="liste-bos">${kacir(metin)}</div>`;

/** Personelin ekip / ev alanını değiştirir (atama ve çıkarma). */
async function personelAta(id, alanlar, mesaj) {
  try {
    const y = await api(`/tablo/personel/${id}`, { method: "PUT", body: JSON.stringify(alanlar) });
    if (y.uyari) bildir(mesaj, y.uyari, "hata"); else bildir(mesaj, "", "iyi");
    await durumYukle(); await yonlendir();
  } catch (e) { hataBildir(e); }
}

/** Seçim kutusu + Ekle düğmesi; seçilen kaydı geri verir. */
function eklemeSatiri(secenekler, dugme, bos, isle) {
  const s = el(`<div class="ekle-sat">
    <select>${secenekler.length ? `<option value="">${kacir(bos)}</option>` : `<option value="">Eklenecek kayıt yok</option>`}
      ${secenekler.map(([v, e]) => `<option value="${kacir(v)}">${kacir(e)}</option>`).join("")}</select>
    <button class="dg ufak bas" ${secenekler.length ? "" : "disabled"}>${kacir(dugme)}</button></div>`);
  s.querySelector("button").onclick = () => { const v = s.querySelector("select").value; if (v) isle(v); };
  return s;
}

async function detayCiz(tabloAdi, id) {
  ana.innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;
  await kaynaklariYukle();
  let v;
  try { v = await api(`/detay/${tabloAdi}/${id}`); }
  catch (e) {
    ana.innerHTML = `<div class="bos"><div class="bs">Kayıt bulunamadı</div><p>${kacir(e.message)}</p></div>`;
    return;
  }
  const { tanim, satir } = v;

  ana.innerHTML = "";
  const bas = el(`<div class="sayfa-bas"><div>
      <a class="geri" href="#t/${tabloAdi}">← ${kacir(tanim.ad)}</a>
      <h2>${satir.kod ? `<span class="baslik-kod">${kacir(satir.kod)}</span>` : ""}${kacir(satir.ad || "")}</h2>
      <p>${kacir(tanim.aciklama)}</p></div>
    <div class="bas-arac">${tabloAdi === "personel" && satir.kod ? `<a class="dg" href="#calisan/${encodeURIComponent(satir.kod)}"
        title="Bu kişinin göreceği sayfa: puantajı, hakedişi, kesinti nedenleri ve ödemeleri">Çalışanın gözünden</a>` : ""}
      ${v.klasorYolu ? `<button class="dg" data-is="klasor">Klasörü aç</button>` : ""}</div></div>`);
  ana.appendChild(bas);
  bas.querySelector('[data-is="klasor"]')?.addEventListener("click", async () => {
    try { await api("/klasor-ac", { method: "POST", body: JSON.stringify({ yol: v.klasorYolu }) }); } catch (e) { hataBildir(e); }
  });

  const duzen = el(`<div class="detay-duzen"><div class="detay-sol"></div><div class="detay-sag"></div></div>`);
  ana.appendChild(duzen);
  duzen.querySelector(".detay-sol").appendChild(bilgiKarti(tabloAdi, tanim, satir));
  const sag = duzen.querySelector(".detay-sag");
  ({ personel: personelDetay, ekip: ekipDetay, proje: projeDetay, ev: evDetay })[tabloAdi]?.(sag, v);
}

function bilgiKarti(tabloAdi, tanim, satir) {
  const k = kart("Bilgiler");
  const g = k.querySelector(".kart-govde");
  g.innerHTML = `<div class="form-izgara">${tanim.kolon.map((c) =>
    `<label class="alan"><span>${kacir(c.b)}</span>${alanHtml(c, satir[c.k] ?? "")}</label>`).join("")}</div>
    <div class="form-alt"><button class="dg bas" data-kaydet>Değişiklikleri kaydet</button></div>`;
  g.querySelector("[data-kaydet]").onclick = async (ev) => {
    const gelen = {};
    for (const a of g.querySelectorAll("[data-k]")) gelen[a.dataset.k] = a.value;
    ev.target.disabled = true;
    try {
      const y = await api(`/tablo/${tabloAdi}/${satir._id}`, { method: "PUT", body: JSON.stringify(gelen) });
      if (y.uyari) bildir("Kaydedildi, ama dikkat", y.uyari, "hata");
      else if (y.adDegisikligi) bildir("Kaydedildi", `Klasör yeniden adlandırıldı: ${y.adDegisikligi.yeni}`, "iyi");
      else bildir("Kaydedildi", "", "iyi");
      S.agac = null; S.hedefler = [];
      await durumYukle(); await yonlendir();
    } catch (e) { hataBildir(e); ev.target.disabled = false; }
  };
  return k;
}

/**
 * Kişinin çalışma dönemleri (kontratlar): proje, başlangıç ve önceden girilebilen işten çıkış tarihi.
 * Çalışma dönemi girilen kişinin durumu, puantaja girdiği günler ve öngörüsü bu tarihlerden gelir.
 */
function calismaKarti(v) {
  const kisi = v.satir;
  const liste = v.kontratlar || [];
  const calisma = liste.filter((r) => r.tur !== "İzin");
  const k = kart("Çalışma Dönemleri", `<a class="dg ufak" href="#t/kontrat">Tüm kişiler</a>`);
  const g = k.querySelector(".kart-govde");

  const suren = calisma.find((r) => r.durumEtiketi === "Sürüyor");
  const sonraki = [...calisma].reverse().find((r) => r.durumEtiketi === "Başlamadı");
  let ust;
  if (!calisma.length) {
    ust = `<div class="ipucu-kutu">Çalışma dönemi girilmemiş; durum (${kacir(kisi.durum || "Aktif")}) elle ayarlanıyor.
      Bir dönem girince durum bugüne göre kendiliğinden değişir, kişi puantaja ve öngörüye sadece bu tarihler arasında girer.
      İşten çıkış tarihi önceden girilebilir.</div>`;
  } else {
    const siradaki = suren || sonraki;
    const cikis = siradaki?.bitis || "";
    const f = cikis ? gunFarki(cikis) : null;
    ust = metrikler([
      [kisi.durum || "—", "Bugünkü durum", "çalışma dönemlerinden"],
      [suren ? suren.projeAd || "proje girilmemiş" : sonraki ? `${tarihKisa(sonraki.baslangic)}'de başlıyor` : "Çalışmıyor", suren ? "Şu anki proje" : "Çalışma"],
      [siradaki ? (cikis ? tarihKisa(cikis) : "süresiz") : "—", "İşten çıkış", f !== null ? (f === 0 ? "bugün" : `${f} gün kaldı`) : ""],
    ]);
  }
  g.innerHTML = `${ust}
    ${liste.length ? `<table class="mini kt-tablo"><thead><tr><th>Tür</th><th>Proje</th><th>Başlangıç</th><th>Bitiş</th><th>Durum</th><th></th></tr></thead><tbody>
      ${liste.map((r) => `<tr data-id="${kacir(r._id)}" class="${r.durumEtiketi === "Bitti" ? "kt-bitti" : ""}">
        <td>${kacir(r.tur || "Çalışma")}</td><td>${kacir(r.projeAd || "—")}</td><td>${tarihKisa(r.baslangic)}</td>
        <td>${r.bitis ? tarihKisa(r.bitis) : `<span class="soluk">süresiz</span>`}</td>
        <td><span class="pul-k ${r.durumEtiketi === "Sürüyor" ? "iyi" : ""}">${kacir(r.durumEtiketi)}</span></td>
        <td class="kt-islem">${r.tur !== "İzin" && !r.bitis && r.durumEtiketi !== "Bitti" ? `<button class="dg ufak" data-cikis>Çıkış tarihi gir</button>` : ""}
          <button class="dg ufak" data-duzenle>Düzenle</button><button class="dg ufak tehlike" data-sil>Sil</button></td></tr>
        ${r.notlar ? `<tr class="kt-not"><td colspan="6">${kacir(r.notlar)}</td></tr>` : ""}`).join("")}
      </tbody></table>` : ""}
    <div class="kt-form">
      <div class="alt-baslik" data-baslik>Yeni dönem</div>
      <div class="kt-alanlar">
        <label class="alan"><span>Tür</span><select data-f="tur"><option>Çalışma</option><option>İzin</option></select></label>
        <label class="alan"><span>Proje</span><select data-f="proje">${baglantiSecenekleri("proje", "")}</select></label>
        <label class="alan"><span>Başlangıç</span><input type="date" data-f="baslangic"></label>
        <label class="alan"><span>Bitiş (işten çıkış)</span><input type="date" data-f="bitis"></label>
        <label class="alan kt-genis"><span>Not</span><input type="text" data-f="notlar" placeholder="ör. 6 aylık kontrat, uzatılabilir"></label>
      </div>
      <div class="form-alt"><button class="dg" data-vazgec style="display:none">Vazgeç</button><button class="dg bas" data-kaydet>Dönemi ekle</button></div>
    </div>`;

  const form = g.querySelector(".kt-form");
  const alan = (ad) => form.querySelector(`[data-f="${ad}"]`);
  let duzenlenen = null;
  const formuDoldur = (r) => {
    duzenlenen = r;
    const sonBitis = calisma.map((x) => x.bitis).filter(Boolean).sort().at(-1);
    const varsayilan = {
      tur: "Çalışma", proje: suren?.proje || v.proje?.kod || "",
      baslangic: sonBitis ? gunEkle(sonBitis, 1) : kisi.iseGiris || bugunStr(), bitis: "", notlar: "",
    };
    for (const ad of ["tur", "proje", "baslangic", "bitis", "notlar"]) alan(ad).value = (r ? r[ad] : varsayilan[ad]) || "";
    form.querySelector("[data-baslik]").textContent = r ? `Düzenleniyor: ${r.tur || "Çalışma"} · ${tarihKisa(r.baslangic)}` : "Yeni dönem";
    form.querySelector("[data-kaydet]").textContent = r ? "Değişiklikleri kaydet" : "Dönemi ekle";
    form.querySelector("[data-vazgec]").style.display = r ? "" : "none";
  };
  formuDoldur(null);

  const bul = (b) => liste.find((r) => r._id === b.closest("tr").dataset.id);
  g.querySelectorAll("[data-duzenle]").forEach((b) => b.onclick = () => { formuDoldur(bul(b)); form.scrollIntoView({ block: "nearest" }); });
  g.querySelectorAll("[data-cikis]").forEach((b) => b.onclick = () => {
    formuDoldur(bul(b));
    alan("bitis").focus();
    alan("bitis").showPicker?.();
  });
  form.querySelector("[data-vazgec]").onclick = () => formuDoldur(null);
  g.querySelectorAll("[data-sil]").forEach((b) => b.onclick = async () => {
    const r = bul(b);
    if (!(await onay("Çalışma dönemi silinsin mi?", `${r.tur || "Çalışma"} · ${tarihKisa(r.baslangic)} – ${r.bitis ? tarihKisa(r.bitis) : "süresiz"} silinecek. ` +
      "Kişinin durumu ve açık puantaj dönemleri kalan kayıtlara göre yeniden hesaplanır.", "Sil"))) return;
    try { await api(`/tablo/kontrat/${r._id}`, { method: "DELETE" }); bildir("Çalışma dönemi silindi", "", "iyi"); await durumYukle(); await yonlendir(); }
    catch (e) { hataBildir(e); }
  });
  form.querySelector("[data-kaydet]").onclick = async (ev) => {
    const veri = { personelKod: kisi.kod };
    for (const ad of ["tur", "proje", "baslangic", "bitis", "notlar"]) veri[ad] = alan(ad).value.trim();
    ev.target.disabled = true;
    try {
      if (duzenlenen) await api(`/tablo/kontrat/${duzenlenen._id}`, { method: "PUT", body: JSON.stringify(veri) });
      else await api("/tablo/kontrat", { method: "POST", body: JSON.stringify(veri) });
      bildir(duzenlenen ? "Çalışma dönemi güncellendi" : "Çalışma dönemi eklendi", "Durum ve açık puantaj dönemleri bu tarihlere göre güncellendi.", "iyi");
      await durumYukle(); await yonlendir();
    } catch (e) { hataBildir(e); ev.target.disabled = false; }
  };
  return k;
}

/**
 * Kişinin notları: ad + metin, her not ayrı kaydedilir. Altta kaydedilmiş notların adları;
 * ada tıklayınca metin açılır, ✎ düzenler, ✕ onay alıp siler. Yönetici notudur, çalışan sayfasına girmez.
 */
function notlarKarti(v) {
  const kod = v.satir.kod;
  const liste = v.notlar || [];
  const k = kart(`Notlar${liste.length ? ` · ${liste.length}` : ""}`);
  const g = k.querySelector(".kart-govde");
  g.innerHTML = `<div class="nt-form">
      <label class="alan"><span>Not adı</span><input type="text" data-f="ad" maxlength="120" placeholder="ör. İzin talebi, uyarı, görüşme"></label>
      <label class="alan"><span>Not</span><textarea data-f="metin" rows="4" placeholder="Notu buraya yazın…"></textarea></label>
      <div class="form-alt"><span class="nt-durum soluk" data-durum></span>
        <button class="dg" data-vazgec style="display:none">Vazgeç</button><button class="dg bas" data-kaydet>Kaydet</button></div>
    </div>
    <div class="nt-liste">${liste.length ? liste.map((n) => `<div class="nt-sat" data-id="${kacir(n._id)}">
        <button class="nt-ad" data-ac title="Notu göster">${kacir(n.ad)}</button>
        <span class="nt-tarih">${tarihKisa((n.guncelleme || n.olusturma || "").slice(0, 10))}</span>
        <button class="nt-ik" data-duzenle title="Düzenle" aria-label="Düzenle">✎</button>
        <button class="nt-ik tehlike" data-sil title="Sil" aria-label="Sil">✕</button>
        <div class="nt-metin" hidden>${kacir(n.metin)}</div></div>`).join("")
      : bosSatir("Henüz not yok. Yukarıdan ad ve not yazıp Kaydet'e basın.")}</div>`;

  const alan = (ad) => g.querySelector(`[data-f="${ad}"]`);
  let duzenlenen = null;
  const formuAc = (n) => {
    duzenlenen = n;
    alan("ad").value = n?.ad || "";
    alan("metin").value = n?.metin || "";
    g.querySelector("[data-durum]").textContent = n ? `Düzenleniyor: ${n.ad}` : "";
    g.querySelector("[data-vazgec]").style.display = n ? "" : "none";
    g.querySelector("[data-kaydet]").textContent = n ? "Değişiklikleri kaydet" : "Kaydet";
    g.querySelectorAll(".nt-sat").forEach((x) => x.classList.toggle("secili", x.dataset.id === n?._id));
  };
  const notu = (b) => liste.find((n) => n._id === b.closest(".nt-sat").dataset.id);

  g.querySelectorAll("[data-ac]").forEach((b) => b.onclick = () => {
    const m = b.closest(".nt-sat").querySelector(".nt-metin");
    m.hidden = !m.hidden;
  });
  g.querySelectorAll("[data-duzenle]").forEach((b) => b.onclick = () => { formuAc(notu(b)); alan("metin").focus(); });
  g.querySelector("[data-vazgec]").onclick = () => formuAc(null);
  g.querySelectorAll("[data-sil]").forEach((b) => b.onclick = async () => {
    const n = notu(b);
    if (!(await onay("Not silinsin mi?", `"${n.ad}" notu kalıcı olarak silinecek.`, "Sil"))) return;
    try { await api(`/notlar/${n._id}`, { method: "DELETE" }); bildir("Not silindi", "", "iyi"); await yonlendir(); }
    catch (e) { hataBildir(e); }
  });
  g.querySelector("[data-kaydet]").onclick = async (ev) => {
    const veri = { personelKod: kod, ad: alan("ad").value, metin: alan("metin").value };
    if (!veri.metin.trim()) { alan("metin").focus(); return bildir("Not boş", "Kaydetmeden önce notu yazın.", "hata"); }
    ev.target.disabled = true;
    try {
      if (duzenlenen) await api(`/notlar/${duzenlenen._id}`, { method: "PUT", body: JSON.stringify(veri) });
      else await api("/notlar", { method: "POST", body: JSON.stringify(veri) });
      bildir(duzenlenen ? "Not güncellendi" : "Not kaydedildi", "", "iyi");
      await yonlendir();
    } catch (e) { hataBildir(e); ev.target.disabled = false; }
  };
  return k;
}

function personelDetay(sag, v) {
  // Çalışma dönemi olan kişide durum otomatik: Bilgiler kartında kilitlenir.
  const durumAlani = ana.querySelector('.detay-sol select[data-k="durum"]');
  if (durumAlani && v.durumOtomatik) {
    durumAlani.disabled = true;
    durumAlani.title = "Çalışma dönemlerinden bugüne göre hesaplanıyor. Değiştirmek için Çalışma Dönemleri kartını kullanın.";
    durumAlani.closest(".alan")?.querySelector("span")?.insertAdjacentHTML("beforeend", ` <small class="soluk">· çalışma dönemlerinden</small>`);
  }

  const ekipK = kart("Ekip ve Proje");
  ekipK.querySelector(".kart-govde").innerHTML = v.ekip
    ? `${metrikler([
        [v.ekip.kod, v.ekip.ad],
        [v.proje ? v.proje.ad : "—", "Proje"],
        [v.yemekGunluk?.tutar ? `${sayiMetni(v.yemekGunluk.tutar)} ${v.yemekGunluk.paraBirimi}` : "—", "Yemek / gün"],
      ])}<a class="dg ufak" href="#d/ekip/${v.ekip._id}">Ekibe git</a>`
    : bosSatir("Bir ekibe atanmamış. Soldaki Ekip alanından ya da ekibin sayfasından atayabilirsiniz.");
  sag.appendChild(ekipK);
  sag.appendChild(calismaKarti(v));
  ana.querySelector(".detay-sol")?.appendChild(notlarKarti(v));

  const evK = kart("Konaklama");
  evK.querySelector(".kart-govde").innerHTML = v.ev
    ? `${metrikler([
        [v.ev.kod, v.ev.ad],
        [v.ev.doluluk, "Doluluk"],
        [v.ev.kisiBasiKira, "Kira payı / ay", v.proje ? `→ ${v.proje.ad}` : ""],
        [v.ev.kisiBasiGunluk, "Kira payı / gün", "gelmediği gün maaştan kesilir"],
      ])}<a class="dg ufak" href="#d/ev/${v.ev._id}">Eve git</a>`
    : bosSatir("Bir eve atanmamış.");
  sag.appendChild(evK);

  const zK = kart("Zimmetler", `<a class="dg ufak" href="#t/zimmet">Zimmet tablosu</a>`);
  zK.querySelector(".kart-govde").innerHTML =
    `<div class="alt-baslik">Kişisel</div>${v.kisiselZimmet.map(zimmetSatiri).join("") || bosSatir("Kişisel zimmet yok.")}
     <div class="alt-baslik">Ekip zimmeti${v.ekip ? ` · ${kacir(v.ekip.kod)}` : ""}</div>${v.ekipZimmet.map(zimmetSatiri).join("") || bosSatir("Ekip zimmeti yok.")}`;
  sag.appendChild(zK);

  const mK = kart("Maaş Geçmişi");
  mK.querySelector(".kart-govde").innerHTML =
    `<div class="ipucu-kutu">Maaş bölümü soldaki Bilgiler kartından değiştirilir. Değişiklik sadece bundan sonra açılan puantaj dönemlerine yansır; açılmış dönemler eski maaşla kalır.</div>
     ${v.maasGecmisi.length ? `<table class="mini"><thead><tr><th>Tarih</th><th>Tür</th><th>Ücret</th><th>Değiştiren</th></tr></thead><tbody>
       ${v.maasGecmisi.map((m) => `<tr><td>${kacir(m.tarih)}</td><td>${kacir(m.odemeTuru || "—")}</td>
         <td>${m.ucret ? `${sayiMetni(m.ucret)} ${kacir(m.paraBirimi)}` : "—"}</td><td>${kacir(m.kullanici || "")}</td></tr>`).join("")}
       </tbody></table>` : bosSatir("Henüz maaş kaydı yok.")}`;
  sag.appendChild(mK);

  // Puantaj dönemlerinden gelen çalışma özeti (personel koduyla eşleşir).
  const cK = kart("Çalışma Özeti", `<a class="dg ufak" href="#istatistik">Tüm istatistikler</a>`);
  const cg = cK.querySelector(".kart-govde");
  cg.innerHTML = `<span class="yukleniyor"></span>`;
  sag.insertBefore(cK, evK);
  api(`/istatistik/personel/${encodeURIComponent(v.satir.kod)}`).then((liste) => {
    if (!liste.length) { cg.innerHTML = bosSatir("Henüz hiçbir puantaj döneminde yok."); return; }
    const t = (alan) => liste.reduce((a, d) => a + d[alan], 0);
    const tp = (alan) => liste.reduce((a, d) => { for (const [pb, n] of Object.entries(d[alan] || {})) a[pb] = (a[pb] || 0) + n; return a; }, {});
    cg.innerHTML = metrikler([
      [sayiMetni(t("toplam")), "Toplam saat", `${liste.length} dönem`],
      [sayiMetni(t("mesai")), "Mesai"],
      [sayiMetni(t("eksik")), "Eksik saat"],
      [toplamMetni(tp("net")), "Net (avans düşülmüş)"],
    ]) + `<table class="mini"><thead><tr><th>Dönem</th><th>Ekip</th><th>Saat</th><th>Mesai</th><th>Eksik</th><th>Hakediş</th><th>Avans</th><th>Net</th></tr></thead><tbody>
      ${liste.map((d) => `<tr><td><a href="#puantaj/${d.donem}">${kacir(d.ad.replace(/ \(.*\)$/, ""))}</a>${d.durum === "kapali" ? ` <span class="pul-k">kapalı</span>` : ""}</td>
        <td>${kacir(d.ekip || "—")}</td><td>${sayiMetni(d.toplam)}</td><td>${sayiMetni(d.mesai)}</td><td>${sayiMetni(d.eksik)}</td>
        <td>${d.hakedis ? `${sayiMetni(d.hakedis)} ${kacir(d.paraBirimi)}` : "—"}</td><td>${toplamMetni(d.avans)}</td><td><b>${toplamMetni(d.net)}</b></td></tr>`).join("")}
      </tbody></table>`;
    sag.insertBefore(devamsizlikKarti(liste), cK.nextSibling);
  }).catch((e) => { cg.innerHTML = bosSatir(e.message); });
}

/** Kişinin devamsızlık ve kesinti (zarar) istatistiği: gelmediği günler ve maaşından kesilenler. */
function devamsizlikKarti(liste) {
  const k = kart("Devamsızlık ve Kesinti");
  const g = k.querySelector(".kart-govde");
  const tp = (fn) => liste.reduce((a, d) => { const pb = d.paraBirimi; a[pb] = (a[pb] || 0) + (fn(d) || 0); return a; }, {});
  const temiz = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v));
  const gelmedi = liste.reduce((a, d) => a + (d.gelmedi || 0), 0);
  const kesinti = temiz(tp((d) => d.kesinti));
  if (!gelmedi && !Object.keys(kesinti).length) { g.innerHTML = bosSatir("Gelmediği gün ya da kesinti yok."); return k; }
  g.innerHTML = metrikler([
    [String(gelmedi), "Gelmediği gün", `${liste.filter((d) => d.gelmedi).length} dönemde`],
    [toplamMetni(temiz(tp((d) => (d.kesintiDetay?.maas || 0) + (d.kesintiDetay?.eksikSaat || 0)))), "Kesilen maaş"],
    [toplamMetni(temiz(tp((d) => d.kesintiDetay?.kira))), "Kesilen kira payı"],
    [toplamMetni(temiz(tp((d) => d.kesintiDetay?.yemek))), "Kesilen yemek"],
    [toplamMetni(kesinti), "Toplam kesinti"],
  ]) + `<table class="mini"><thead><tr><th>Dönem</th><th>Gelmediği günler</th><th>Maaş</th><th>Kira</th><th>Yemek</th><th>Toplam</th></tr></thead><tbody>
    ${liste.filter((d) => d.gelmedi || d.kesinti).map((d) => {
      const kd = d.kesintiDetay || {};
      const pb = ` ${kacir(d.paraBirimi)}`;
      const disi = Object.entries(d.kesintiDisi || {}).map(([a, n]) => `${a} ${sayiMetni(n)}`).join(", ");
      return `<tr><td><a href="#puantaj/${d.donem}">${kacir(d.ad.replace(/ \(.*\)$/, ""))}</a>${d.kural === 1 ? ` <span class="pul-k" title="Eski kural: eksik saat × saat değeri">eski kural</span>` : ""}</td>
        <td>${(d.gelmediGunler || []).map((x) => x.slice(8, 10)).join(", ") || "—"}</td>
        <td>${sayiMetni((kd.maas || 0) + (kd.eksikSaat || 0))}${pb}</td><td>${sayiMetni(kd.kira || 0)}${pb}</td><td>${sayiMetni(kd.yemek || 0)}${pb}</td>
        <td><b>${sayiMetni(d.kesinti)}${pb}</b>${disi ? `<div class="soluk" title="Farklı para birimi; maaştan düşülmedi">+ ${kacir(disi)}</div>` : ""}</td></tr>
        ${d.kural >= 2 && (d.kesintiKalem || []).length ? `<tr class="kd-sat"><td colspan="6">${kesintiSatirlari(d).map(kacir).join("<br>")}</td></tr>` : ""}`;
    }).join("")}</tbody></table>`;
  return k;
}

function ekipDetay(sag, v) {
  const { satir, hesap } = v;

  const yK = kart("Yemek");
  yK.querySelector(".kart-govde").innerHTML = metrikler([
    [hesap.yemekKisiGunluk ? `${sayiMetni(hesap.yemekKisiGunluk)} ${hesap.paraBirimi}` : "—", "Kişi başı / gün"],
    [String(hesap.kisiSayisi), "Kişi"],
    [`${sayiMetni(hesap.yemekEkipGunluk)} ${hesap.paraBirimi}`, "Ekip / gün"],
    [`${sayiMetni(hesap.yemekEkipDonem)} ${hesap.paraBirimi}`, "Ekip / 15 gün", "puantaj gelince çalışılan güne göre"],
  ]) + `<div class="ipucu-kutu">Ekip yemeği = kişi başı günlük tutar × ekipteki kişi sayısı. Tutarı soldaki Bilgiler kartından değiştirebilirsiniz.</div>`;
  sag.appendChild(yK);

  const uK = kart(`Üyeler · ${v.uyeler.length}`);
  const ug = uK.querySelector(".kart-govde");
  ug.innerHTML = v.uyeler.map((p) => kisiSatiri(p, {
    cikar: "Ekipten çıkar", ek: p.kod === satir.ekipBasi ? "ekip başı" : "",
  })).join("") || bosSatir("Ekipte kimse yok.");
  ug.querySelectorAll("[data-cikar]").forEach((b) => {
    b.onclick = () => personelAta(b.dataset.cikar, { ekip: "" }, "Ekipten çıkarıldı");
  });
  const adaylar = kayitlar("personel")
    .filter((p) => p.durum !== "Ayrıldı" && p.ekip !== satir.kod)
    .map((p) => [p._id, `${p.kod} — ${p.ad}${p.ekip ? `  (şu an ${p.ekip})` : ""}`]);
  ug.appendChild(eklemeSatiri(adaylar, "Ekibe ekle", "Personel seçin…", (pid) =>
    personelAta(pid, { ekip: satir.kod }, "Ekibe eklendi")));
  sag.appendChild(uK);

  const zK = kart(`Ekip Zimmetleri · ${v.zimmet.length}`, `<a class="dg ufak" href="#t/zimmet">Zimmet tablosu</a>`);
  const zg = zK.querySelector(".kart-govde");
  zg.innerHTML = v.zimmet.map(zimmetSatiri).join("") || bosSatir("Ekibe yazılı zimmet yok.");
  const zf = el(`<div class="hizli-form">
    <input data-f="demirbas" placeholder="Demirbaş (ör. Hilti matkap)">
    <select data-f="kategori"><option value="">Kategori</option>${["El Aleti", "Ölçü Cihazı", "Bilgisayar", "Telefon", "Araç", "KKD", "Diğer"].map((c) => `<option>${c}</option>`).join("")}</select>
    <input data-f="seriNo" placeholder="Seri no">
    <input data-f="adet" type="number" min="1" value="1" style="max-width:70px">
    <button class="dg ufak bas">Ekibe zimmetle</button></div>`);
  zf.querySelector("button").onclick = async () => {
    const f = Object.fromEntries([...zf.querySelectorAll("[data-f]")].map((x) => [x.dataset.f, x.value.trim()]));
    if (!f.demirbas) return bildir("Demirbaş adı boş", "Zimmetlenecek eşyanın adını yazın.", "hata");
    try {
      await api("/tablo/zimmet", { method: "POST", body: JSON.stringify({
        ...f, sahipTuru: "Ekip", ekipKod: satir.kod, teslimTarihi: bugunMetni(), durum: "Zimmetli",
      }) });
      bildir("Ekibe zimmetlendi", f.demirbas, "iyi");
      await durumYukle(); await yonlendir();
    } catch (e) { hataBildir(e); }
  };
  zg.appendChild(zf);
  sag.appendChild(zK);

  const kK = kart("Üyelerin Kişisel Zimmetleri");
  kK.querySelector(".kart-govde").innerHTML = v.kisiselZimmet.map(zimmetSatiri).join("") || bosSatir("Kişisel zimmet yok.");
  sag.appendChild(kK);
}

function projeDetay(sag, v) {
  const { satir, maliyet } = v;

  const mK = kart("Maliyet Özeti");
  mK.querySelector(".kart-govde").innerHTML = metrikler([
    [toplamMetni(maliyet.yemekGunluk), "Yemek / gün"],
    [toplamMetni(maliyet.kiraAylik), "Kira payı / ay", "kişi başı paylardan"],
    [toplamMetni(maliyet.maasAylik), "Aylık maaşlar / ay"],
    [String(maliyet.saatlikKisi), "Saatlik çalışan", "maliyeti puantajla hesaplanacak"],
  ]);
  sag.appendChild(mK);

  const eK = kart(`Ekipler · ${v.ekipler.length}`);
  const eg = eK.querySelector(".kart-govde");
  for (const e of v.ekipler) {
    const blok = el(`<div class="ekip-blok">
      <div class="ekip-bas">
        <a class="kod" href="#d/ekip/${e._id}">${kacir(e.kod)}</a><b>${kacir(e.ad)}</b>
        <span class="mt">${e.hesap.kisiSayisi} kişi · yemek ${kacir(e.yemekEkipGunluk)}/gün</span>
        <button class="dg ufak tehlike" data-cikar>Projeden çıkar</button></div>
      ${e.uyeler.map((p) => kisiSatiri(p)).join("") || bosSatir("Ekipte kimse yok.")}
      ${e.zimmet.length || e.kisiselZimmet.length ? `<div class="alt-baslik">Zimmetler</div>${[...e.zimmet, ...e.kisiselZimmet].map(zimmetSatiri).join("")}` : ""}
    </div>`);
    blok.querySelector("[data-cikar]").onclick = async () => {
      try {
        await api(`/tablo/ekip/${e._id}`, { method: "PUT", body: JSON.stringify({ proje: "" }) });
        bildir("Ekip projeden çıkarıldı", e.ad, "iyi"); await yonlendir();
      } catch (er) { hataBildir(er); }
    };
    eg.appendChild(blok);
  }
  if (!v.ekipler.length) eg.innerHTML = bosSatir("Bu projeye atanmış ekip yok.");
  const adaylar = kayitlar("ekip").filter((e) => e.proje !== satir.kod && e.durum !== "Pasif")
    .map((e) => [e._id, `${e.kod} — ${e.ad}${e.proje ? `  (şu an ${e.proje})` : ""}`]);
  eg.appendChild(eklemeSatiri(adaylar, "Projeye ata", "Ekip seçin…", async (eid) => {
    try {
      await api(`/tablo/ekip/${eid}`, { method: "PUT", body: JSON.stringify({ proje: satir.kod }) });
      bildir("Ekip projeye atandı", "", "iyi"); await yonlendir();
    } catch (e) { hataBildir(e); }
  }));
  sag.appendChild(eK);

  const vK = kart(`Evler · ${v.evler.length}`);
  vK.querySelector(".kart-govde").innerHTML = v.evler.map((ev) => `<div class="ekip-blok">
      <div class="ekip-bas"><a class="kod" href="#d/ev/${ev._id}">${kacir(ev.kod)}</a><b>${kacir(ev.ad)}</b>
        <span class="mt">${kacir(ev.doluluk)} · kişi başı ${kacir(ev.kisiBasiKira)}</span></div>
      ${ev.sakinler.map((p) => kisiSatiri(p)).join("") || bosSatir("Evde kimse kalmıyor.")}</div>`).join("")
    || bosSatir("Bu projeye bağlı ev yok. Ev tablosunda Proje alanını seçin.");
  sag.appendChild(vK);
}

function evDetay(sag, v) {
  const { satir, hesap } = v;

  const dK = kart("Doluluk ve Kira");
  dK.querySelector(".kart-govde").innerHTML = metrikler([
    [`${hesap.kisiSayisi} / ${hesap.yatak || "?"}`, "Kişi / yatak"],
    [hesap.kira ? `${sayiMetni(hesap.kira)} ${hesap.paraBirimi}` : "—", "Aylık kira"],
    [hesap.kisiBasiKira ? `${sayiMetni(hesap.kisiBasiKira)} ${hesap.paraBirimi}` : "—", "Kişi başı / ay"],
  ]) + (hesap.asim ? `<div class="o-not">Kapasite aşıldı: ${hesap.kisiSayisi} kişi kalıyor, yatak sayısı ${hesap.yatak}.</div>` : "");
  sag.appendChild(dK);

  const kK = kart(`Kalanlar · ${v.sakinler.length}`);
  const kg = kK.querySelector(".kart-govde");
  kg.innerHTML = v.sakinler.map((p) => kisiSatiri(p, { cikar: "Evden çıkar", ek: p.ekip || "ekipsiz" })).join("")
    || bosSatir("Evde kimse kalmıyor.");
  kg.querySelectorAll("[data-cikar]").forEach((b) => {
    b.onclick = () => personelAta(b.dataset.cikar, { ev: "" }, "Evden çıkarıldı");
  });
  const adaylar = kayitlar("personel").filter((p) => p.durum !== "Ayrıldı" && p.ev !== satir.kod)
    .map((p) => [p._id, `${p.kod} — ${p.ad}${p.ev ? `  (şu an ${p.ev})` : ""}`]);
  kg.appendChild(eklemeSatiri(adaylar, "Eve yerleştir", "Personel seçin…", async (pid) => {
    if (hesap.yatak && hesap.kisiSayisi >= hesap.yatak) {
      const ok = await onay("Ev dolu", `${satir.ad} evinde ${hesap.yatak} yatak var ve hepsi dolu. Yine de yerleştirilsin mi?`, "Yine de yerleştir");
      if (!ok) return;
    }
    personelAta(pid, { ev: satir.kod }, "Eve yerleştirildi");
  }));
  sag.appendChild(kK);

  const pK = kart("Kira Payları");
  pK.querySelector(".kart-govde").innerHTML = v.kiraPaylari.length
    ? `<table class="mini"><thead><tr><th>Proje</th><th>Kişi</th><th>Aylık pay</th></tr></thead><tbody>
        ${v.kiraPaylari.map((p) => `<tr><td>${kacir(p.ad)}</td><td>${p.kisi}</td><td>${sayiMetni(p.tutar)} ${kacir(hesap.paraBirimi)}</td></tr>`).join("")}
       </tbody></table><div class="ipucu-kutu">Kira, evde kalan kişi sayısına bölünür ve her kişinin projesine (ekibinin projesi; ekibi yoksa evin projesi) yazılır.</div>`
    : bosSatir("Evde kimse kalmadığı için pay yok.");
  sag.appendChild(pK);
}

/* ---------------- ÇALIŞANIN GÖZÜNDEN ---------------- */

const para = (n, pb) => `${sayiMetni(n)} ${pb}`;
const gunEkle = (t, n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cgDonemKisa = (d) => d.ad.replace(/ · \d\. Yarı \((.*)\)$/, " · $1");
const cgGunDisi = (g) => g.girisOncesi || g.kontratDisi;

/**
 * Sayfadaki seçim, adres çubuğundan okunur:
 *   "2026-10-1"               tek dönem
 *   "2026-09-2,2026-10-1"     birden çok dönem (aralarında boşluk olabilir)
 *   "2026-10-03..2026-10-20"  gün gün tarih aralığı (dönem sınırını aşabilir)
 * Döner: seçilen dönemler (eskiden yeniye) ve gösterilecek ilk / son gün.
 */
const CG_EN_FAZLA = 2;
function cgSecimCoz(v, sec) {
  const tum = [...v.donemler].reverse();
  const ilk = (d) => d.gunler[0].gun, son = (d) => d.gunler.at(-1).gun;
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(sec || "");
  // En fazla CG_EN_FAZLA dönem gösterilir; fazlası seçilirse en yeni dönemler kalır.
  const kirp = (donemler) => donemler.slice(-CG_EN_FAZLA);
  if (m) {
    const [bas, bit] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]];
    const hepsi = tum.filter((d) => ilk(d) <= bit && son(d) >= bas), donemler = kirp(hepsi);
    const kirpildi = hepsi.length > donemler.length;
    return { aralik: true, bas: kirpildi && ilk(donemler[0]) > bas ? ilk(donemler[0]) : bas, bit, donemler, kirpildi };
  }
  const liste = String(sec || "").split(",");
  const hepsi = tum.filter((d) => liste.includes(d.donem));
  let donemler = kirp(hepsi);
  if (!donemler.length) donemler = tum.slice(-1);
  return { aralik: false, bas: donemler[0] ? ilk(donemler[0]) : "", bit: donemler.length ? son(donemler.at(-1)) : "", donemler,
    kirpildi: hepsi.length > donemler.length };
}

/** Seçilen günlerin saat ve gün sayıları (işe giriş öncesi ve çalışma dönemi dışı günler sayılmaz). */
function cgGunToplam(gunler) {
  const t = { gun: 0, saat: 0, normal: 0, mesai: 0, gelmedi: 0, izin: 0, rapor: 0 };
  for (const g of gunler) {
    if (cgGunDisi(g)) continue;
    if (/^\d/.test(g.deger) && Number(g.deger) > 0) t.gun += 1;
    t.normal += g.n || 0; t.mesai += g.m || 0;
    if (g.gelmedi) t.gelmedi += 1; else if (g.deger === "İ") t.izin += 1; else if (g.deger === "R") t.rapor += 1;
  }
  t.saat = t.normal + t.mesai;
  return t;
}

/**
 * Çalışanın göreceği sayfa: kendi puantajı, hakedişi, kesinti nedenleri ve ödemeleri. Sadece okunur.
 * En fazla iki dönem ya da gün gün bir tarih aralığı seçilir. Yazdırınca (PDF) puantaj, hakediş hesabı ve o ayın yemek parası
 * ödemeleri çıkar; ücret, ev, çalışma dönemleri ve belgeler sadece ekranda kalır.
 */
async function calisanCiz(kod, sec) {
  ana.innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;
  let v;
  try { v = await api(`/calisan/${encodeURIComponent(kod)}`); }
  catch (e) { ana.innerHTML = `<div class="bos"><div class="bs">Sayfa açılamadı</div><p>${kacir(e.message)}</p></div>`; return; }
  const k = v.kisi;
  const secim = cgSecimCoz(v, sec);
  const git = (s) => { location.hash = `#calisan/${encodeURIComponent(k.kod)}/${s}`; };

  ana.innerHTML = "";
  const bas = el(`<div class="sayfa-bas cg-arac"><div>
      <a class="geri" href="#d/personel/${kacir(k._id)}">← ${kacir(k.ad)} · kişi sayfası</a>
      <h2>Çalışanın gözünden</h2>
      <p>${kacir(k.ad)} bu sayfayı görür: kendi puantajı, hakedişi, kesinti nedenleri ve ödemeleri. Başka kimsenin bilgisi ve yönetici notları yer almaz.
        En fazla iki dönem gösterilir. Yazdırınca ya da PDF alınca puantaj, hakediş hesabı ve o ayın yemek parası ödemeleri çıkar.</p></div>
    <div class="bas-arac"><button class="dg bas" data-yazdir ${secim.donemler.length ? "" : "disabled"}>Yazdır / PDF</button></div></div>`);
  ana.appendChild(bas);
  bas.querySelector("[data-yazdir]").onclick = () => {
    // Tarayıcı PDF dosyasına sayfa başlığını ad olarak önerir.
    const eski = document.title;
    document.title = `Puantaj ve hakediş ${k.ad} ${secim.bas}_${secim.bit}`;
    window.addEventListener("afterprint", () => { document.title = eski; }, { once: true });
    window.print();
  };

  if (v.donemler.length) {
    const secili = new Set(secim.donemler.map((d) => d.donem));
    const ilkGun = v.donemler.at(-1).gunler[0].gun, sonGun = v.donemler[0].gunler.at(-1).gun;
    const cubuk = el(`<div class="kart cg-secim">
      <div class="cg-satir"><span class="kucuk-et">Dönemler</span>
        <div class="cg-cipler">${v.donemler.map((d) => `<button class="cg-cip ${secili.has(d.donem) ? "aktif" : ""}" data-d="${d.donem}"
          title="${kacir(d.ad)} · tıklayınca seçime eklenir ya da çıkar">${kacir(cgDonemKisa(d))}</button>`).join("")}</div></div>
      <div class="cg-satir"><span class="kucuk-et">Tarih aralığı</span>
        <input type="date" data-t="bas" value="${secim.bas}" min="${ilkGun}" max="${sonGun}">
        <span class="soluk">–</span>
        <input type="date" data-t="bit" value="${secim.bit}" min="${ilkGun}" max="${sonGun}">
        <button class="dg ufak" data-h="ay">Bu ay</button>
        <button class="dg ufak" data-h="son">Son ${CG_EN_FAZLA} dönem</button>
        <span class="cg-secim-ozet">${secim.donemler.length} dönem${secim.aralik ? " · gün aralığı" : ""}${secim.kirpildi
          ? ` · <span class="kotu">en fazla ${CG_EN_FAZLA} dönem gösterilir</span>` : ""}</span></div></div>`);
    ana.appendChild(cubuk);
    const sira = new Map(v.donemler.map((d, i) => [d.donem, i]));
    cubuk.querySelectorAll("[data-d]").forEach((b) => b.onclick = () => {
      const tik = b.dataset.d, yeni = new Set(secili);
      if (yeni.has(tik)) { if (yeni.size > 1) yeni.delete(tik); } else yeni.add(tik);
      // Sınır aşılırsa tıklanan kalır, ona en uzak dönem çıkar.
      const uzaklik = (x) => Math.abs(sira.get(x) - sira.get(tik));
      while (yeni.size > CG_EN_FAZLA) yeni.delete([...yeni].filter((x) => x !== tik).sort((a, b2) => uzaklik(b2) - uzaklik(a))[0]);
      git([...yeni].sort().join(","));
    });
    cubuk.querySelectorAll("[data-t]").forEach((inp) => inp.onchange = () => {
      const b = cubuk.querySelector('[data-t="bas"]').value, s = cubuk.querySelector('[data-t="bit"]').value;
      if (b && s) git(`${b}..${s}`);
    });
    cubuk.querySelector('[data-h="ay"]').onclick = () => {
      const ay = bugunStr().slice(0, 7);
      git(`${ay}-01..${gunEkle(`${gunEkle(`${ay}-01`, 32).slice(0, 7)}-01`, -1)}`);
    };
    cubuk.querySelector('[data-h="son"]').onclick = () => git(v.donemler.slice(0, CG_EN_FAZLA).map((d) => d.donem).sort().join(","));
  }

  const kagit = el(`<div class="kart cg-kagit"></div>`);
  ana.appendChild(kagit);

  // Kimlik ve yerleşim. Ücret, ev ve yemek ekranda kalır; yazdırılan puantajda çıkmaz.
  const ekipMetni = v.ekip ? `${v.ekip.ad}${v.proje ? ` · ${v.proje.ad}` : ""}` : "Ekip atanmamış";
  const evMetni = v.ev ? `${v.ev.ad}${v.ev.adres ? ` · ${v.ev.adres}` : ""} · ${v.ev.kisi} kişi` : "Ev atanmamış";
  const ucret = k.odemeTuru && k.ucret
    ? `${k.odemeTuru} · ${para(k.ucret, k.paraBirimi)}${k.odemeTuru === "Saatlik" ? " / saat" : " / ay"}` : "—";
  kagit.appendChild(el(`<div class="cg-bas">
    <div><div class="cg-ust">ACME MÜHENDİSLİK · çalışan sayfası</div>
      <div class="cg-ad">${kacir(k.ad)}</div>
      <div class="soluk">${kacir([k.kod, k.gorev, k.iseGiris ? `işe giriş ${tarihKisa(k.iseGiris)}` : ""].filter(Boolean).join(" · "))}</div></div>
    <div class="cg-bilgi">
      <div class="cg-ekran"><span>Ücret</span><b>${kacir(ucret)}</b></div>
      <div><span>Ekip ve proje</span><b>${kacir(ekipMetni)}</b></div>
      <div class="cg-ekran"><span>Kaldığınız ev</span><b>${kacir(evMetni)}</b>${v.ev?.kisiBasiKira
        ? `<small>Kira payınız: ${kacir(para(v.ev.kisiBasiKira, v.ev.paraBirimi))} / ay · ${kacir(para(v.ev.kisiBasiGunluk, v.ev.paraBirimi))} / gün</small>` : ""}</div>
      <div class="cg-ekran"><span>Yemek parası</span><b>${v.ekip?.yemekGunluk ? `${kacir(para(v.ekip.yemekGunluk, v.ekip.yemekPB))} / gün` : "—"}</b>${v.ekip?.yemekGunluk
        ? `<small>dönem başında peşin verilir</small>` : ""}</div>
      ${secim.donemler.length ? `<div class="cg-baski"><span>Puantaj aralığı</span><b>${tarihKisa(secim.bas)} – ${tarihKisa(secim.bit)}</b></div>` : ""}
    </div></div>`));

  if (!secim.donemler.length) {
    kagit.appendChild(el(`<div class="bos"><div class="bs">${v.donemler.length ? "Bu tarihlerde puantaj yok" : "Henüz puantaj yok"}</div>
      <p>${v.donemler.length ? "Seçilen aralık hiçbir puantaj dönemine denk gelmiyor." : "Bu kişi hiçbir puantaj dönemine girmemiş."}</p></div>`));
  } else {
    kagit.appendChild(calisanPuantajHtml(secim));
    kagit.appendChild(calisanHakedisBolumu(secim));

    // Ödemeler: sadece seçilen ay(lar)ın yemek parası. Maaş ödemesi burada yazılmaz; hakediş hesabı yukarıda.
    const aylar = new Set(secim.donemler.map((d) => d.donem.slice(0, 7)));
    const od = v.odemeler.filter((o) => o.tur === "yemek" && aylar.has(String(o.donem || "").slice(0, 7)));
    kagit.appendChild(el(`<div class="cg-bolum"><h4>Ödemeleriniz · yemek parası</h4>
      ${od.length ? `<table class="mini"><thead><tr><th>Ödeme günü</th><th>Ödeme</th><th style="text-align:right">Tutar</th><th>Durum</th></tr></thead><tbody>
        ${od.map((o) => `<tr><td>${tarihKisa(o.vade)}</td><td>${kacir(o.aciklama)}</td>
          <td style="text-align:right;white-space:nowrap">${kacir(para(o.odendi ? o.odenen : o.tutar, o.paraBirimi))}</td>
          <td>${o.odendi ? `<span class="cg-pul iyi">Ödendi ${tarihKisa(o.odemeTarihi)}</span>` : `<span class="cg-pul">Bekliyor</span>`}</td></tr>`).join("")}
      </tbody></table>` : `<div class="liste-bos">Bu ay için yemek parası kalemi yok.</div>`}</div>`));
  }

  if (v.calisma?.length) {
    kagit.appendChild(el(`<div class="cg-bolum cg-ekran"><h4>Çalışma dönemleriniz</h4>
      <table class="mini"><thead><tr><th>Tür</th><th>Proje</th><th>Başlangıç</th><th>Bitiş</th><th>Durum</th></tr></thead><tbody>
      ${v.calisma.map((c) => `<tr><td>${kacir(c.tur)}</td><td>${kacir(c.proje || "—")}</td><td>${tarihKisa(c.baslangic)}</td>
        <td>${c.bitis ? tarihKisa(c.bitis) : "süresiz"}</td><td><span class="cg-pul ${c.durum === "Sürüyor" ? "iyi" : ""}">${kacir(c.durum)}</span></td></tr>`).join("")}
      </tbody></table></div>`));
  }

  if (k.belgeler.length) {
    kagit.appendChild(el(`<div class="cg-bolum cg-ekran"><h4>Belgelerinizin bitiş tarihleri</h4><div class="cg-belgeler">
      ${k.belgeler.map((b) => {
        const f = gunFarki(b.bitis);
        return `<div><span>${kacir(b.ad)}</span><b>${tarihKisa(b.bitis)}</b>${f !== null && f <= 60
          ? `<small class="kotu">${f < 0 ? `${-f} gün geçti` : `${f} gün kaldı`}</small>` : ""}</div>`;
      }).join("")}</div></div>`));
  }
  const zaman = new Date(v.olusturma).toLocaleString("tr-TR");
  kagit.appendChild(el(`<div class="cg-alt"><span class="cg-ekran">Bu sayfa ${zaman} tarihinde hazırlandı.
    Rakamlar dönem kapanana kadar değişebilir. Bir yanlışlık görürseniz yöneticinize bildirin.</span>
    <span class="cg-baski">Bu sayfa ${zaman} tarihinde hazırlandı. Açık dönemlerde rakamlar dönem kapanana kadar değişebilir.</span></div>`));
}

/** Gelmedi gününde ne kesildiği: ödeme türüne ve dönemin kuralına göre. */
function gelmediKurali(d) {
  const saatlik = d.odemeTuru === "Saatlik";
  if (d.kural === 1) return saatlik ? "Çalışılmayan saat ödenmez." : "Eksik kalan saatler maaştan kesilir.";
  return saatlik
    ? "Çalışılmayan saat zaten ödenmez; gelmediğiniz her gün için ayrıca kira payı ve yemek parası kesilir."
    : "Gelmediğiniz her gün için o günün maaşı, kira payı ve yemek parası kesilir.";
}

/** Seçilen günlerin puantajı: toplamlar ve dönem dönem gün ızgarası. */
function calisanPuantajHtml(secim) {
  const parcalar = secim.donemler.map((d) => ({ d, gunler: d.gunler.filter((g) => g.gun >= secim.bas && g.gun <= secim.bit) }));
  const t = cgGunToplam(parcalar.flatMap((x) => x.gunler));
  const disiVar = parcalar.some((x) => x.gunler.some(cgGunDisi));

  const gunHtml = (g) => {
    const v = g.deger === "İ" ? "v-izin" : g.deger === "R" ? "v-rapor" : g.gelmedi ? "v-gelmedi" : "";
    const disi = cgGunDisi(g);
    const deger = disi ? "" : g.gelmedi ? "–" : g.deger;
    const ne = g.girisOncesi ? "işe girişten önce" : g.kontratDisi ? "çalışma dönemi dışında" : g.gelmedi ? "gelmedi"
      : g.deger === "İ" ? "izin" : g.deger === "R" ? "rapor" : /^\d/.test(g.deger) ? `${g.deger} saat` : "";
    const ipucu = [tarihUzun(g.gun), ne, g.baskaEkip ? `${g.baskaEkip} ekibinde` : "",
      g.tip === "mesai" ? "mesai günü" : g.tip === "tatil" ? "tatil" : ""].filter(Boolean).join(" · ");
    return `<div class="cg-gun t-${g.tip} ${v} ${disi ? "giris" : ""}" title="${kacir(ipucu)}">
      <span>${g.gun.slice(8)} ${kacir(g.hg)}</span><b>${kacir(deger) || "&nbsp;"}</b>${g.baskaEkip ? `<i>${kacir(g.baskaEkip)}</i>` : ""}</div>`;
  };

  const donemHtml = ({ d, gunler }) => {
    const dt = cgGunToplam(gunler);
    const gelmedi = gunler.filter((g) => g.gelmedi);
    const kismi = gunler.length < d.gunler.length;
    return `<div class="cg-pt-donem">
      <div class="cg-pt-bas"><b>${kacir(cgDonemKisa(d))}</b>
        <span>${d.durum === "kapali" ? "dönem kapandı" : "dönem açık"}${kismi ? ` · ${gunler.length}/${d.gunler.length} gün` : ""}</span>
        <span class="cg-pt-t">${sayiMetni(dt.saat)} saat · ${dt.gun} gün${dt.mesai ? ` · ${sayiMetni(dt.mesai)} mesai` : ""}${dt.gelmedi ? ` · <em class="kotu">${dt.gelmedi} gelmedi</em>` : ""}</span></div>
      <div class="cg-gunler">${gunler.map(gunHtml).join("")}</div>
      ${gelmedi.length ? `<div class="cg-not">Gelmediğiniz günler: <b>${gelmedi.map((g) => kacir(tarihUzun(g.gun))).join(", ")}</b>.
        <span class="cg-ekran">${kacir(gelmediKurali(d))}</span></div>` : ""}</div>`;
  };

  return el(`<div class="cg-bolum cg-puantaj"><h4>Puantajınız · ${tarihKisa(secim.bas)} – ${tarihKisa(secim.bit)}</h4>
    <div class="cg-sayilar">
      <div><b>${t.gun}</b><span>çalışılan gün</span></div>
      <div><b>${sayiMetni(t.saat)}</b><span>toplam saat</span></div>
      <div><b>${sayiMetni(t.normal)}</b><span>normal saat</span></div>
      <div><b>${sayiMetni(t.mesai)}</b><span>mesai saati</span></div>
      <div class="${t.gelmedi ? "kotu" : ""}"><b>${t.gelmedi}</b><span>gelmediğiniz gün</span></div>
      ${t.izin ? `<div><b>${t.izin}</b><span>izin</span></div>` : ""}${t.rapor ? `<div><b>${t.rapor}</b><span>rapor</span></div>` : ""}
    </div>
    ${parcalar.map(donemHtml).join("")}
    <div class="lejant cg-lejant"><span class="lj">sayı = çalışılan saat</span><span class="lj v-gelmedi">– gelmedi</span>
      <span class="lj v-izin">İ izin</span><span class="lj v-rapor">R rapor</span><span class="lj t-mesai">mesai günü</span><span class="lj t-tatil">tatil</span>
      ${disiVar ? `<span class="lj cg-lj-disi">soluk gün = işe giriş öncesi / çalışma dönemi dışı</span>` : ""}</div>
  </div>`);
}

/** Seçilen her dönemin hakediş hesabı (dönemin tamamı için). Kutular açık gelir; kapalı kutu kağıda çıkmaz. */
function calisanHakedisBolumu(secim) {
  const kismiVar = secim.donemler.some((d) => d.gunler[0].gun < secim.bas || d.gunler.at(-1).gun > secim.bit);
  const b = el(`<div class="cg-bolum cg-hakedis"><h4>Hakedişinizin hesabı</h4>
    ${kismiVar ? `<div class="cg-not soluk" style="margin:0 0 8px">Hakediş her zaman dönemin tamamı için hesaplanır; seçtiğiniz aralık dönemin bir kısmını kapsasa da.</div>` : ""}</div>`);
  // Puantajla aynı sıra (eskiden yeniye): 2. yarının "ayın 1. yarısının neti" satırı 1. yarının hesabından sonra gelir.
  for (const d of secim.donemler) {
    const pb = d.paraBirimi;
    const ozet = d.odemeTuru === "Aylık" && d.yari === 2 && d.aySonu ? `ay sonu ${toplamMetni(d.aySonu)}` : `net ${para(d.net?.[pb] ?? 0, pb)}`;
    const det = el(`<details class="cg-hk" open><summary><b>${kacir(cgDonemKisa(d))}</b>
      <span class="soluk">${d.durum === "kapali" ? "kapandı" : "açık"}</span><span class="cg-hk-t">${kacir(ozet)}</span></summary></details>`);
    det.appendChild(calisanHakedisHtml(d));
    b.appendChild(det);
  }
  return b;
}

/** Bir dönemin hakediş hesabı (çalışanın diliyle). */
function calisanHakedisHtml(d) {
  const pb = d.paraBirimi;
  const aylik = d.odemeTuru === "Aylık", saatlik = d.odemeTuru === "Saatlik";
  const net = d.net?.[pb] ?? 0;
  const aySonuVar = aylik && d.yari === 2 && d.aySonu;

  // Hakediş satırları: [ad, formül, tutar (eksi = düşülen)]
  const s = [];
  if (aylik) {
    const yarim = Number(d.ucret) / 2;
    if (d.kural === 1) {
      s.push(["Maaşın yarısı", `${sayiMetni(d.ucret)} ${pb} ÷ 2`, yarim]);
      if (d.kesinti) s.push(["Eksik saat kesintisi", "", -d.kesinti]);
    } else if (Math.abs(d.tabanUcret - yarim) < 0.01) s.push(["Maaşın yarısı", `${sayiMetni(d.ucret)} ${pb} ÷ 2`, d.tabanUcret]);
    else s.push(["Maaş payı", "işte olduğunuz günler: günlük maaş × gün", d.tabanUcret]);
  } else if (saatlik) {
    s.push(["Çalıştığınız saat", `${sayiMetni(d.normal)} saat × ${sayiMetni(d.ucret)} ${pb}`, d.tabanUcret]);
  }
  if (d.mesai) s.push(["Mesai", `${sayiMetni(d.mesai)} saat × ${sayiMetni(d.mesaiBirim)} ${pb}`, d.mesaiTutar]);
  const dusulmeyen = [];
  if (d.kural !== 1) {
    for (const kl of d.kesintiKalem || []) {
      if (kl.dusulmedi) { dusulmeyen.push(`${kl.ad.toLocaleLowerCase("tr")} ${para(kl.tutar, kl.pb)}`); continue; }
      s.push([`Kesinti: ${kl.ad.toLocaleLowerCase("tr")}`, kl.formul, -kl.tutar]);
    }
  }
  // Avans: para birimine göre
  const avansPB = {};
  for (const a of d.avans) (avansPB[a.paraBirimi] ||= []).push(a);
  for (const [apb, liste] of Object.entries(avansPB)) {
    const toplam = liste.reduce((t, a) => t + a.tutar, 0);
    const tarihler = liste.map((a) => tarihKisa(a.tarih).slice(0, 5)).join(", ");
    const c = apb === pb ? null : d.avansCevrilen.find((x) => x.pb === apb);
    if (apb === pb) s.push(["Aldığınız avans", tarihler, -toplam]);
    else if (c) s.push(["Aldığınız avans", `${tarihler} · ${c.formul}`, -c.cevrilen]);
    else dusulmeyen.push(`avans ${para(toplam, apb)} (${tarihler})`);
  }
  const cevrildi = (d.kesintiKalem || []).some((x) => x.kaynak) || d.avansCevrilen.length;

  return el(`<div class="cg-donem-govde">
    <div class="cg-durum">${kacir(d.ad)} · ${d.durum === "kapali" ? "dönem kapandı" : "dönem açık; puantaj işlendikçe değişebilir"}${
      aySonuVar ? " · ay sonu tutarı sonraki ayın 1'inde ödenir" : aylik ? " · aylık maaş ay sonunda ödenir"
        : saatlik ? " · saatlik ücret dönem kapanınca ödenir" : ""}</div>
    <table class="cg-hesap"><tbody>
      ${s.map(([ad, f, t]) => `<tr class="${t < 0 ? "eksi" : ""}"><td>${kacir(ad)}</td><td class="f">${kacir(f)}</td>
        <td class="t">${t < 0 ? "− " : ""}${kacir(para(Math.abs(t), pb))}</td></tr>`).join("")}
    </tbody><tfoot>
      <tr><td colspan="2">${aySonuVar ? "Bu yarının neti" : "Net"}</td><td class="t">${kacir(para(net, pb))}</td></tr>
      ${aySonuVar && d.ilkYariNet ? `<tr class="ara"><td colspan="2">Ayın 1. yarısının neti</td><td class="t">+ ${kacir(toplamMetni(d.ilkYariNet))}</td></tr>
        <tr class="son"><td colspan="2">Ay sonunda alacağınız</td><td class="t">${kacir(toplamMetni(d.aySonu))}</td></tr>` : ""}
    </tfoot></table>
    ${dusulmeyen.length ? `<div class="cg-not">Maaşınızdan düşülmeyen, yöneticinizin ayrıca netleştireceği kalemler: ${kacir(dusulmeyen.join(", "))}.</div>` : ""}
    ${cevrildi && d.kur ? `<div class="cg-not soluk">Farklı para birimindeki tutarlar dönemin kuruyla çevrildi: ${kacir(kurMetni(d.kur))}.</div>` : ""}
  </div>`);
}

/* ---------------- açılır menü ---------------- */

let acilirKapatici = null;

function acilirKapat() {
  document.querySelector(".acilir")?.remove();
  if (acilirKapatici) { document.removeEventListener("mousedown", acilirKapatici, true); document.removeEventListener("keydown", acilirKapatici, true); }
  acilirKapatici = null;
}

/** Bir öğenin yanında küçük bir menü açar. */
function acilirAc(capa, html) {
  acilirKapat();
  const a = el(`<div class="acilir">${html}</div>`);
  document.body.appendChild(a);
  const r = capa.getBoundingClientRect();
  const sol = Math.max(8, Math.min(r.left, innerWidth - a.offsetWidth - 8));
  const ust = r.bottom + a.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - a.offsetHeight - 4) : r.bottom + 4;
  a.style.left = `${sol}px`; a.style.top = `${ust}px`;
  acilirKapatici = (ev) => {
    if (ev.type === "keydown" ? ev.key === "Escape" : !a.contains(ev.target)) acilirKapat();
  };
  setTimeout(() => {
    document.addEventListener("mousedown", acilirKapatici, true);
    document.addEventListener("keydown", acilirKapatici, true);
  }, 0);
  return a;
}

/* ---------------- PUANTAJ ---------------- */

const PT = { paket: null, filtre: { ekip: "", proje: "", ara: "" }, kuyruk: Promise.resolve() };
const GUN_TIP_AD = { normal: "Normal gün", mesai: "Mesai günü", tatil: "Tatil" };
const iki = (n) => String(n).padStart(2, "0");
const bugunStr = () => { const d = new Date(); return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`; };
const tarihDonemi = (t) => `${t.slice(0, 7)}-${+t.slice(8, 10) <= 15 ? 1 : 2}`;
const saatMetni = (n) => (n ? sayiMetni(n) : "0");
const ptKapali = () => PT.paket?.kayit?.durum === "kapali";
const ptSatir = (kod) => PT.paket.kayit.satirlar.find((s) => s.personelKod === kod);
const ptEkipAdi = (kod) => PT.paket.kayit.ekipler[kod]?.ad || kayitlar("ekip").find((e) => e.kod === kod)?.ad || "";

function ptGorunen() {
  const { kayit } = PT.paket;
  const { ekip, proje, ara } = PT.filtre;
  const q = ara.trim().toLocaleLowerCase("tr");
  return kayit.satirlar.filter((s) => {
    const ekipler = [s.ekip, ...Object.values(s.ekipGun)];
    if (ekip && !ekipler.includes(ekip)) return false;
    if (proje && !ekipler.some((e) => kayit.ekipler[e]?.proje === proje) && s.proje !== proje) return false;
    if (q && !`${s.ad} ${s.personelKod}`.toLocaleLowerCase("tr").includes(q)) return false;
    return true;
  });
}

function ptOzetSutunlari() {
  const tek = (h, v) => (v ? { [h.paraBirimi]: v } : {});
  return [
    { k: "toplam", b: "Toplam", saat: (h) => h.toplam, f: (h) => `<b>${saatMetni(h.toplam)}</b>` },
    { k: "normal", b: "Normal", saat: (h) => h.normal, f: (h) => saatMetni(h.normal) },
    { k: "mesai", b: "Mesai", saat: (h) => h.mesai, f: (h) => (h.mesai ? `<span class="vurgu">${saatMetni(h.mesai)}</span>` : "0") },
    { k: "eksik", b: "Eksik", saat: (h) => h.eksik, f: (h) => (h.eksik ? `<span class="kotu">${saatMetni(h.eksik)}</span>` : "0") },
    { k: "gelmedi", b: "Gelmedi", saat: (h) => h.gelmedi, f: (h) => (h.gelmedi ? `<span class="kotu">${h.gelmedi} gün</span>` : "0") },
    { k: "hakedis", b: "Hakediş", para: (h) => tek(h, h.hakedis), f: (h) => (h.hakedis ? toplamMetni(tek(h, h.hakedis)) : `<span class="soluk">—</span>`) },
    { k: "kesinti", b: "Kesinti", para: (h) => tek(h, h.kesinti), f: (h) => (h.kesinti || Object.keys(h.kesintiDisi || {}).length
      ? `<span class="kotu kd-ac" data-kd title="${kacir(kesintiIpucu(h))}">${h.kesinti ? toplamMetni(tek(h, h.kesinti)) : "0"}${Object.keys(h.kesintiDisi || {}).length ? " *" : ""}</span>`
      : `<span class="soluk">—</span>`) },
    { k: "avans", b: "Avans", para: (h) => h.avans, f: (h) => toplamMetni(h.avans) },
    { k: "net", b: "Net", para: (h) => h.net, f: (h) => `<b>${toplamMetni(h.net)}</b>` },
    ...(PT.paket.donem.endsWith("-2")
      ? [{ k: "aySonu", b: "Ay Sonu Ödenecek", para: (h) => h.aySonu, f: (h) => `<b class="vurgu">${toplamMetni(h.aySonu)}</b>` }]
      : []),
  ];
}

/** Kesintinin formül formül dökümü (puantaj, personel kartı). */
function kesintiSatirlari(h) {
  if (h.kural === 1) return [`Eksik ${saatMetni(h.eksik)} saat × saat değeri ${sayiMetni(h.saatDegeri)} ${h.paraBirimi} (eski kural)`];
  return (h.kesintiKalem || []).map((k) =>
    `${k.ad}: ${k.formul} = ${sayiMetni(k.tutar)} ${k.pb}${k.dusulmedi ? ` (${k.dusulmedi}; maaştan düşülmedi)` : ""}`);
}

/** Kesinti hücresinin üzerine gelince görünen kısa döküm. */
function kesintiIpucu(h) {
  const sat = kesintiSatirlari(h);
  if (h.kural !== 1 && h.kesinti) sat.push(`Toplam: ${sayiMetni(h.kesinti)} ${h.paraBirimi}`, "Ayrıntı için tıklayın");
  return sat.join("\n");
}

/** Kesinti hücresine tıklayınca açılan döküm: kalem kalem formül, toplam, çevrilen avans ve dönemin kuru. */
function ptKesintiAc(capa, kod) {
  const h = PT.paket.hesap.satirlar.find((x) => x.personelKod === kod);
  const s = ptSatir(kod);
  if (!h || !s) return;
  const pb = h.paraBirimi;
  const govde = h.kural === 1
    ? `<div class="acilir-not">${kacir(kesintiSatirlari(h)[0])}</div>`
    : `<table class="kd-tablo"><tbody>${(h.kesintiKalem || []).map((k) => `<tr class="${k.dusulmedi ? "dusulmedi" : ""}">
        <td>${kacir(k.ad)}</td><td class="kd-f">${kacir(k.formul)}</td>
        <td class="kd-t">${sayiMetni(k.tutar)} ${kacir(k.pb)}${k.dusulmedi ? `<div class="kd-not">${kacir(k.dusulmedi)}, düşülmedi</div>` : ""}</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="2">Toplam kesinti</td><td class="kd-t">${sayiMetni(h.kesinti)} ${kacir(pb)}</td></tr></tfoot></table>
      ${(h.avansCevrilen || []).map((a) => `<div class="acilir-not">Avans: ${kacir(a.formul)} = ${sayiMetni(a.cevrilen)} ${kacir(pb)}</div>`).join("")}
      <div class="acilir-not soluk">${h.gelmedi} gün gelmedi · ${h.kur ? `dönemin kuru: ${kacir(kurMetni(h.kur))}` : "bu dönemde kur çevirisi yok"}</div>`;
  const a = acilirAc(capa, `<div class="acilir-bas">${kacir(s.ad)} · kesinti dökümü</div>${govde}`);
  a.classList.add("genis");
}

function ptHucreSinif(s, gun) {
  const tip = PT.paket.kayit.gunler[gun] || "normal";
  const v = s.hucre[gun] || "";
  const c = ["hc", `t-${tip}`];
  if (v === "İ") c.push("v-izin"); else if (v === "R") c.push("v-rapor"); else if (v === "–") c.push("v-gelmedi");
  if (s.ekipGun[gun]) c.push("baska-ekip");
  const k2 = (PT.paket.kayit.kural || 1) >= 2;
  if (k2 && ((s.iseGiris && gun < s.iseGiris) || (s.calisma && !s.calisma.some(([b, e]) => gun >= b && (!e || gun <= e))))) c.push("giris-oncesi");
  // Eski kuralda boş geçmiş gün eksik sayılır (kırmızı); yeni kuralda sadece "–" kesinti doğurur.
  else if (!k2 && !v && tip === "normal" && (ptKapali() || gun <= bugunStr())) c.push("bos-gecmis");
  return c.join(" ");
}

async function puantajCiz(donem) {
  if (!donem) { location.replace(`#puantaj/${tarihDonemi(bugunStr())}`); return; }
  ana.innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;
  await kaynaklariYukle();
  let p;
  try { p = await api(`/puantaj/${donem}`); }
  catch (e) { ana.innerHTML = `<div class="bos"><div class="bs">Dönem açılamadı</div><p>${kacir(e.message)}</p></div>`; return; }
  PT.paket = p;

  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas"><div><h2>Puantaj</h2>
    <p>Hücreye saat yazın; <b>İ</b> izin, <b>R</b> rapor, <b>–</b> gelmedi. Gün başlığına tıklayarak gün tipini,
    hücreye sağ tıklayarak o günün ekibini değiştirirsiniz. Excel'den kopyalanan bloklar doğrudan yapıştırılabilir.</p></div></div>`));

  const durum = p.kayit ? p.kayit.durum : "yok";
  const cubuk = el(`<div class="donem-cubugu">
    <a class="dg ok-dg" href="#puantaj/${p.onceki}" title="Önceki dönem">‹</a>
    <div class="donem-ad">${kacir(p.ad)}<span class="durum-pul ${durum}">${{ acik: "açık", kapali: "kapalı", yok: "açılmadı" }[durum]}</span></div>
    <a class="dg ok-dg" href="#puantaj/${p.sonraki}" title="Sonraki dönem">›</a>
    ${p.donem !== p.buDonem ? `<a class="dg ufak" href="#puantaj/${p.buDonem}">Bu döneme git</a>` : ""}
    <div class="bas-arac">${p.kayit ? `
      ${durum === "acik" ? `<button class="dg" data-is="kisi">+ Kişi ekle</button>` : ""}
      <button class="dg" data-is="excel-in">Excel'e aktar</button>
      ${durum === "acik" ? `<button class="dg" data-is="excel-yuk">Excel'den yükle</button>` : ""}
      ${durum === "acik" ? `<button class="dg bas" data-is="kapat">Dönemi kapat</button>` : `<button class="dg" data-is="ac">Dönemi yeniden aç</button>`}
    ` : ""}</div></div>`);
  ana.appendChild(cubuk);

  if (p.yok) return ptAcilmamisCiz(p);

  const filtre = el(`<div class="pt-filtre">
    <select data-f="ekip"><option value="">Tüm ekipler</option>
      ${Object.entries(p.kayit.ekipler).map(([k, e]) => `<option value="${kacir(k)}">${kacir(`${k} — ${e.ad}`)}</option>`).join("")}</select>
    <select data-f="proje"><option value="">Tüm projeler</option>
      ${[...new Map(Object.values(p.kayit.ekipler).filter((e) => e.proje).map((e) => [e.proje, e.projeAd])).entries()]
        .map(([k, a]) => `<option value="${kacir(k)}">${kacir(a || k)}</option>`).join("")}</select>
    <div class="ara-kutu"><input data-f="ara" placeholder="Kişi ara…"></div>
    <div class="lejant">
      <span class="lj t-mesai">mesai günü</span><span class="lj t-tatil">tatil</span>
      <span class="lj v-izin">İ izin</span><span class="lj v-rapor">R rapor</span><span class="lj v-gelmedi">– gelmedi</span>
      ${(p.kayit?.kural || 1) >= 2 ? `<span class="lj giris-oncesi" title="Bu günler hesaba girmez">işe giriş öncesi / çalışma dönemi dışı</span>` : `<span class="lj bos-gecmis">girilmemiş (eksik sayılır)</span>`}<span class="lj baska-ekip">başka ekip</span></div>
  </div>`);
  for (const s of filtre.querySelectorAll("[data-f]")) {
    s.value = PT.filtre[s.dataset.f] || "";
    s.addEventListener(s.tagName === "INPUT" ? "input" : "change", () => { PT.filtre[s.dataset.f] = s.value; ptIzgaraCiz(); });
  }
  ana.appendChild(filtre);

  const cekmeceAcik = localStorage.getItem("kadro-cekmece") !== "0";
  const duzen = el(`<div class="pt-duzen ${cekmeceAcik ? "cekmece-acik" : ""}">
    <div class="pt-sol"><div id="kapaliBant"></div><div class="pt-sar"><table class="pt"></table></div></div>
    <aside class="cekmece"></aside></div>`);
  ana.appendChild(duzen);

  ptAracBagla(cubuk);
  ptKapaliBantCiz();
  ptIzgaraCiz();
  ptCekmeceCiz();
}

function ptAcilmamisCiz(p) {
  const o = p.onizleme;
  const k = el(`<div class="kart"><div class="kart-govde acilmamis">
    <div class="bs">Bu dönem henüz açılmadı</div>
    <p>Dönem açılınca <b>${o.kisi}</b> kişinin maaşı, ekibi, ekiplerin yemek tutarı ve ev kira payları bu döneme kopyalanır.
      Bundan sonra yapılan maaş değişiklikleri bu dönemi etkilemez; sadece yeni açılan dönemlere yansır.</p>
    ${metrikler([[String(o.kisi), "Kişi"], [String(o.ekip), "Ekip"], [String(o.ekipsiz), "Ekipsiz kişi"], [String(o.maassiz.length), "Maaşı girilmemiş"]])}
    ${o.maassiz.length ? `<div class="o-not">Maaşı girilmemiş kişilerin hakedişi hesaplanmaz: ${kacir(o.maassiz.join(", "))}.
      Dönemi açmadan önce <a href="#t/personel">Personel</a> tablosundan girebilirsiniz.</div>` : ""}
    <p class="soluk">${o.oncekiAyar
      ? `Mesai ayarları önceki dönemden devralınır: çarpan ${kacir(o.oncekiAyar.mesaiCarpani)}, normal gün ${kacir(o.oncekiAyar.normalSaat)} saat.`
      : "Varsayılan mesai ayarları: çarpan 1,5, normal gün 8 saat. Cumartesi mesai günü, Pazar tatil."} Hepsi yan panelden değiştirilebilir.</p>
    <button class="dg bas" data-ac>Dönemi aç</button>
  </div></div>`);
  k.querySelector("[data-ac]").onclick = async (ev) => {
    ev.target.disabled = true;
    try { await api(`/puantaj/${p.donem}`, { method: "POST" }); bildir("Dönem açıldı", p.ad, "iyi"); await yonlendir(); }
    catch (e) { hataBildir(e); ev.target.disabled = false; }
  };
  ana.appendChild(k);
}

function ptKapaliBantCiz() {
  const b = document.getElementById("kapaliBant");
  const k = PT.paket.kayit;
  if (!b) return;
  if (k.durum !== "kapali") { b.innerHTML = ""; return; }
  const kp = k.kapanis || {};
  b.innerHTML = `<div class="kapali-bant">Bu dönem ${kacir(kp.tarih ? new Date(kp.tarih).toLocaleString("tr-TR") : "")} tarihinde
    ${kacir(kp.kullanici || "")} tarafından kapatıldı; hücreler kilitli.
    ${kp.dosya ? `Excel: <code>${kacir(kp.dosya)}</code> <button class="dg ufak" data-klasor>Klasörü aç</button>` : ""}</div>`;
  b.querySelector("[data-klasor]")?.addEventListener("click", async () => {
    try { await api("/klasor-ac", { method: "POST", body: JSON.stringify({ yol: kp.dosya.split("/").slice(0, -1).join("/") }) }); }
    catch (e) { hataBildir(e); }
  });
}

function ptAracBagla(cubuk) {
  const p = PT.paket;
  const is = (ad, f) => cubuk.querySelector(`[data-is="${ad}"]`)?.addEventListener("click", f);
  is("excel-in", () => { location.href = `/api/puantaj/${p.donem}/excel`; });
  is("excel-yuk", () => {
    const g = el(`<input type="file" accept=".xlsx" hidden>`);
    g.onchange = async () => {
      if (!g.files[0]) return;
      const fd = new FormData(); fd.append("dosya", g.files[0]);
      try {
        const r = await api(`/puantaj/${p.donem}/excel`, { method: "POST", body: fd });
        PT.paket = r; ptIzgaraCiz();
        bildir("Excel içe aktarıldı", `${r.rapor.degisen} hücre güncellendi.` +
          (r.rapor.bilinmeyen.length ? ` Bu dönemde olmayan ${r.rapor.bilinmeyen.length} kişi atlandı: ${r.rapor.bilinmeyen.join(", ")}` : ""), "iyi");
      } catch (e) { hataBildir(e); }
    };
    g.click();
  });
  is("kapat", async () => {
    const ok = await onay("Dönem kapatılsın mı?",
      "Dönem kilitlenir, boş bırakılan normal günler eksik saat sayılır ve dönemin Excel dosyası 02 - Muhasebe / Maaşlar / Puantaj klasörüne yazılır. " +
      `Saatlik çalışanların${p.donem.endsWith("-2") ? " ve aylık maaşlıların (ay sonu)" : ""} ödemesi Ödemeler ekranında "bekliyor" olarak görünür; ödendi işaretlenince kasaya düşer. ` +
      "Gerekirse dönemi yeniden açabilirsiniz.",
      "Dönemi kapat");
    if (!ok) return;
    try {
      const r = await api(`/puantaj/${p.donem}/kapat`, { method: "POST" });
      if (r.dosyaHatasi) bildir("Dönem kapandı", r.dosyaHatasi, "hata"); else bildir("Dönem kapandı", r.dosya, "iyi");
      bildir("Ödemeler hazır", "Maaş ödemeleri Ödemeler ekranında ödendi işaretini bekliyor.", "iyi");
      await durumYukle();
      S.agac = null; await yonlendir();
    } catch (e) { hataBildir(e); }
  });
  is("ac", async () => {
    const ok = await onay("Dönem yeniden açılsın mı?", "Hücreler tekrar düzenlenebilir olur. Kapanışta yazılan Excel dosyası yerinde kalır; tekrar kapattığınızda güncellenir. " +
      "Bu dönemin maaş kalemleri Ödemeler ekranından kalkar; ödendi işaretlenmiş olanların kaydı ve kasa satırı durur. Tekrar kapatınca kalemler yeniden oluşur.", "Yeniden aç");
    if (!ok) return;
    try {
      const r = await api(`/puantaj/${p.donem}/ac`, { method: "POST" });
      bildir("Dönem yeniden açıldı", r.kasa?.silinen ? `Kasadan ${r.kasa.silinen} otomatik satır kaldırıldı.` : "", "iyi");
      await yonlendir();
    }
    catch (e) { hataBildir(e); }
  });
  is("kisi", (ev) => {
    const varolan = new Set(p.kayit.satirlar.map((s) => s.personelKod));
    const adaylar = kayitlar("personel").filter((x) => x.durum !== "Ayrıldı" && !varolan.has(x.kod));
    const a = acilirAc(ev.currentTarget, `<div class="acilir-bas">Döneme kişi ekle</div>
      <div class="acilir-not">Kişi bugünkü maaşı ve ekibiyle eklenir.</div>
      <select>${adaylar.length ? adaylar.map((x) => `<option value="${kacir(x.kod)}">${kacir(`${x.kod} — ${x.ad}`)}</option>`).join("") : `<option value="">Eklenecek kimse yok</option>`}</select>
      <button class="dg ufak bas" ${adaylar.length ? "" : "disabled"}>Ekle</button>`);
    a.querySelector("button").onclick = async () => {
      const kod = a.querySelector("select").value;
      if (!kod) return;
      acilirKapat();
      try { PT.paket = await api(`/puantaj/${p.donem}/satir`, { method: "POST", body: JSON.stringify({ personelKod: kod }) }); ptIzgaraCiz(); bildir("Kişi eklendi", kod, "iyi"); }
      catch (e) { hataBildir(e); }
    };
  });
}

function ptIzgaraCiz() {
  const tablo = ana.querySelector("table.pt");
  if (!tablo || !PT.paket?.kayit) return;
  const { gunler, kayit } = PT.paket;
  const kapali = ptKapali();
  const bugun = bugunStr();
  const ozetSut = ptOzetSutunlari();
  const satirlar = ptGorunen();
  const genis = gunler.length + ozetSut.length + 1;

  let h = `<thead><tr><th class="s1">Personel</th><th class="s2">Ekip</th>`;
  gunler.forEach((g, i) => {
    const tip = kayit.gunler[g.gun];
    h += `<th class="gun t-${tip} ${g.gun === bugun ? "bugun" : ""}" data-c="${i}" title="${GUN_TIP_AD[tip]}${kapali ? "" : " — değiştirmek için tıklayın"}">
      <b>${g.no}</b><span>${g.kisa}</span></th>`;
  });
  h += ozetSut.map((o) => `<th class="oz">${o.b}</th>`).join("") + `<th class="islem"></th></tr></thead><tbody>`;

  let sonEkip = null, r = 0;
  for (const s of satirlar) {
    if (s.ekip !== sonEkip) {
      sonEkip = s.ekip;
      const e = kayit.ekipler[s.ekip];
      const n = satirlar.filter((x) => x.ekip === s.ekip).length;
      h += `<tr class="grup"><td class="s1" colspan="2">${s.ekip ? `${kacir(s.ekip)} · ${kacir(e?.ad || "")}` : "Ekipsiz"}</td>
        <td colspan="${genis}">${e?.projeAd ? `${kacir(e.projeAd)} · ` : ""}${n} kişi${e?.yemekGunluk ? ` · yemek ${sayiMetni(e.yemekGunluk)} ${kacir(e.yemekPB)} / kişi / gün` : ""}</td></tr>`;
    }
    h += `<tr data-p="${kacir(s.personelKod)}"><td class="s1"><div class="kisi"><span class="ad">${kacir(s.ad)}</span>
      <span class="alt">${kacir(s.personelKod)} · ${kacir(s.odemeTuru ? `${s.odemeTuru} ${sayiMetni(s.ucret)} ${s.paraBirimi}` : "maaş yok")}</span></div></td>
      <td class="s2">${kacir(s.ekip || "—")}</td>`;
    gunler.forEach((g, c) => {
      h += `<td class="${ptHucreSinif(s, g.gun)}"><input class="h" data-r="${r}" data-c="${c}" data-g="${g.gun}" value="${kacir(s.hucre[g.gun] || "")}" ${kapali ? "readonly" : ""} maxlength="5" autocomplete="off"></td>`;
    });
    h += ozetSut.map((o) => `<td class="oz" data-o="${o.k}"></td>`).join("") +
      `<td class="islem"><button class="sat-menu" title="Satır işlemleri">⋯</button></td></tr>`;
    r += 1;
  }
  if (!satirlar.length) {
    h += `<tr><td colspan="${genis + 2}"><div class="bos"><div class="bs">${kayit.satirlar.length ? "Filtreye uyan kişi yok" : "Bu dönemde kimse yok"}</div>
      <p>${kayit.satirlar.length ? "Ekip, proje ya da arama filtresini değiştirin." : "Sağ üstteki \"+ Kişi ekle\" ile kişi ekleyebilirsiniz."}</p></div></td></tr>`;
  }
  h += `</tbody><tfoot><tr><td class="s1">Toplam · ${satirlar.length} kişi</td><td class="s2"></td>
    ${gunler.map((g, i) => `<td class="gun-top" data-c="${i}"></td>`).join("")}
    ${ozetSut.map((o) => `<td class="oz" data-ot="${o.k}"></td>`).join("")}<td></td></tr></tfoot>`;
  tablo.innerHTML = h;
  ptDegerleriTazele();
  ptTabloBagla(tablo);
}

/** Hesaplanan hücreleri, toplamları ve paneli tablo baştan çizilmeden tazeler. */
function ptDegerleriTazele() {
  const tablo = ana.querySelector("table.pt");
  if (!tablo) return;
  const { kayit, hesap, gunler } = PT.paket;
  const hesapMap = new Map(hesap.satirlar.map((x) => [x.personelKod, x]));
  const ozetSut = ptOzetSutunlari();
  const aktif = document.activeElement;
  const gunTop = gunler.map(() => 0);
  const alt = Object.fromEntries(ozetSut.map((o) => [o.k, o.saat ? 0 : {}]));

  tablo.querySelectorAll("tbody tr[data-p]").forEach((tr) => {
    const s = ptSatir(tr.dataset.p);
    const h = hesapMap.get(tr.dataset.p);
    if (!s || !h) return;
    tr.querySelectorAll("input.h").forEach((inp) => {
      const g = inp.dataset.g;
      const v = s.hucre[g] || "";
      if (inp !== aktif) inp.value = v;
      inp.dataset.v = v;
      const td = inp.parentElement;
      td.className = ptHucreSinif(s, g);
      td.title = s.ekipGun[g] ? `Bu gün ekibi: ${s.ekipGun[g]} ${ptEkipAdi(s.ekipGun[g])}` : "";
      if (/^\d/.test(v)) gunTop[+inp.dataset.c] += Number(v);
    });
    for (const o of ozetSut) {
      tr.querySelector(`[data-o="${o.k}"]`).innerHTML = o.f(h);
      if (o.saat) alt[o.k] += o.saat(h);
      else for (const [pb, v] of Object.entries(o.para(h) || {})) alt[o.k][pb] = (alt[o.k][pb] || 0) + v;
    }
    tr.classList.toggle("uyarili", h.uyari.length > 0);
    tr.querySelector(".s1").title = h.uyari.join("\n");
  });
  tablo.querySelectorAll("tfoot .gun-top").forEach((td) => { const v = gunTop[+td.dataset.c]; td.textContent = v ? sayiMetni(v) : ""; });
  for (const o of ozetSut) {
    const td = tablo.querySelector(`tfoot [data-ot="${o.k}"]`);
    if (td) td.innerHTML = o.saat ? sayiMetni(alt[o.k]) : toplamMetni(alt[o.k]);
  }
  ptCekmeceTazele();
}

/** Hücre değişikliklerini sırayla kaydeder (hızlı yazımda yarış olmasın). */
function ptKaydet(degisiklikler, mesaj) {
  const donem = PT.paket.donem;
  PT.kuyruk = PT.kuyruk.then(async () => {
    try {
      PT.paket = await api(`/puantaj/${donem}/hucre`, { method: "PUT", body: JSON.stringify({ degisiklikler }) });
      ptDegerleriTazele();
      if (mesaj) bildir(mesaj, "", "iyi");
    } catch (e) {
      hataBildir(e);
      ptDegerleriTazele(); // geçersiz değeri geri al
      const tablo = ana.querySelector("table.pt");
      for (const d of degisiklikler) {
        const inp = tablo?.querySelector(`tr[data-p="${d.personelKod}"] input[data-g="${d.gun}"]`);
        if (inp) inp.value = inp.dataset.v;
      }
    }
  });
  return PT.kuyruk;
}

function ptTabloBagla(tablo) {
  if (tablo.dataset.bagli) return;
  tablo.dataset.bagli = "1";
  const odak = (r, c) => { const i = tablo.querySelector(`input.h[data-r="${r}"][data-c="${c}"]`); if (i) { i.focus(); return true; } return false; };

  tablo.addEventListener("focusin", (ev) => { if (ev.target.matches("input.h")) ev.target.select(); });

  tablo.addEventListener("keydown", (ev) => {
    const inp = ev.target.closest("input.h");
    if (!inp) return;
    const r = +inp.dataset.r, c = +inp.dataset.c;
    const tamSecili = inp.selectionStart === 0 && inp.selectionEnd === inp.value.length;
    if (ev.key === "Escape") { inp.value = inp.dataset.v; inp.blur(); return; }
    // Son satırda Enter: alt hücre yok, kaydetmek için hücreden çık (change olayı tetiklenir).
    if (ev.key === "Enter") { ev.preventDefault(); if (!odak(r + 1, c)) inp.blur(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); odak(r + 1, c); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); odak(r - 1, c); }
    else if (ev.key === "ArrowRight" && (tamSecili || inp.selectionStart === inp.value.length)) { ev.preventDefault(); odak(r, c + 1); }
    else if (ev.key === "ArrowLeft" && (tamSecili || inp.selectionStart === 0)) { ev.preventDefault(); odak(r, c - 1); }
  });

  tablo.addEventListener("change", (ev) => {
    const inp = ev.target.closest("input.h");
    if (!inp || ptKapali() || inp.value.trim() === inp.dataset.v) return;
    ptKaydet([{ personelKod: inp.closest("tr").dataset.p, gun: inp.dataset.g, deger: inp.value }]);
  });

  // Excel'den kopyalanan blok: sekme ve satır sonlarına göre hücrelere dağıtılır.
  tablo.addEventListener("paste", (ev) => {
    const inp = ev.target.closest("input.h");
    if (!inp || ptKapali()) return;
    const metin = (ev.clipboardData?.getData("text") || "").replace(/\r/g, "").replace(/\n+$/, "");
    if (!/[\t\n]/.test(metin)) return;
    ev.preventDefault();
    const r0 = +inp.dataset.r, c0 = +inp.dataset.c;
    const degisiklikler = [];
    metin.split("\n").forEach((satir, i) => satir.split("\t").forEach((v, j) => {
      const hedef = tablo.querySelector(`input.h[data-r="${r0 + i}"][data-c="${c0 + j}"]`);
      if (hedef) degisiklikler.push({ personelKod: hedef.closest("tr").dataset.p, gun: hedef.dataset.g, deger: v.trim() });
    }));
    if (degisiklikler.length) ptKaydet(degisiklikler, `${degisiklikler.length} hücre yapıştırıldı`);
  });

  tablo.addEventListener("click", (ev) => {
    const th = ev.target.closest("th.gun");
    if (th) return ptGunMenusu(th);
    const b = ev.target.closest(".sat-menu");
    if (b) return ptSatirMenusu(b, b.closest("tr").dataset.p);
    const kd = ev.target.closest("[data-kd]");
    if (kd) return ptKesintiAc(kd, kd.closest("tr").dataset.p);
  });

  tablo.addEventListener("contextmenu", (ev) => {
    const td = ev.target.closest("td.hc");
    if (!td || ptKapali()) return;
    ev.preventDefault();
    const inp = td.querySelector("input");
    ptHucreMenusu(td, inp.closest("tr").dataset.p, inp.dataset.g);
  });
}

function ptGunMenusu(th) {
  const g = PT.paket.gunler[+th.dataset.c];
  const tip = PT.paket.kayit.gunler[g.gun];
  const gorunen = ptGorunen();
  const ns = PT.paket.kayit.ayar.normalSaat;
  const kapali = ptKapali();
  const a = acilirAc(th, `<div class="acilir-bas">${g.no} ${PT.paket.ad.split(" · ")[0]} · ${g.kisa}</div>
    <div class="secenek-grup">${["normal", "mesai", "tatil"].map((t) =>
      `<button class="sec ${t === tip ? "aktif" : ""}" data-tip="${t}" ${kapali ? "disabled" : ""}>${GUN_TIP_AD[t]}</button>`).join("")}</div>
    ${kapali ? `<div class="acilir-not">Dönem kapalı.</div>` : `
    <div class="acilir-not">Aşağıdakiler görünen ${gorunen.length} kişiye uygulanır.</div>
    <button class="og" data-is="doldur">Boş hücrelere ${sayiMetni(ns)} saat yaz</button>
    <button class="og" data-is="kopyala" ${+th.dataset.c === 0 ? "disabled" : ""}>Önceki günü kopyala</button>
    <button class="og tehlike" data-is="temizle">Sütunu temizle</button>`}`);
  a.querySelectorAll("[data-tip]").forEach((b) => b.onclick = async () => {
    acilirKapat();
    try { PT.paket = await api(`/puantaj/${PT.paket.donem}/ayar`, { method: "PUT", body: JSON.stringify({ gunler: { [g.gun]: b.dataset.tip } }) }); ptIzgaraCiz(); }
    catch (e) { hataBildir(e); }
  });
  const uygula = (fn, mesaj) => {
    acilirKapat();
    const d = gorunen.map((s) => fn(s)).filter(Boolean);
    if (d.length) ptKaydet(d, mesaj); else bildir("Değişecek hücre yok", "", "");
  };
  a.querySelector('[data-is="doldur"]')?.addEventListener("click", () =>
    uygula((s) => (!s.hucre[g.gun] ? { personelKod: s.personelKod, gun: g.gun, deger: String(ns) } : null), "Boş hücreler dolduruldu"));
  a.querySelector('[data-is="kopyala"]')?.addEventListener("click", () => {
    const onceki = PT.paket.gunler[+th.dataset.c - 1].gun;
    uygula((s) => ((s.hucre[onceki] || "") !== (s.hucre[g.gun] || "") ? { personelKod: s.personelKod, gun: g.gun, deger: s.hucre[onceki] || "" } : null), "Önceki gün kopyalandı");
  });
  a.querySelector('[data-is="temizle"]')?.addEventListener("click", () =>
    uygula((s) => (s.hucre[g.gun] ? { personelKod: s.personelKod, gun: g.gun, deger: "" } : null), "Sütun temizlendi"));
}

function ekipSecenekleri(secili) {
  const kodlar = new Map(Object.entries(PT.paket.kayit.ekipler).map(([k, e]) => [k, e.ad]));
  for (const e of kayitlar("ekip")) if (!kodlar.has(e.kod)) kodlar.set(e.kod, e.ad);
  return [...kodlar].map(([k, ad]) => `<option value="${kacir(k)}" ${k === secili ? "selected" : ""}>${kacir(`${k} — ${ad}`)}</option>`).join("");
}

async function ptEkipGun(kod, gunler, ekip) {
  try {
    PT.paket = await api(`/puantaj/${PT.paket.donem}/ekip-gun`, { method: "PUT", body: JSON.stringify({ personelKod: kod, gunler, ekip }) });
    ptDegerleriTazele();
    bildir("Ekip ataması kaydedildi", `${gunler.length} gün · ${ekip || "kendi ekibi"}`, "iyi");
  } catch (e) { hataBildir(e); }
}

function ptHucreMenusu(td, kod, gun) {
  const s = ptSatir(kod);
  const g = PT.paket.gunler.find((x) => x.gun === gun);
  const ekip = s.ekipGun[gun] || s.ekip;
  const a = acilirAc(td, `<div class="acilir-bas">${kacir(s.ad)} · ${g.no} ${g.kisa}</div>
    <div class="secenek-grup">${[["İ", "İzin"], ["R", "Rapor"], ["–", "Gelmedi"], ["", "Temizle"]].map(([v, ad]) =>
      `<button class="sec" data-v="${v}">${v ? `<b>${v}</b> ` : ""}${ad}</button>`).join("")}</div>
    <label class="acilir-et">Bu günün ekibi</label>
    <select data-ekip><option value="">— ${kacir(s.ekip || "ekipsiz")} (kendi ekibi)</option>${ekipSecenekleri(ekip === s.ekip ? "" : ekip)}</select>
    <label class="onay-kutu"><input type="checkbox" data-sona> Dönemin sonuna kadar uygula</label>
    <button class="dg ufak bas" data-uygula>Ekibi uygula</button>`);
  a.querySelectorAll("[data-v]").forEach((b) => b.onclick = () => {
    acilirKapat();
    ptKaydet([{ personelKod: kod, gun, deger: b.dataset.v }]);
  });
  a.querySelector("[data-uygula]").onclick = () => {
    const sec = a.querySelector("[data-ekip]").value;
    const gunler = a.querySelector("[data-sona]").checked ? PT.paket.gunler.map((x) => x.gun).filter((x) => x >= gun) : [gun];
    acilirKapat();
    ptEkipGun(kod, gunler, sec);
  };
}

function ptSatirMenusu(dugme, kod) {
  const s = ptSatir(kod);
  const h = PT.paket.hesap.satirlar.find((x) => x.personelKod === kod);
  const ns = PT.paket.kayit.ayar.normalSaat;
  const kapali = ptKapali();
  const gunSec = (ad) => `<select data-${ad}>${PT.paket.gunler.map((g) => `<option value="${g.gun}">${g.no} ${g.kisa}</option>`).join("")}</select>`;
  const a = acilirAc(dugme, `<div class="acilir-bas">${kacir(s.ad)}</div>
    <div class="acilir-not">${kacir(s.odemeTuru ? `${s.odemeTuru} · ${sayiMetni(s.ucret)} ${s.paraBirimi}` : "Maaş girilmemiş")} — dönem açılırken kopyalandı.
      ${h.saatDegeri ? `Saat değeri ${sayiMetni(h.saatDegeri)} ${kacir(h.paraBirimi)}.` : ""} ${s.kiraPayi ? `Kira payı ${sayiMetni(s.kiraPayi)} ${kacir(s.kiraPB)}.` : ""}</div>
    ${h.uyari.map((u) => `<div class="acilir-not uyari">${kacir(u)}</div>`).join("")}
    <a class="og" href="#d/personel/${kayitlar("personel").find((x) => x.kod === kod)?._id || ""}">Personel kartını aç</a>
    ${kapali ? "" : `
    <button class="og" data-is="doldur">Boş normal günlere ${sayiMetni(ns)} saat yaz</button>
    <button class="og" data-is="ekip">Ekibi tarih aralığında değiştir…</button>
    <div class="aralik" hidden>
      <div class="ikili-kucuk">${gunSec("bas")}${gunSec("bit")}</div>
      <select data-ekip><option value="">— kendi ekibi (${kacir(s.ekip || "ekipsiz")})</option>${ekipSecenekleri("")}</select>
      <button class="dg ufak bas" data-uygula>Uygula</button></div>
    <button class="og tehlike" data-is="temizle">Satırı temizle</button>
    <button class="og tehlike" data-is="cikar">Dönemden çıkar</button>`}`);
  const is = (ad, f) => a.querySelector(`[data-is="${ad}"]`)?.addEventListener("click", f);
  is("doldur", () => {
    acilirKapat();
    const d = PT.paket.gunler.filter((g) => PT.paket.kayit.gunler[g.gun] === "normal" && !s.hucre[g.gun])
      .map((g) => ({ personelKod: kod, gun: g.gun, deger: String(ns) }));
    if (d.length) ptKaydet(d, `${d.length} gün dolduruldu`); else bildir("Boş normal gün yok", "", "");
  });
  is("ekip", () => {
    const ar = a.querySelector(".aralik");
    ar.hidden = false;
    ar.querySelector("[data-bit]").value = PT.paket.gunler.at(-1).gun;
    ar.querySelector("[data-uygula]").onclick = () => {
      const bas = ar.querySelector("[data-bas]").value, bit = ar.querySelector("[data-bit]").value;
      if (bas > bit) return bildir("Tarih aralığı ters", "Başlangıç günü bitişten sonra olamaz.", "hata");
      const gunler = PT.paket.gunler.map((g) => g.gun).filter((g) => g >= bas && g <= bit);
      acilirKapat();
      ptEkipGun(kod, gunler, ar.querySelector("[data-ekip]").value);
    };
  });
  is("temizle", async () => {
    acilirKapat();
    const d = Object.keys(s.hucre).map((g) => ({ personelKod: kod, gun: g, deger: "" }));
    if (!d.length) return;
    if (await onay("Satır temizlensin mi?", `${s.ad} için girilmiş ${d.length} hücre silinecek.`, "Temizle")) ptKaydet(d, "Satır temizlendi");
  });
  is("cikar", async () => {
    acilirKapat();
    if (!(await onay("Dönemden çıkarılsın mı?", `${s.ad} bu dönemin puantajından çıkarılacak. Personel kaydı silinmez.`, "Çıkar"))) return;
    try { PT.paket = await api(`/puantaj/${PT.paket.donem}/satir/${encodeURIComponent(kod)}`, { method: "DELETE" }); ptIzgaraCiz(); }
    catch (e) { hataBildir(e); }
  });
}

/* --- yan panel: istatistikler, mesai ayarları, hesap makinesi --- */

function ptCekmeceCiz() {
  const c = ana.querySelector(".cekmece");
  if (!c) return;
  let kapali = [];
  try { kapali = JSON.parse(localStorage.getItem("kadro-cekmece-bolum") || "[]"); } catch { /* yoksay */ }
  const bolum = (id, ad) => `<details data-b="${id}" ${kapali.includes(id) ? "" : "open"}><summary>${ad}</summary><div id="pt-${id}"></div></details>`;
  c.innerHTML = `<button class="cekmece-sap" title="Paneli aç / kapat"><span class="ok-i">${ana.querySelector(".pt-duzen").classList.contains("cekmece-acik") ? "›" : "‹"}</span><span>Panel</span></button>
    <div class="cekmece-ic">${bolum("ist", "İstatistikler")}${bolum("mesai", "Mesai Ayarları")}${bolum("hm", "Hesap Makinesi")}</div>`;
  c.querySelector(".cekmece-sap").onclick = () => {
    const d = ana.querySelector(".pt-duzen");
    const acik = d.classList.toggle("cekmece-acik");
    try { localStorage.setItem("kadro-cekmece", acik ? "1" : "0"); } catch { /* yoksay */ }
    c.querySelector(".ok-i").textContent = acik ? "›" : "‹";
  };
  c.querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => {
    const k = [...c.querySelectorAll("details:not([open])")].map((x) => x.dataset.b);
    try { localStorage.setItem("kadro-cekmece-bolum", JSON.stringify(k)); } catch { /* yoksay */ }
  }));
  ptMesaiCiz();
  hesapMakinesiCiz(c.querySelector("#pt-hm"));
  ptCekmeceTazele();
}

function ptCekmeceTazele() {
  const k = document.getElementById("pt-ist");
  if (!k || !PT.paket?.hesap) return;
  const { ozet, ekipOzet } = PT.paket.hesap;
  const sat = (ad, deger, sayi, sinif = "") =>
    `<div class="ist-sat ${sinif}"><span>${ad}</span><b ${sayi !== undefined ? `data-deger="${sayi}" title="Hesap makinesine aktar"` : ""}>${deger}</b></div>`;
  const paraSat = (ad, t, sinif) => {
    const p = Object.entries(t || {}).filter(([, v]) => v);
    if (!p.length) return sat(ad, "—");
    return p.map(([pb, v], i) => sat(i ? "" : ad, `${sayiMetni(v)} ${pb}`, v, sinif)).join("");
  };
  k.innerHTML = `
    ${sat("Toplam çalışma saati", sayiMetni(ozet.toplamSaat), ozet.toplamSaat, "buyuk")}
    ${sat("Normal saat", sayiMetni(ozet.normal), ozet.normal)}
    ${sat("Mesai saati", sayiMetni(ozet.mesai), ozet.mesai)}
    ${sat("Eksik iş saati", sayiMetni(ozet.eksik), ozet.eksik, ozet.eksik ? "kotu" : "")}
    ${sat("Kişi / ekip", `${ozet.kisi} / ${ozet.ekip}`)}
    ${sat("Çalışılan kişi-gün", sayiMetni(ozet.calisilanGun), ozet.calisilanGun)}
    ${sat("İzin · rapor · gelmedi", `${ozet.izin} · ${ozet.rapor} · ${ozet.gelmedi} gün`)}
    <div class="ist-ayrac"></div>
    ${paraSat("Hakediş", ozet.hakedis)}
    ${paraSat("Kesinti", ozet.kesinti)}
    ${ozet.kural >= 2 && Object.keys(ozet.kesinti).length ? `${paraSat("· günlük maaş", ozet.kesintiMaas, "alt")}${paraSat("· kira payı", ozet.kesintiKira, "alt")}${paraSat("· yemek", ozet.kesintiYemek, "alt")}` : ""}
    ${paraSat("Mesai ücreti", ozet.mesaiTutar)}
    ${paraSat("Avans", ozet.avans)}
    ${paraSat("Toplam ödenecek (net)", ozet.net, "buyuk")}
    ${anaKarsilik(ozet.net, PT.paket.kayit.ayar.kur || S.durum?.kur) ? sat("", anaKarsilik(ozet.net, PT.paket.kayit.ayar.kur || S.durum?.kur), undefined, "alt") : ""}
    ${Object.keys(ozet.aySonu).length ? paraSat("Ay sonu ödenecek", ozet.aySonu, "vurgu") : ""}
    <div class="ist-ayrac"></div>
    ${paraSat("Yemek", ozet.yemek)}
    ${paraSat("Kira payı", ozet.kira)}
    ${ozet.maassiz ? `<div class="acilir-not uyari">${ozet.maassiz} kişinin maaşı girilmemiş; hakedişe dahil değil.</div>` : ""}
    ${ekipOzet.length ? `<div class="ist-alt">Ekip bazında</div>${ekipOzet.map((e) =>
      `<div class="ist-ekip"><span><b>${kacir(e.kod)}</b> ${kacir(e.ad)}</span><span>${e.kisiGun} kişi-gün · ${sayiMetni(e.saat)} sa${Object.keys(e.yemek).length ? ` · yemek ${toplamMetni(e.yemek)}` : ""}</span></div>`).join("")}` : ""}`;
  k.querySelectorAll("[data-deger]").forEach((b) => b.onclick = () => hesapMakinesineEkle(b.dataset.deger));
}

function ptMesaiCiz() {
  const k = document.getElementById("pt-mesai");
  if (!k) return;
  const { ayar, gunler } = PT.paket.kayit;
  const kural = PT.paket.kayit.kural || 1;
  const kapali = ptKapali();
  const dis = kapali ? "disabled" : "";
  const ucretModu = kural >= 2 && ayar.mesaiModu !== "carpan";
  const mu = ayar.mesaiUcreti || {};

  k.innerHTML = `
    ${kural >= 2 ? `
    <label class="pn-alan"><span>Mesai hesabı</span><select data-a="mesaiModu" ${dis}>
      <option value="ucret" ${ucretModu ? "selected" : ""}>Sabit saatlik ücret</option>
      <option value="carpan" ${!ucretModu ? "selected" : ""}>Saat değeri × çarpan</option></select></label>
    ${ucretModu ? ["EUR", "TRY", "RSD"].map((pb) => `<label class="pn-alan"><span>Mesai ücreti · ${pb} / saat</span>
      <input type="number" step="0.01" min="0" data-mu="${pb}" value="${mu[pb] ?? ""}" placeholder="girilmedi" ${dis}></label>`).join("")
      : `<label class="pn-alan"><span>Mesai çarpanı</span><input type="number" step="0.05" min="1" max="5" data-a="mesaiCarpani" value="${ayar.mesaiCarpani}" ${dis}></label>`}
    ${ucretModu ? `<div class="pn-not">Personel kartında kişiye özel mesai ücreti girilmişse o kullanılır. Ücret bu döneme aittir; sonraki dönem buradan devralır.</div>` : ""}
    ` : `<label class="pn-alan"><span>Mesai çarpanı</span><input type="number" step="0.05" min="1" max="5" data-a="mesaiCarpani" value="${ayar.mesaiCarpani}" ${dis}></label>`}
    <label class="pn-alan"><span>Normal gün (saat)</span><input type="number" step="0.5" min="1" max="24" data-a="normalSaat" value="${ayar.normalSaat}" ${dis}></label>
    <label class="onay-kutu"><input type="checkbox" data-a="haftaIciAsim" ${ayar.haftaIciAsim ? "checked" : ""} ${dis}> Normal günde ${sayiMetni(ayar.normalSaat)} saati aşan kısım mesai sayılsın</label>
    <label class="onay-kutu"><input type="checkbox" data-a="tatilMesai" ${ayar.tatilMesai ? "checked" : ""} ${dis}> Tatil gününde (Pazar vb.) çalışılan saat mesai sayılsın</label>
    ${kural >= 2 ? `<label class="onay-kutu"><input type="checkbox" data-a="eksikSaatKesinti" ${ayar.eksikSaatKesinti ? "checked" : ""} ${dis}> Aylıkçının girilmiş eksik saatleri de kesilsin (ör. 8 yerine 5 saat)</label>
    <div class="pn-not"><b>Kesinti:</b> sadece <b>–</b> (gelmedi) yazılan gün kesilir. Aylıkçıdan günlük maaş (maaş × 12 ÷ 365) + günlük kira payı + günlük yemek,
      saatlikçiden kira payı + yemek. Boş hücre, izin, rapor ve işe giriş öncesi günler kesinti doğurmaz.</div>`
    : `<div class="pn-kural">Bu dönem <b>eski hesap kurallarıyla</b> açıldı: mesai çarpanla, kesinti eksik saat × saat değeri, boş geçmiş günler eksik sayılır.
      ${kapali ? "Dönem kapalı; rakamları değişmez." : `<button class="dg ufak bas" data-is="kural">Yeni kurallara geçir</button>`}</div>`}
    ${kural === 2 ? `<div class="pn-kural">Bu dönem <b>kur çevirisi olmadan</b> açıldı: maaştan farklı para birimindeki yemek, kira ve avans maaştan düşülmez.
      ${kapali ? "Dönem kapalı; rakamları değişmez." : `<button class="dg ufak bas" data-is="kural">Yeni kurallara geçir</button>`}</div>` : ""}
    ${kural >= 3 ? `<div class="pn-not"><b>Kur (bu dönem):</b> ${kacir(kurMetni(ayar.kur))}. Maaştan farklı para birimindeki yemek, kira ve avans bu kurla çevrilip düşülür.
      ${!kapali && S.durum?.kur && !kurEsit(S.durum.kur, ayar.kur)
        ? `<br>Ayarlar'daki güncel kur farklı (${kacir(kurMetni(S.durum.kur))}). <button class="dg ufak" data-is="kurAl">Güncel kuru al</button>` : ""}</div>` : ""}
    <div class="pn-not">Mesai günündeki saatlerin tamamı mesaidir. Gün tipini değiştirmek için takvimde gün başlığına tıklayın.</div>
    ${kapali ? `<div class="pn-not">Dönem kapalı; ayarlar kilitli.</div>` : `
    <div class="pn-dugmeler">
      <button class="dg ufak" data-gt="ct">Cumartesiler mesai</button>
      <button class="dg ufak" data-gt="pz">Pazarlar tatil</button>
      <button class="dg ufak" data-gt="sifirla">Varsayılana dön</button>
    </div>`}
    <div class="pn-not">Bu dönem: ${Object.values(gunler).filter((t) => t === "normal").length} normal, ${Object.values(gunler).filter((t) => t === "mesai").length} mesai, ${Object.values(gunler).filter((t) => t === "tatil").length} tatil günü · ayın iş günü ${PT.paket.hesap.ayIsGunu}.</div>`;

  const kaydet = async (govde) => {
    try { PT.paket = await api(`/puantaj/${PT.paket.donem}/ayar`, { method: "PUT", body: JSON.stringify(govde) }); return true; }
    catch (e) { hataBildir(e); return false; }
  };
  k.querySelectorAll("[data-a]").forEach((g) => g.addEventListener("change", async () => {
    const v = g.type === "checkbox" ? g.checked : g.value;
    if (await kaydet({ ayar: { [g.dataset.a]: v } })) { ptDegerleriTazele(); ptMesaiCiz(); bildir("Mesai ayarı kaydedildi", "", "iyi"); }
  }));
  k.querySelectorAll("[data-mu]").forEach((g) => g.addEventListener("change", async () => {
    if (await kaydet({ ayar: { mesaiUcreti: { [g.dataset.mu]: g.value } } })) {
      ptDegerleriTazele(); ptMesaiCiz(); bildir("Mesai ücreti kaydedildi", `${g.dataset.mu}: ${g.value || "silindi"}`, "iyi");
    }
  }));
  k.querySelector('[data-is="kural"]')?.addEventListener("click", async () => {
    const ok = await onay("Dönem yeni kurallara geçirilsin mi?",
      "Mesai sabit saatlik ücretle hesaplanır; sadece \"–\" (gelmedi) yazılan günler kesilir (günlük maaş + kira payı + yemek); " +
      "boş günler ve işe giriş öncesi kesinti doğurmaz; yemek parası dönemin her günü için önden sayılır; " +
      "maaştan farklı para birimindeki yemek, kira ve avans Ayarlar'daki kurla çevrilip düşülür. Bu işlem geri alınamaz.", "Yeni kurallara geçir");
    if (ok && await kaydet({ kuralGuncelle: true })) { ptIzgaraCiz(); ptMesaiCiz(); bildir("Dönem yeni kurallara geçirildi", "Mesai ücretlerini panelden kontrol edin.", "iyi"); }
  });
  k.querySelector('[data-is="kurAl"]')?.addEventListener("click", async () => {
    if (await kaydet({ ayar: { kur: "guncel" } })) { ptDegerleriTazele(); ptMesaiCiz(); bildir("Dönemin kuru güncellendi", kurMetni(PT.paket.kayit.ayar.kur), "iyi"); }
  });
  k.querySelectorAll("[data-gt]").forEach((b) => b.onclick = async () => {
    const yeni = {};
    for (const g of PT.paket.gunler) {
      if (b.dataset.gt === "ct" && g.kisa === "Ct") yeni[g.gun] = "mesai";
      if (b.dataset.gt === "pz" && g.kisa === "Pz") yeni[g.gun] = "tatil";
      if (b.dataset.gt === "sifirla") yeni[g.gun] = g.kisa === "Ct" ? "mesai" : g.kisa === "Pz" ? "tatil" : "normal";
    }
    if (await kaydet({ gunler: yeni })) { ptIzgaraCiz(); ptMesaiCiz(); }
  });
}

/* --- hesap makinesi --- */

function hesapMakinesiCiz(kutu) {
  if (!kutu) return;
  kutu.innerHTML = `<input class="hm-ekran" placeholder="0" spellcheck="false">
    <div class="hm-sonuc"></div>
    <div class="hm-tuslar">${["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ",", "⌫", "="]
      .map((t) => `<button class="${/[0-9,]/.test(t) ? "" : "islem"} ${t === "=" ? "esit" : ""}">${t}</button>`).join("")}</div>
    <div class="pn-not">İstatistiklerdeki bir değere tıklayınca buraya eklenir.</div>`;
  const ekran = kutu.querySelector(".hm-ekran");
  const sonuc = kutu.querySelector(".hm-sonuc");
  const hesapla = () => {
    const ifade = ekran.value.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, ".").replace(/\s/g, "");
    if (!ifade) return;
    if (!/^[\d+\-*/().]+$/.test(ifade)) { sonuc.textContent = "geçersiz ifade"; return; }
    try {
      const v = Function(`"use strict";return (${ifade})`)();
      if (!Number.isFinite(v)) throw new Error();
      sonuc.textContent = `${ekran.value} =`;
      ekran.value = String(Math.round(v * 10000) / 10000).replace(".", ",");
    } catch { sonuc.textContent = "geçersiz ifade"; }
  };
  kutu.querySelectorAll(".hm-tuslar button").forEach((b) => b.onclick = () => {
    const t = b.textContent;
    if (t === "C") { ekran.value = ""; sonuc.textContent = ""; }
    else if (t === "⌫") ekran.value = ekran.value.slice(0, -1);
    else if (t === "=") hesapla();
    else ekran.value += t;
    ekran.focus();
  });
  ekran.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); hesapla(); } });
}

function hesapMakinesineEkle(deger) {
  const ekran = document.querySelector(".hm-ekran");
  if (!ekran) return;
  const d = document.querySelector('details[data-b="hm"]');
  if (d) d.open = true;
  const sayi = String(deger).replace(".", ",");
  ekran.value = /[\d,)]$/.test(ekran.value) ? `${ekran.value}+${sayi}` : ekran.value + sayi;
  ekran.focus();
}

/* ---------------- ÇALIŞAN İSTATİSTİKLERİ ---------------- */

const IST = { bas: null, bit: null, sekme: "kisi" };

async function istatistikCiz() {
  ana.innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;
  const donemler = await api("/puantaj");
  const yil = String(new Date().getFullYear());
  if (IST.bas === null) {
    const buYil = donemler.filter((d) => d.donem.startsWith(yil));
    IST.bas = buYil[0]?.donem || ""; IST.bit = buYil.at(-1)?.donem || "";
  }
  const v = await api(`/istatistik?bas=${encodeURIComponent(IST.bas)}&bit=${encodeURIComponent(IST.bit)}`);

  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas"><div><h2>Çalışan İstatistikleri</h2>
    <p>Puantaj dönemlerinden toplanır; kişiler personel koduyla eşleştirilir. Proje görünümünde saatler ve tutarlar,
      kişinin o gün çalıştığı ekibin projesine dağıtılır.</p></div></div>`));

  const secenek = (secili, bos) => `<option value="">${bos}</option>` +
    donemler.map((d) => `<option value="${d.donem}" ${d.donem === secili ? "selected" : ""}>${kacir(d.ad)}</option>`).join("");
  const arac = el(`<div class="pt-filtre">
    <label class="kucuk-et">Başlangıç <select data-i="bas">${secenek(IST.bas, "En baştan")}</select></label>
    <label class="kucuk-et">Bitiş <select data-i="bit">${secenek(IST.bit, "Sona kadar")}</select></label>
    <button class="dg ufak" data-h="yil">Bu yıl</button>
    <button class="dg ufak" data-h="tumu">Tümü</button>
    <div class="sekmeler">
      <button class="sekme ${IST.sekme === "kisi" ? "aktif" : ""}" data-s="kisi">Çalışanlar · ${v.kisiler.length}</button>
      <button class="sekme ${IST.sekme === "proje" ? "aktif" : ""}" data-s="proje">Projeler · ${v.projeler.length}</button>
    </div></div>`);
  arac.querySelectorAll("[data-i]").forEach((s) => s.onchange = () => { IST[s.dataset.i] = s.value; istatistikCiz(); });
  arac.querySelector('[data-h="yil"]').onclick = () => {
    const b = donemler.filter((d) => d.donem.startsWith(yil));
    IST.bas = b[0]?.donem || ""; IST.bit = b.at(-1)?.donem || ""; istatistikCiz();
  };
  arac.querySelector('[data-h="tumu"]').onclick = () => { IST.bas = ""; IST.bit = ""; istatistikCiz(); };
  arac.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => { IST.sekme = b.dataset.s; istatistikCiz(); });
  ana.appendChild(arac);

  if (!v.donemler.length) {
    ana.appendChild(el(`<div class="kart"><div class="bos"><div class="bs">Bu aralıkta puantaj dönemi yok</div>
      <p><a href="#puantaj">Puantaj</a> ekranından bir dönem açıp saat girdikçe istatistikler burada oluşur.</p></div></div>`));
    return;
  }

  const topla = (liste, alan) => liste.reduce((a, x) => {
    if (typeof x[alan] === "number") return (a || 0) + x[alan];
    const t = { ...(a || {}) }; for (const [pb, n] of Object.entries(x[alan] || {})) t[pb] = (t[pb] || 0) + n; return t;
  }, null);
  const L = IST.sekme === "kisi" ? v.kisiler : v.projeler;
  ana.appendChild(el(`<div>${metrikler([
    [String(v.donemler.length), "Dönem", `${v.donemler[0].ad.split(" · ")[0]} → ${v.donemler.at(-1).ad.split(" · ")[0]}`],
    [sayiMetni(topla(v.kisiler, "saat")), "Toplam saat"],
    [sayiMetni(topla(v.kisiler, "mesai")), "Mesai saati"],
    [sayiMetni(topla(v.kisiler, "eksik")), "Eksik saat"],
    [toplamMetni(topla(v.kisiler, "hakedis")), "Hakediş"],
    [toplamMetni(topla(v.kisiler, "yemek")), "Yemek"],
    [toplamMetni(topla(v.kisiler, "kira")), "Kira payı"],
  ])}</div>`));

  const sutunlar = IST.sekme === "kisi" ? [
    ["Çalışan", (k) => `<a href="${k._id ? `#d/personel/${k._id}` : "#t/personel"}"><b>${kacir(k.ad)}</b></a><div class="soluk mono">${kacir(k.personelKod)}</div>`],
    ["Dönem", (k) => k.donem, "donem"],
    ["Saat", (k) => sayiMetni(k.saat), "saat"],
    ["Normal", (k) => sayiMetni(k.normal), "normal"],
    ["Mesai", (k) => sayiMetni(k.mesai), "mesai"],
    ["Eksik", (k) => sayiMetni(k.eksik), "eksik"],
    ["İzin/Rapor/Gelmedi", (k) => `${k.izin} / ${k.rapor} / ${k.gelmedi}`],
    ["Hakediş", (k) => toplamMetni(k.hakedis), "hakedis"],
    ["Kesinti", (k) => `<span title="${kacir(`Maaş: ${toplamMetni(k.kesintiMaas)}\nKira: ${toplamMetni(k.kesintiKira)}\nYemek: ${toplamMetni(k.kesintiYemek)}`)}">${toplamMetni(k.kesinti)}</span>`, "kesinti"],
    ["Avans", (k) => toplamMetni(k.avans), "avans"],
    ["Net", (k) => `<b>${toplamMetni(k.net)}</b>`, "net"],
    ["Yemek", (k) => toplamMetni(k.yemek), "yemek"],
    ["Kira", (k) => toplamMetni(k.kira), "kira"],
    ["Projeler", (k) => kacir(k.projeler.map((p) => p.ad).join(", ") || "—")],
  ] : [
    ["Proje", (p) => `<b>${kacir(p.ad)}</b>`],
    ["Kişi", (p) => p.kisi],
    ["Saat", (p) => sayiMetni(p.saat), "saat"],
    ["Normal", (p) => sayiMetni(p.normal), "normal"],
    ["Mesai", (p) => sayiMetni(p.mesai), "mesai"],
    ["Eksik", (p) => sayiMetni(p.eksik), "eksik"],
    ["Maaş (hakediş)", (p) => toplamMetni(p.hakedis), "hakedis"],
    ["Yemek", (p) => toplamMetni(p.yemek), "yemek"],
    ["Kira", (p) => toplamMetni(p.kira), "kira"],
    ["Toplam Maliyet", (p) => `<b>${toplamMetni(topla([{ t: p.hakedis }, { t: p.yemek }, { t: p.kira }], "t"))}</b>`],
  ];
  const tablo = el(`<div class="tablo-sar"><table class="mini ist-tablo"><thead><tr>${sutunlar.map(([b]) => `<th>${b}</th>`).join("")}</tr></thead>
    <tbody>${L.map((x) => `<tr>${sutunlar.map(([, f]) => `<td>${f(x)}</td>`).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr>${sutunlar.map(([, , alan], i) => {
      if (i === 0) return `<td><b>Toplam</b></td>`;
      if (!alan) return `<td></td>`;
      const t = topla(L, alan);
      return `<td><b>${typeof t === "number" ? sayiMetni(t) : toplamMetni(t)}</b></td>`;
    }).join("")}</tr></tfoot></table></div>`);
  ana.appendChild(tablo);
}

/* ---------------- KASA ---------------- */

const KS = { ay: "", sekme: "hareket", rapor: { tur: "ay", yil: new Date().getFullYear(), proje: "", secili: null } };
const PB_SIRA = ["EUR", "TRY", "RSD"];
const RAPOR_TURLERI = [["donem", "15 gün"], ["ay", "Aylık"], ["ceyrek", "Çeyrek"], ["yariyil", "Yarıyıl"], ["yil", "Yıllık"], ["proje", "Proje"]];

/** Toplamlarda geçen para birimleri, EUR / TRY / RSD sırasıyla. */
function pbListesi(...toplamlar) {
  const v = new Set(toplamlar.flatMap((t) => Object.keys(t || {}).filter((k) => t[k])));
  return PB_SIRA.filter((k) => v.has(k)).concat([...v].filter((k) => !PB_SIRA.includes(k)));
}

/** Bir hücrede para birimi başına bir satır. */
const pbHucre = (t, sinif = "") => {
  const pbler = pbListesi(t);
  return pbler.length
    ? pbler.map((pb) => `<div class="pb-sat ${sinif} ${t[pb] < 0 ? "eksi" : ""}"><span>${sayiMetni(t[pb])}</span><small>${pb}</small></div>`).join("")
    : `<span class="soluk">—</span>`;
};

const kasaRaporMetni = (r) => [
  r.eklenen ? `${r.eklenen} yeni satır` : "", r.guncellenen ? `${r.guncellenen} satır güncellendi` : "",
  r.silinen ? `${r.silinen} satır kaldırıldı` : "",
].filter(Boolean).join(", ") || "Değişiklik yok.";

/** Devir / gelir / gider / bakiye kutusu: her para birimi bir satır. */
function kasaOzetHtml(z, { devirEtiket = "Devir", bakiyeEtiket = "Bakiye", net = false } = {}) {
  const pbler = pbListesi(z.devir, z.gelir, z.gider, z.bakiye);
  if (!pbler.length) return `<div class="liste-bos">Bu aralıkta hareket ve devir yok.</div>`;
  return `<table class="mini kasa-ozet"><thead><tr><th></th><th>${devirEtiket}</th><th>Gelir</th><th>Gider</th>${net ? "<th>Net</th>" : ""}<th>${bakiyeEtiket}</th></tr></thead>
    <tbody>${pbler.map((pb) => `<tr><td class="pb">${pb}</td>
      <td>${sayiMetni(z.devir[pb] || 0)}</td>
      <td class="gelir">${z.gelir[pb] ? "+" + sayiMetni(z.gelir[pb]) : "—"}</td>
      <td class="gider">${z.gider[pb] ? "−" + sayiMetni(z.gider[pb]) : "—"}</td>
      ${net ? `<td class="${(z.net[pb] || 0) < 0 ? "eksi" : ""}">${sayiMetni(z.net[pb] || 0)}</td>` : ""}
      <td class="bakiye ${(z.bakiye[pb] || 0) < 0 ? "eksi" : ""}"><b>${sayiMetni(z.bakiye[pb] || 0)}</b></td></tr>`).join("")}
      ${anaSatirHtml([z.devir, z.gelir, z.gider, ...(net ? [z.net] : []), z.bakiye])}</tbody></table>`;
}

async function kasaCiz(arg) {
  if (arg === "rapor") KS.sekme = "rapor";
  else { KS.sekme = "hareket"; KS.ay = arg || KS.ay || "bu"; }
  ana.innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;

  const bas = el(`<div class="sayfa-bas"><div><h2>Kasa</h2>
    <p>Gelir ve giderler. Avans, yemek, kira ve maaş satırlarını sistem kendisi yazar. Kur çevirisi yapılmaz; her para birimi ayrı toplanır.</p></div>
    <div class="bas-arac"></div></div>`);
  const sekmeler = el(`<div class="sekmeler" style="margin-left:0">
    <button class="sekme ${KS.sekme === "hareket" ? "aktif" : ""}" data-s="hareket">Hareketler</button>
    <button class="sekme ${KS.sekme === "rapor" ? "aktif" : ""}" data-s="rapor">Raporlar</button></div>`);
  sekmeler.querySelector('[data-s="hareket"]').onclick = () => { location.hash = `#kasa/${KS.ay && KS.ay !== "bu" ? KS.ay : ""}`.replace(/\/$/, ""); };
  sekmeler.querySelector('[data-s="rapor"]').onclick = () => { location.hash = "#kasa/rapor"; };

  if (KS.sekme === "rapor") return kasaRaporCiz(bas, sekmeler);

  await kaynaklariYukle();
  const v = await api(`/kasa/${KS.ay}`);
  KS.ay = v.ay;
  ana.innerHTML = "";
  ana.appendChild(bas);
  bas.querySelector(".bas-arac").innerHTML = `
    <button class="dg" data-is="excel">Excel'e aktar</button>
    <button class="dg" data-is="gelir">+ Gelir</button>
    <button class="dg bas" data-is="gider">+ Gider</button>`;

  const arac = el(`<div class="pt-filtre kasa-arac">
    <div class="ay-gez">
      <a class="dg ufak" href="#kasa/${v.onceki}" title="Önceki ay">‹</a>
      <b>${kacir(v.ad)}</b>
      <a class="dg ufak" href="#kasa/${v.sonraki}" title="Sonraki ay">›</a>
      ${v.ay !== v.buAy ? `<a class="dg ufak" href="#kasa/${v.buAy}">Bu ay</a>` : ""}
    </div></div>`);
  arac.appendChild(sekmeler);
  ana.appendChild(arac);

  const ozetKart = kart(`${v.ad} · Özet`, `<span class="mono soluk">${v.satirlar.length} hareket</span>`);
  ozetKart.classList.add("kasa-ozet-kart");
  const ozetCiz = (z) => { ozetKart.querySelector(".kart-govde").innerHTML = kasaOzetHtml(z, { devirEtiket: "Devir (önceki aylar)", bakiyeEtiket: "Ay sonu bakiye" }); };
  ozetCiz(v.ozet);
  ana.appendChild(ozetKart);

  const notlar = [];
  notlar.push(`Aylık dosya: <span class="mono">${kacir(v.dosya)}</span> — kasada her değişiklikte güncellenir.`);
  if (v.dosyaHatasi) notlar.push(`<span class="kotu">${kacir(v.dosyaHatasi)}</span>`);
  if (v.silinen.length) {
    notlar.push(`Bu ay ${v.silinen.length} otomatik satır elle silindi; sistem bunları yazmıyor.
      <button class="dg ufak" data-is="geri">Geri getir</button>`);
  }
  const notKutu = el(`<div class="ipucu-kutu kasa-not">${notlar.map((n) => `<div>${n}</div>`).join("")}</div>`);
  ana.appendChild(notKutu);

  const ara = el(`<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
    <div class="ara-kutu"><input placeholder="Kasada ara (açıklama, kategori, proje…)" value="${kacir(tabloDurum.kasa?.filtre || "")}"></div>
    <span id="satirSayi" style="font-family:var(--f-mono);font-size:11px;color:var(--muted)"></span>
    <span class="kasa-lejant"><span class="pul-d otomatik">Otomatik</span> sistem yazdı
      <span class="pul-d duzeltildi">Elle düzeltildi</span> sistem ezmez, tıklayınca geri döner</span>
  </div>`);
  ana.appendChild(ara);
  const sar = el(`<div class="tablo-sar"><table class="gr kasa-gr"><thead></thead><tbody></tbody></table></div>`);
  ana.appendChild(sar);

  const ozetTazele = async () => {
    try { const y = await api(`/kasa/${KS.ay}`); ozetCiz(y.ozet); } catch { /* yoksay */ }
  };
  tabloDurum.kasa = { tanim: v.tanim, satirlar: v.satirlar, filtre: tabloDurum.kasa?.filtre || "", kaydedilince: ozetTazele };
  ara.querySelector("input").oninput = (ev) => { tabloDurum.kasa.filtre = ev.target.value; gridCiz("kasa"); };
  gridCiz("kasa");

  const yeni = (tur) => {
    const bugun = bugunMetni();
    tabloDurum.kasa.satirlar.unshift({
      _id: null, _yeni: true, tur, paraBirimi: "EUR", tekrar: "Hayır",
      tarih: bugun.startsWith(KS.ay) ? bugun : `${KS.ay}-01`,
      kategori: tur === "Gelir" ? "Hakediş / Fatura" : "",
    });
    gridCiz("kasa");
    sar.querySelector('tbody tr.yeni input[data-k="aciklama"]')?.focus();
  };
  bas.querySelector('[data-is="gelir"]').onclick = () => yeni("Gelir");
  bas.querySelector('[data-is="gider"]').onclick = () => yeni("Gider");
  bas.querySelector('[data-is="excel"]').onclick = () => { location.href = `/api/kasa/${KS.ay}/excel`; };
  notKutu.querySelector('[data-is="geri"]')?.addEventListener("click", async () => {
    try {
      const r = await api(`/kasa/${KS.ay}/geri-getir`, { method: "POST" });
      bildir("Otomatik satırlar geri getirildi", kasaRaporMetni(r), "iyi");
      kasaCiz(KS.ay);
    } catch (e) { hataBildir(e); }
  });

  // "Elle düzeltildi" etiketine tıklayınca satır sistemin hesabına döner.
  sar.querySelector("tbody").addEventListener("click", async (ev) => {
    const p = ev.target.closest("[data-geri]");
    if (!p) return;
    const satir = tabloDurum.kasa.satirlar.find((x) => x._id === p.dataset.geri);
    const ok = await onay("Sistemin hesabına dönülsün mü?",
      `Bu satırdaki elle düzeltme silinir ve sistemin hesabı yazılır: ${satir?.sistemTutar || "—"}.` +
      (satir?.sistemTutar === "kaynağı silindi" ? " Kaynağı silindiği için satır kasadan kaldırılacak." : ""), "Sisteme bırak");
    if (!ok) return;
    try {
      await api(`/kasa/satir/${p.dataset.geri}/sistem`, { method: "POST" });
      bildir("Satır sistemin hesabına döndü", "", "iyi");
      kasaCiz(KS.ay);
    } catch (e) { hataBildir(e); }
  });
}

async function kasaRaporCiz(bas, sekmeler) {
  const R = KS.rapor;
  await kaynaklariYukle();
  const q = new URLSearchParams({ tur: R.tur, yil: R.yil, proje: R.tur === "proje" ? "" : R.proje });
  const r = await api(`/kasa/rapor?${q}`);
  ana.innerHTML = "";
  ana.appendChild(bas);
  bas.querySelector(".bas-arac").innerHTML = `<button class="dg" data-is="excel">Raporu Excel'e aktar</button>`;
  bas.querySelector('[data-is="excel"]').onclick = () => { location.href = `/api/kasa/rapor/excel?${q}`; };

  const projeler = kayitlar("proje");
  const arac = el(`<div class="pt-filtre kasa-arac">
    <div class="sekmeler rapor-tur" style="margin-left:0">${RAPOR_TURLERI.map(([k, b]) =>
      `<button class="sekme ${R.tur === k ? "aktif" : ""}" data-t="${k}">${b}</button>`).join("")}</div>
    ${R.tur === "yil" ? "" : `<label class="kucuk-et">Yıl <select data-r="yil">${r.yillar.map((y) =>
      `<option ${y === r.yil ? "selected" : ""}>${y}</option>`).join("")}</select></label>`}
    ${R.tur === "proje" ? "" : `<label class="kucuk-et">Proje <select data-r="proje">
      <option value="">Tüm projeler</option><option value="-" ${R.proje === "-" ? "selected" : ""}>Projesiz</option>
      ${projeler.map((p) => `<option value="${kacir(p.kod)}" ${R.proje === p.kod ? "selected" : ""}>${kacir(kayitEtiketi(p))}</option>`).join("")}
    </select></label>`}
  </div>`);
  arac.appendChild(sekmeler);
  sekmeler.style.marginLeft = "auto";
  ana.appendChild(arac);
  arac.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { R.tur = b.dataset.t; R.secili = null; kasaCiz("rapor"); });
  arac.querySelectorAll("[data-r]").forEach((s) => s.onchange = () => {
    R[s.dataset.r] = s.dataset.r === "yil" ? Number(s.value) : s.value; R.secili = null; kasaCiz("rapor");
  });

  const kapsam = R.tur === "yil" ? "Tüm yıllar" : String(r.yil);
  const toplamKart = kart(`Toplam · ${kapsam} · ${r.projeAd}`);
  toplamKart.querySelector(".kart-govde").innerHTML = kasaOzetHtml(r.toplam,
    { devirEtiket: R.tur === "yil" ? "Devir" : "Yıl başı devir", bakiyeEtiket: R.tur === "yil" ? "Bakiye" : "Yıl sonu bakiye", net: true });
  ana.appendChild(toplamKart);

  const ilk = R.tur === "proje" ? "Proje" : "Dönem";
  const tablo = el(`<div class="tablo-sar kasa-rapor-sar"><table class="mini ist-tablo kasa-rapor"><thead><tr>
    <th>${ilk}</th><th>Devir</th><th>Gelir</th><th>Gider</th><th>Net</th><th>Bakiye</th><th>Hareket</th></tr></thead>
    <tbody>${r.kovalar.map((k) => `<tr data-a="${kacir(k.anahtar)}" class="${k.adet ? "" : "bos-kova"} ${R.secili === k.anahtar ? "secili" : ""}">
      <td><b>${kacir(k.ad)}</b>${R.tur === "ay" ? ` <a class="git" href="#kasa/${k.anahtar}" title="Bu ayın hareketleri">↗</a>` : ""}</td>
      <td>${pbHucre(k.devir)}</td><td>${pbHucre(k.gelir, "gelir")}</td><td>${pbHucre(k.gider, "gider")}</td>
      <td>${pbHucre(k.net)}</td><td>${pbHucre(k.bakiye, "bakiye")}</td><td class="soluk">${k.adet || "—"}</td></tr>`).join("")}
    </tbody></table></div>`);
  ana.appendChild(tablo);

  const dagilim = el(`<div class="kasa-dagilim"></div>`);
  ana.appendChild(dagilim);
  const dagilimCiz = () => {
    const k = r.kovalar.find((x) => x.anahtar === R.secili);
    const z = k || r.toplam;
    const baslik = k ? k.ad : `${kapsam} toplamı`;
    dagilim.innerHTML = "";

    const kk = kart(`Kategori dağılımı · ${baslik}`, k ? `<button class="dg ufak" data-is="temizle">Toplama dön</button>` : `<span class="soluk mono">satıra tıklayınca o dönem</span>`);
    const enBuyuk = {};
    for (const c of z.kategoriler) for (const [pb, t] of Object.entries(c.tutar)) enBuyuk[`${c.tur}|${pb}`] = Math.max(enBuyuk[`${c.tur}|${pb}`] || 0, t);
    kk.querySelector(".kart-govde").innerHTML = z.kategoriler.length ? z.kategoriler.map((c) => `
      <div class="kat-sat"><span class="pul-d ${c.tur === "Gelir" ? "gelir" : "gider"}">${c.tur}</span><span class="ad">${kacir(c.kategori)}</span>
        <div class="kat-tutar">${pbListesi(c.tutar).map((pb) => `<div class="kat-cubuk"><b class="iz">
          <i style="width:${Math.max(2, Math.round(100 * c.tutar[pb] / enBuyuk[`${c.tur}|${pb}`]))}%" class="${c.tur === "Gelir" ? "gelir" : "gider"}"></i></b>
          <span>${sayiMetni(c.tutar[pb])} <small>${pb}</small></span></div>`).join("")}</div></div>`).join("")
      : `<div class="liste-bos">Bu aralıkta hareket yok.</div>`;
    kk.querySelector('[data-is="temizle"]')?.addEventListener("click", () => { R.secili = null; tablo.querySelectorAll("tr.secili").forEach((t) => t.classList.remove("secili")); dagilimCiz(); });
    dagilim.appendChild(kk);

    if (R.tur !== "proje") {
      const pk = kart(`Proje dağılımı · ${baslik}`);
      pk.querySelector(".kart-govde").innerHTML = z.projeler.length ? `<table class="mini"><thead><tr><th>Proje</th><th>Gelir</th><th>Gider</th><th>Net</th></tr></thead>
        <tbody>${z.projeler.map((p) => `<tr><td>${kacir(p.ad)}</td><td>${pbHucre(p.gelir, "gelir")}</td><td>${pbHucre(p.gider, "gider")}</td><td>${pbHucre(p.net)}</td></tr>`).join("")}</tbody></table>`
        : `<div class="liste-bos">Bu aralıkta hareket yok.</div>`;
      dagilim.appendChild(pk);
    }
  };
  tablo.querySelector("tbody").addEventListener("click", (ev) => {
    if (ev.target.closest("a")) return;
    const tr = ev.target.closest("tr[data-a]");
    if (!tr) return;
    R.secili = R.secili === tr.dataset.a ? null : tr.dataset.a;
    tablo.querySelectorAll("tr.secili").forEach((t) => t.classList.remove("secili"));
    if (R.secili) tr.classList.add("secili");
    dagilimCiz();
  });
  dagilimCiz();
}

/* ---------------- ÖNGÖRÜ ---------------- */

const OG = { bas: "", adet: 24, proje: "", pb: "", secili: null, veri: null, odak: null, kaydirma: null };

/** Dönem kimliğini n dönem kaydırır (istemci tarafı; sunucudaki komsuDonem ile aynı). */
function donemKaydir(donem, n) {
  let [y, a, h] = donem.split("-").map(Number);
  let i = (y * 12 + (a - 1)) * 2 + (h - 1) + n;
  y = Math.floor(i / 24); i -= y * 24;
  return `${y}-${String(Math.floor(i / 2) + 1).padStart(2, "0")}-${(i % 2) + 1}`;
}

async function ongoruCiz() {
  ana.innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;
  await kaynaklariYukle();
  const q = new URLSearchParams({ bas: OG.bas, adet: OG.adet, proje: OG.proje });
  const v = await api(`/ongoru?${q}`);
  OG.veri = v; OG.bas = v.bas;
  ongoruSayfaCiz();
}

function ongoruSayfaCiz() {
  const v = OG.veri;
  if (!v.pbler.includes(OG.pb)) OG.pb = v.pbler[0];
  const kaydirma = ana.querySelector(".og-sar")?.scrollLeft;
  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas"><div><h2>Öngörü</h2>
    <p>Geçmiş dönemler gerçekleşeni, gelecek dönemler tahmini gösterir. Tahmin hücresine tutar yazarak düzeltebilirsiniz;
      hücreyi boşaltınca sistemin hesabına döner. Kur çevirisi yoktur, her para birimi ayrı sekmededir.</p></div>
    <div class="bas-arac"><button class="dg" data-is="excel">Excel'e aktar</button></div></div>`));

  const projeler = kayitlar("proje");
  const arac = el(`<div class="pt-filtre og-arac">
    <button class="dg ufak" data-k="-6" title="6 dönem geri">‹‹ 3 ay</button>
    <button class="dg ufak" data-k="bugun">Bugün</button>
    <button class="dg ufak" data-k="6" title="6 dönem ileri">3 ay ››</button>
    <label class="kucuk-et">Proje <select data-i="proje">
      <option value="">Tüm projeler</option><option value="-" ${OG.proje === "-" ? "selected" : ""}>Projesiz</option>
      ${projeler.map((p) => `<option value="${kacir(p.kod)}" ${OG.proje === p.kod ? "selected" : ""}>${kacir(kayitEtiketi(p))}</option>`).join("")}
    </select></label>
    <div class="sekmeler">${v.pbler.map((pb) => `<button class="sekme ${pb === OG.pb ? "aktif" : ""}" data-pb="${pb}">${pb}</button>`).join("")}</div>
  </div>`);
  ana.appendChild(arac);
  arac.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => {
    OG.bas = b.dataset.k === "bugun" ? "" : donemKaydir(OG.bas, Number(b.dataset.k));
    OG.secili = null; OG.kaydirma = b.dataset.k === "bugun" ? null : "koru"; ongoruCiz();
  });
  arac.querySelector('[data-i="proje"]').onchange = (ev) => { OG.proje = ev.target.value; OG.secili = null; OG.kaydirma = "koru"; ongoruCiz(); };
  arac.querySelectorAll("[data-pb]").forEach((b) => b.onclick = () => { OG.pb = b.dataset.pb; OG.kaydirma = "koru"; ongoruSayfaCiz(); });
  ana.querySelector('[data-is="excel"]').onclick = () => {
    location.href = `/api/ongoru/excel?${new URLSearchParams({ bas: v.bas, adet: v.adet, proje: v.proje })}`;
  };

  // Önümüzdeki 6 tahmin döneminin özeti.
  const pb = OG.pb;
  const ileri = v.sutunlar.filter((s) => s.durum === "tahmin").slice(0, 6);
  const topla = (t) => ileri.reduce((a, s) => a + (t[s.donem]?.[pb] || 0), 0);
  const notlar = [];
  if (!v.bilgi.kapaliDonem) notlar.push("Henüz kapanmış puantaj dönemi yok; mesai tahmini sıfır görünür.");
  else if (v.bilgi.kapaliDonem < v.bilgi.mesaiOrnek) notlar.push(`Mesai tahmini ${v.bilgi.kapaliDonem} kapanmış dönemin ortalaması (en çok ${v.bilgi.mesaiOrnek} dönem kullanılır).`);
  if (v.bilgi.maassiz) notlar.push(`${v.bilgi.maassiz} kişinin maaş bilgisi yok; maaş tahminine girmiyor.`);
  ana.appendChild(el(`<div>${metrikler(ileri.length ? [
    [`${sayiMetni(topla(v.toplam.gider))}`, `Gider tahmini · ${pb}`, `${ileri[0].ad.split(" · ")[0]} → ${ileri.at(-1).ad.split(" · ")[0]} (${ileri.length} dönem)`],
    [`${sayiMetni(topla(v.toplam.gelir))}`, `Gelir tahmini · ${pb}`],
    [`${sayiMetni(topla(v.toplam.net))}`, `Net · ${pb}`],
    [`${sayiMetni(v.toplam.bakiye[ileri.at(-1).donem]?.[pb] || 0)}`, `Kasa bakiyesi · ${pb}`, `${ileri.at(-1).ad.split(" · ")[0]} sonunda`],
  ] : [["—", "Tahmin dönemi yok", "Tabloyu ileri kaydırın"]])}</div>`));
  if (notlar.length) ana.appendChild(el(`<div class="ipucu-kutu">${notlar.map(kacir).join("<br>")}</div>`));

  // Tablo
  const aylar = [];
  for (const s of v.sutunlar) { if (aylar.at(-1)?.ay === s.ay) aylar.at(-1).n += 1; else aylar.push({ ay: s.ay, n: 1 }); }
  const sinif = (s) => `${s.durum === "gercek" ? "g" : "t"} ${s.bu ? "bu" : ""} ${s.yari === 1 ? "ay-bas" : ""}`;
  const deger = (k, s) => v.degerler[k][s.donem]?.[pb];
  const hucre = (row, s) => {
    const d = deger(row.k, s);
    const sec = OG.secili?.k === row.k && OG.secili?.donem === s.donem ? "secili" : "";
    if (s.durum === "gercek") {
      return `<td class="${sinif(s)} ${sec}" data-k="${row.k}" data-d="${s.donem}">${d?.deger ? sayiMetni(d.deger) : `<span class="soluk">—</span>`}</td>`;
    }
    const ipucu = d?.elle ? `Elle düzeltildi. Sistemin hesabı: ${sayiMetni(d.sistem)} ${pb}` : "";
    return `<td class="${sinif(s)} ${sec} ${d?.elle ? "elle" : ""}" data-k="${row.k}" data-d="${s.donem}" ${ipucu ? `title="${kacir(ipucu)}"` : ""}>
      <input inputmode="decimal" data-ham="${d?.deger ?? ""}" value="${d?.deger ? sayiMetni(d.deger) : ""}" placeholder="—"></td>`;
  };
  const toplamSatiri = (ad, t, cls, k) => `<tr class="${cls}"><th>${ad}</th>${v.sutunlar.map((s) => {
    const n = t[s.donem]?.[pb] || 0;
    const sec = OG.secili?.k === k && OG.secili?.donem === s.donem ? "secili" : "";
    return `<td class="${sinif(s)} ${sec} ${n < 0 ? "eksi" : ""}" data-k="${k}" data-d="${s.donem}">${n ? sayiMetni(n) : `<span class="soluk">—</span>`}</td>`;
  }).join("")}</tr>`;
  const giderler = v.satirlar.filter((r) => r.tur === "gider");
  const tablo = el(`<div class="og-sar"><table class="og">
    <thead>
      <tr class="og-ay"><th rowspan="2" class="kose">${kacir(v.projeAd)}<small>${pb}</small></th>${aylar.map((a) => `<th colspan="${a.n}">${kacir(a.ay)}</th>`).join("")}</tr>
      <tr class="og-yari">${v.sutunlar.map((s) => `<th class="${sinif(s)}">${s.aralik}<small>${s.bu ? "bu dönem" : s.durum === "gercek" ? "gerçekleşen" : "tahmin"}</small></th>`).join("")}</tr>
    </thead>
    <tbody>
      <tr class="grup"><th colspan="${v.sutunlar.length + 1}"><span>Giderler</span></th></tr>
      ${giderler.map((r) => `<tr data-satir="${r.k}"><th>${kacir(r.ad)}</th>${v.sutunlar.map((s) => hucre(r, s)).join("")}</tr>`).join("")}
      ${toplamSatiri("Toplam gider", v.toplam.gider, "toplam", "_gider")}
      <tr class="grup"><th colspan="${v.sutunlar.length + 1}"><span>Gelirler</span></th></tr>
      <tr data-satir="gelir"><th>Gelirler</th>${v.sutunlar.map((s) => hucre(v.satirlar.find((x) => x.k === "gelir"), s)).join("")}</tr>
      ${toplamSatiri("Net (gelir − gider)", v.toplam.net, "toplam", "_net")}
      ${toplamSatiri("Kasa bakiyesi", v.toplam.bakiye, "bakiye", "_bakiye")}
    </tbody></table></div>`);
  ana.appendChild(tablo);

  const detay = el(`<div class="kart og-detay"></div>`);
  ana.appendChild(detay);
  ongoruDetayCiz(detay);

  // Kaydırma: ilk açılışta bu dönem görünür; gezinmede eski yer korunur.
  const sar = tablo;
  if (OG.kaydirma === "koru" && kaydirma !== undefined) sar.scrollLeft = kaydirma;
  else {
    const bu = sar.querySelector("th.bu");
    if (bu) sar.scrollLeft = Math.max(0, bu.offsetLeft - sar.querySelector("th.kose").offsetWidth - 2 * bu.offsetWidth);
  }
  OG.kaydirma = null;

  const sec = (k, donem) => {
    OG.secili = { k, donem };
    sar.querySelectorAll("td.secili").forEach((t) => t.classList.remove("secili"));
    sar.querySelector(`td[data-k="${k}"][data-d="${donem}"]`)?.classList.add("secili");
    ongoruDetayCiz(detay);
  };
  sar.addEventListener("click", (ev) => { const td = ev.target.closest("td[data-k]"); if (td) sec(td.dataset.k, td.dataset.d); });

  const girdiler = [...sar.querySelectorAll("td input")];
  for (const inp of girdiler) {
    const td = inp.closest("td");
    inp.addEventListener("focus", () => { inp.value = inp.dataset.ham ? String(inp.dataset.ham).replace(".", ",") : ""; inp.select(); sec(td.dataset.k, td.dataset.d); });
    inp.addEventListener("blur", () => {
      if (inp.dataset.degisti) return;
      inp.value = inp.dataset.ham ? sayiMetni(inp.dataset.ham) : "";
    });
    inp.addEventListener("input", () => { inp.dataset.degisti = "1"; });
    inp.addEventListener("keydown", (ev) => {
      const satirlar = [...sar.querySelectorAll("tr[data-satir]")];
      const r = satirlar.indexOf(inp.closest("tr"));
      const hedef = (dr, dd) => {
        const tr = satirlar[r + dr];
        const donem = dd ? donemKaydir(td.dataset.d, dd) : td.dataset.d;
        return tr?.querySelector(`td[data-d="${donem}"] input`);
      };
      let h = null;
      if (ev.key === "Enter" || ev.key === "ArrowDown") h = hedef(1, 0);
      else if (ev.key === "ArrowUp") h = hedef(-1, 0);
      else if (ev.key === "ArrowRight" && inp.selectionStart === inp.value.length) h = hedef(0, 1);
      else if (ev.key === "ArrowLeft" && inp.selectionStart === 0) h = hedef(0, -1);
      else if (ev.key === "Escape") { delete inp.dataset.degisti; inp.blur(); return; }
      else return;
      ev.preventDefault();
      if (h) h.focus(); else inp.blur();
    });
    inp.addEventListener("change", () => ongoruHucreKaydet(inp, td));
  }
}

/** "1.500", "1.500,25", "1500,25" ve "1500.25" aynı sayıya çevrilir. */
function trSayi(s) {
  let x = String(s || "").trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, "");
  return x.replace(",", ".");
}

async function ongoruHucreKaydet(inp, td) {
  const v = OG.veri;
  try {
    OG.veri = await api("/ongoru/hucre", {
      method: "PUT",
      body: JSON.stringify({ donem: td.dataset.d, satir: td.dataset.k, pb: OG.pb, proje: v.proje, deger: trSayi(inp.value), gorunum: { bas: v.bas, adet: v.adet, proje: v.proje } }),
    });
    // Kayıt sürerken odak başka hücreye geçmiş olabilir; yeniden çizimden sonra oraya dönülür.
    const sonraki = document.activeElement?.closest?.("td[data-k]");
    OG.odak = sonraki && sonraki !== td ? { k: sonraki.dataset.k, d: sonraki.dataset.d } : null;
    OG.kaydirma = "koru";
    ongoruSayfaCiz();
    if (OG.odak) ana.querySelector(`td[data-k="${OG.odak.k}"][data-d="${OG.odak.d}"] input`)?.focus();
  } catch (e) {
    hataBildir(e);
    delete inp.dataset.degisti;
    inp.value = inp.dataset.ham ? sayiMetni(inp.dataset.ham) : "";
  }
}

function ongoruDetayCiz(kutu) {
  const v = OG.veri, pb = OG.pb, s = OG.secili;
  const sut = s && v.sutunlar.find((x) => x.donem === s.donem);
  if (!sut) {
    kutu.innerHTML = `<div class="kart-bas"><h3>Hücre ayrıntısı</h3></div>
      <div class="kart-govde og-kaynaklar">${v.satirlar.map((r) => `<div><b>${kacir(r.ad)}</b>
        <span><i>gerçekleşen:</i> ${kacir(r.gercek)}</span><span><i>tahmin:</i> ${kacir(r.tahmin)}</span></div>`).join("")}
        <div><b>Kasa bakiyesi</b><span><i>gerçekleşen:</i> kasadaki dönem sonu bakiyesi</span><span><i>tahmin:</i> önceki dönemin bakiyesi + tahmini net</span></div>
        <p class="soluk">Bir hücreye tıklayınca hangi kişi, ekip, ev ya da kasa satırından geldiği burada listelenir.</p></div>`;
    return;
  }
  const tanim = v.satirlar.find((r) => r.k === s.k);
  const ad = tanim?.ad || { _gider: "Toplam gider", _net: "Net", _bakiye: "Kasa bakiyesi" }[s.k];
  const d = v.degerler[s.k]?.[s.donem]?.[pb];
  const kaynak = tanim ? (sut.durum === "gercek" ? tanim.gercek : tanim.tahmin) : "";
  let govde;
  if (!tanim) {
    const t = { _gider: v.toplam.gider, _net: v.toplam.net, _bakiye: v.toplam.bakiye }[s.k][s.donem]?.[pb] || 0;
    const parca = s.k === "_gider" ? v.satirlar.filter((r) => r.tur === "gider").map((r) => [r.ad, v.degerler[r.k][s.donem]?.[pb]?.deger || 0])
      : s.k === "_net" ? [["Gelir", v.toplam.gelir[s.donem]?.[pb] || 0], ["Gider", -(v.toplam.gider[s.donem]?.[pb] || 0)]]
        : [[sut.durum === "gercek" ? "Kasadaki dönem sonu bakiyesi" : "Önceki bakiye + tahmini net", t]];
    govde = `<table class="mini">${parca.map(([a, n]) => `<tr><td>${kacir(a)}</td><td class="sag-hiza">${sayiMetni(n)} ${pb}</td></tr>`).join("")}
      <tr class="toplam"><td><b>Toplam</b></td><td class="sag-hiza"><b>${sayiMetni(t)} ${pb}</b></td></tr></table>`;
  } else {
    const liste = d?.detay || [];
    govde = `${d?.elle ? `<div class="og-elle">Elle düzeltildi: <b>${sayiMetni(d.deger)} ${pb}</b>. Sistemin hesabı: <b>${sayiMetni(d.sistem)} ${pb}</b>
        <button class="dg ufak" data-is="sistem">Sistemin hesabına dön</button></div>` : ""}
      ${liste.length ? `<table class="mini">${liste.slice(0, 40).map((x) => `<tr><td>${kacir(x.ad)}</td><td class="sag-hiza">${sayiMetni(x.tutar)} ${pb}</td></tr>`).join("")}
        ${liste.length > 40 ? `<tr><td class="soluk">… ${liste.length - 40} kalem daha</td><td></td></tr>` : ""}
        <tr class="toplam"><td><b>Sistemin hesabı</b></td><td class="sag-hiza"><b>${sayiMetni(d.sistem)} ${pb}</b></td></tr></table>`
        : `<div class="liste-bos">Bu hücreye ${pb} cinsinden veri gelmiyor.</div>`}`;
  }
  kutu.innerHTML = `<div class="kart-bas"><h3>${kacir(ad)} · ${kacir(sut.ad)}</h3>
    <div class="sag"><span class="pul-d ${sut.durum === "gercek" ? "elle" : "otomatik"}">${sut.durum === "gercek" ? "gerçekleşen" : "tahmin"}</span>
    <button class="dg ufak" data-is="kapat">Kapat</button></div></div>
    <div class="kart-govde">${kaynak ? `<p class="soluk og-kaynak">${kacir(kaynak)}</p>` : ""}${govde}</div>`;
  kutu.querySelector('[data-is="kapat"]').onclick = () => {
    OG.secili = null; ana.querySelectorAll(".og td.secili").forEach((t) => t.classList.remove("secili")); ongoruDetayCiz(kutu);
  };
  kutu.querySelector('[data-is="sistem"]')?.addEventListener("click", async () => {
    try {
      OG.veri = await api("/ongoru/hucre", {
        method: "PUT",
        body: JSON.stringify({ donem: s.donem, satir: s.k, pb, proje: v.proje, deger: "", gorunum: { bas: v.bas, adet: v.adet, proje: v.proje } }),
      });
      bildir("Sistemin hesabına dönüldü", "", "iyi");
      OG.kaydirma = "koru"; ongoruSayfaCiz();
    } catch (e) { hataBildir(e); }
  });
}

/* ---------------- ÖDEMELER ---------------- */

const OD = { ay: "", tarih: {} };
const GUN_ADLARI = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const tarihUzun = (g) => {
  const d = new Date(`${g}T00:00:00`);
  return `${d.getDate()} ${["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"][d.getMonth()]} ${d.getFullYear()} · ${GUN_ADLARI[d.getDay()]}`;
};
const tarihKisa = (g) => (g ? g.split("-").reverse().join(".") : "");

/** Ödeme kaleminin altındaki kısa açıklama: hesabın nereden geldiği. */
function odemeDetayMetni(k) {
  const d = k.detay || {};
  if (k.tur === "yemek") return `${d.gun} gün × ${sayiMetni(d.gunluk)} ${k.paraBirimi} (önden)`;
  if (k.tur === "kira") return `${d.kisi ? `${d.kisi} kişi kalıyor` : "ev boş"} · kira ${sayiMetni(d.kira)} ${k.paraBirimi} (${(d.periyot || "Aylık").toLocaleLowerCase("tr")})`;
  if (k.tur === "saatlik" || k.tur === "aylik") {
    const kd = d.kesintiDetay || {};
    const p = [`hakediş ${sayiMetni(d.hakedis)}`];
    if (d.mesaiTutar) p.push(`mesai ${sayiMetni(d.mesai)} sa = ${sayiMetni(d.mesaiTutar)}`);
    if (d.kesinti) p.push(`kesinti −${sayiMetni(d.kesinti)}${d.gelmedi ? ` (${d.gelmedi} gün gelmedi: maaş ${sayiMetni(kd.maas + kd.eksikSaat)}, kira ${sayiMetni(kd.kira)}, yemek ${sayiMetni(kd.yemek)})` : ""}`);
    if (d.avans) p.push(`avans −${sayiMetni(d.avans)}`);
    if (k.tur === "aylik" && d.ilkYari !== null && d.ilkYari !== undefined) p.push(`1. yarı neti ${sayiMetni(d.ilkYari)} dahil`);
    return p.join(" · ");
  }
  return "";
}

async function odemelerCiz(ay) {
  OD.ay = ay || OD.ay || "bu";
  ana.innerHTML = `<div class="bos"><span class="yukleniyor"></span></div>`;
  await kaynaklariYukle();
  const v = await api(`/odeme/${OD.ay}`);
  OD.ay = v.ay;
  const bugun = bugunMetni();
  const personelId = new Map(kayitlar("personel").map((p) => [p.kod, p._id]));
  const evId = new Map(kayitlar("ev").map((e) => [e.kod, e._id]));

  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas"><div><h2>Ödemeler</h2>
    <p>Kime, ne zaman, ne kadar ödenecek. Ayın 1'inde kiralar ve aylık maaşlar, her 15 günde saatlik ücretler ve önden yemek paraları.
      "Ödendi" işaretlenen kalem, ödeme tarihiyle kasaya gider olarak düşer. Ödenen tutar hesaplanandan farklı olabilir.</p></div></div>`));

  const arac = el(`<div class="pt-filtre kasa-arac"><div class="ay-gez">
    <a class="dg ufak" href="#odemeler/${v.onceki}" title="Önceki ay">‹</a><b>${kacir(v.ad)}</b>
    <a class="dg ufak" href="#odemeler/${v.sonraki}" title="Sonraki ay">›</a>
    ${v.ay !== v.buAy ? `<a class="dg ufak" href="#odemeler/${v.buAy}">Bu ay</a>` : ""}</div></div>`);
  ana.appendChild(arac);

  if (v.gecikmis.adet) {
    ana.appendChild(el(`<div class="od-uyari">Önceki aylarda ödenmemiş <b>${v.gecikmis.adet} kalem</b> var.
      <a class="dg ufak" href="#odemeler/${v.gecikmis.enEski.slice(0, 7)}">En eskisine git (${tarihKisa(v.gecikmis.enEski)})</a></div>`));
  }

  const pbler = pbListesi(v.ozet.toplam, v.ozet.odenen);
  const ozetK = kart(`${v.ad} · Özet`, `<span class="mono soluk">${v.ozet.odenmis} / ${v.ozet.adet} kalem ödendi</span>`);
  ozetK.querySelector(".kart-govde").innerHTML = pbler.length
    ? `<table class="mini kasa-ozet"><thead><tr><th></th><th>Ödenecek (hesaplanan)</th><th>Ödenen</th><th>Kalan</th></tr></thead><tbody>
      ${pbler.map((pb) => `<tr><td class="pb">${pb}</td><td>${sayiMetni(v.ozet.toplam[pb] || 0)}</td>
        <td class="gelir">${sayiMetni(v.ozet.odenen[pb] || 0)}</td><td class="bakiye ${v.ozet.kalan[pb] ? "eksi" : ""}"><b>${sayiMetni(v.ozet.kalan[pb] || 0)}</b></td></tr>`).join("")}
      ${anaSatirHtml([v.ozet.toplam, v.ozet.odenen, v.ozet.kalan])}
      </tbody></table>`
    : bosSatir("Bu ay vadesi gelen ödeme yok. Ödemeler puantaj dönemleri açılıp kapandıkça oluşur.");
  ana.appendChild(ozetK);

  for (const g of v.gunler) {
    const gk = el(`<div class="kart od-gun ${g.gecti ? "gecti" : ""}">
      <div class="kart-bas"><h3>${kacir(tarihUzun(g.vade))}</h3><div class="sag">
        ${g.ozet.odenmis < g.ozet.adet && g.vade < bugun ? `<span class="pul-d gider">vadesi geçti</span>` : ""}
        <span class="mono soluk">${g.ozet.odenmis}/${g.ozet.adet} ödendi · kalan ${toplamMetni(g.ozet.kalan)}</span></div></div>
      <div class="kart-govde"></div></div>`);
    ana.appendChild(gk);
    const govde = gk.querySelector(".kart-govde");

    for (const gr of g.gruplar) {
      const anahtar = `${g.vade}|${gr.tur}`;
      const tarih = OD.tarih[anahtar] || (g.vade < bugun ? bugun : g.vade);
      const bekleyen = gr.kalemler.filter((k) => !k.odendi);
      const grEl = el(`<div class="od-grup">
        <div class="od-grup-bas"><b>${kacir(gr.ad)}</b>
          <span class="soluk">${gr.ozet.odenmis}/${gr.ozet.adet} ödendi · toplam ${toplamMetni(gr.ozet.toplam)}</span>
          <label class="kucuk-et">Ödeme tarihi <input type="date" class="od-tarih" value="${tarih}"></label>
          <button class="dg ufak bas" data-is="tumu" ${bekleyen.length ? "" : "disabled"}>Tümü ödendi${bekleyen.length ? ` (${bekleyen.length})` : ""}</button>
        </div>
        <div class="tablo-sar od-sar"><table class="mini od-tablo"><thead><tr>
          <th class="od-tik">Ödendi</th><th>${gr.tur === "kira" ? "Ev" : "Kişi"}</th><th>Açıklama</th><th class="sag-h">Hesaplanan</th>
          <th class="sag-h">Ödenen</th><th>Not</th><th>Durum</th></tr></thead><tbody></tbody></table></div></div>`);
      govde.appendChild(grEl);
      const tbody = grEl.querySelector("tbody");
      const tarihGir = grEl.querySelector(".od-tarih");
      tarihGir.onchange = () => { OD.tarih[anahtar] = tarihGir.value; };

      for (const k of gr.kalemler) {
        const o = k.odeme;
        const link = k.personelKod && personelId.get(k.personelKod) ? `#d/personel/${personelId.get(k.personelKod)}`
          : k.evKod && evId.get(k.evKod) ? `#d/ev/${evId.get(k.evKod)}` : "";
        const fark = o && o.tutar !== o.sistemTutar ? o.tutar - o.sistemTutar : 0;
        const notlar = [
          k.uyari ? `<span class="pul-d duzeltildi" title="${kacir(k.uyari)}">kontrol</span>` : "",
          k.degisti !== null && k.degisti !== undefined ? `<span class="pul-d duzeltildi" title="Ödendikten sonra hesap değişti">hesap değişti: ${sayiMetni(k.degisti)}</span>` : "",
          k.kaynakYok ? `<span class="pul-d elle" title="Dönem yeniden açıldı ya da kayıt değişti; ödeme kaydı duruyor">kaynağı yok</span>` : "",
        ].join(" ");
        const tr = el(`<table><tr class="${k.odendi ? "odendi" : ""}" data-a="${kacir(k.anahtar)}">
          <td class="od-tik"><input type="checkbox" ${k.odendi ? "checked" : ""}></td>
          <td>${link ? `<a href="${link}">${kacir(k.kim)}</a>` : kacir(k.kim)}</td>
          <td>${kacir(k.aciklama)}<div class="od-detay">${kacir(odemeDetayMetni(k))}</div></td>
          <td class="sag-h mono">${sayiMetni(k.tutar)} ${kacir(k.paraBirimi)}</td>
          <td class="sag-h"><input class="od-tutar" type="number" step="0.01" min="0" value="${o ? o.tutar : k.tutar}">
            ${fark ? `<div class="od-fark ${fark < 0 ? "eksi" : ""}">${fark > 0 ? "+" : ""}${sayiMetni(fark)}</div>` : ""}</td>
          <td><input class="od-not" placeholder="ör. elden, yuvarlandı" value="${kacir(o?.not || "")}"></td>
          <td class="od-durum">${o ? `<span class="pul-d gelir">ödendi ${tarihKisa(o.tarih)}</span>` : `<span class="pul-d ${k.vade < bugun ? "gider" : ""}">bekliyor</span>`} ${notlar}</td>
        </tr></table>`).querySelector("tr");
        tbody.appendChild(tr);

        const kaydet = async (tarihi) => {
          try {
            await api("/odeme", { method: "POST", body: JSON.stringify({ liste: [{
              anahtar: k.anahtar, tarih: tarihi, tutar: tr.querySelector(".od-tutar").value, not: tr.querySelector(".od-not").value,
            }] }) });
            await durumYukle(); gezintiCiz();
            return true;
          } catch (e) { hataBildir(e); return false; }
        };
        const kutu = tr.querySelector("input[type=checkbox]");
        kutu.onchange = async () => {
          if (kutu.checked) {
            if (await kaydet(tarihGir.value)) { bildir("Ödendi", `${k.kim} · ${sayiMetni(tr.querySelector(".od-tutar").value)} ${k.paraBirimi} kasaya gider olarak yazıldı.`, "iyi"); odemelerCiz(OD.ay); }
            else kutu.checked = false;
            return;
          }
          const ok = await onay("Ödendi işareti kaldırılsın mı?", `${k.kim} · ${k.aciklama}. Kasadaki gider satırı da silinir.`, "Kaldır");
          if (!ok) { kutu.checked = true; return; }
          try {
            await api("/odeme/geri-al", { method: "POST", body: JSON.stringify({ anahtar: k.anahtar }) });
            bildir("Ödendi işareti kaldırıldı", "", "iyi");
            await durumYukle(); gezintiCiz(); odemelerCiz(OD.ay);
          } catch (e) { hataBildir(e); kutu.checked = true; }
        };
        // Ödenmiş kalemde tutar ya da not değişirse kayıt (ve kasa satırı) güncellenir.
        for (const sec of [".od-tutar", ".od-not"]) {
          tr.querySelector(sec).onchange = async () => {
            if (!k.odendi) return;
            if (await kaydet(o.tarih)) { bildir("Ödeme güncellendi", "Kasadaki satır da güncellendi.", "iyi"); odemelerCiz(OD.ay); }
          };
        }
      }

      grEl.querySelector('[data-is="tumu"]').onclick = async () => {
        const tutarlar = {};
        for (const k of bekleyen) {
          const tr = tbody.querySelector(`tr[data-a="${CSS.escape(k.anahtar)}"]`);
          const t = Number(tr.querySelector(".od-tutar").value) || 0;
          tutarlar[k.paraBirimi] = (tutarlar[k.paraBirimi] || 0) + t;
        }
        const ok = await onay(`${gr.ad}: tümü ödendi mi?`,
          `${bekleyen.length} kalem ${tarihKisa(tarihGir.value)} tarihiyle ödendi işaretlenecek: ${toplamMetni(tutarlar)}. Her biri kasaya gider olarak düşer.`, "Tümü ödendi");
        if (!ok) return;
        try {
          const liste = bekleyen.map((k) => {
            const tr = tbody.querySelector(`tr[data-a="${CSS.escape(k.anahtar)}"]`);
            return { anahtar: k.anahtar, tarih: tarihGir.value, tutar: tr.querySelector(".od-tutar").value, not: tr.querySelector(".od-not").value };
          });
          const r = await api("/odeme", { method: "POST", body: JSON.stringify({ liste }) });
          bildir("Tümü ödendi", `${r.adet} kalem kasaya gider olarak yazıldı.`, "iyi");
          await durumYukle(); gezintiCiz(); odemelerCiz(OD.ay);
        } catch (e) { hataBildir(e); }
      };
    }
  }

  if (!v.gunler.length) {
    ana.appendChild(el(`<div class="kart"><div class="bos"><div class="bs">Bu ay ödeme günü yok</div>
      <p>Yemek paraları ve kiralar puantaj dönemi açılınca, maaşlar dönem kapanınca burada listelenir.</p></div></div>`));
  }
}

/* ---------------- AYARLAR ---------------- */

function ayarlarCiz() {
  const d = S.durum;
  ana.innerHTML = "";
  ana.appendChild(el(`<div class="sayfa-bas">
    <div><h2>Ayarlar</h2><p>Belgelerin nereye yazılacağı ve yapay zekâ katmanının nasıl çalışacağı.</p></div>
  </div>`));

  const modlar = [
    ["karma", "Kural + yapay zekâ", "Önce dosya adı kuralları çalışır. Kural yeterince emin olamazsa belge Claude'a gönderilir. Günlük kullanım için en dengeli seçenek."],
    ["sadeceAi", "Sadece yapay zekâ", "Her belge Claude'a gider. En isabetli sonuç, en yüksek maliyet."],
    ["sadeceKural", "Sadece kural", "Hiçbir belge dışarı çıkmaz, internet gerekmez, ücretsizdir. Dosya adları düzensizse isabet oranı düşer."],
  ];

  const kart = el(`<div class="kart"><div class="ayar-blok">

    <div class="ayar-sat">
      <div class="et">Belge kökü<small>Tüm klasörlerin açılacağı ana dizin. Ağ sürücüsü de olabilir.</small></div>
      <div><input type="text" id="ayKok" value="${kacir(d.belgeKoku)}">
        <div class="ipuc">Değiştirirseniz eski klasörler taşınmaz — yeni kökte yapıyı baştan kurmanız gerekir.</div></div>
    </div>

    <div class="ayar-sat">
      <div class="et">Yapay zekâ modu<small>Belgelerin nasıl sınıflandırılacağı.</small></div>
      <div class="secim-grup" id="ayMod">
        ${modlar.map(([v, b, a]) => `<label class="secim-og ${d.aiModu === v ? "secili" : ""}">
          <input type="radio" name="aimod" value="${v}" ${d.aiModu === v ? "checked" : ""}>
          <span><span class="bs">${b}</span><span class="ac">${a}</span></span></label>`).join("")}
      </div>
    </div>

    <div class="ayar-sat">
      <div class="et">Claude API anahtarı<small>Yapay zekâ katmanı için gerekir. Bilgisayardan dışarı çıkmaz, veri/db.json içinde saklanır.</small></div>
      <div><input type="password" id="ayAnahtar" placeholder="${d.apiAnahtariVar ? "•••••••• (kayıtlı, değiştirmek için yeni anahtar yazın)" : "sk-ant-..."}">
        <div class="ipuc">Şu an: <b>${d.apiAnahtariVar ? `açık — kaynak: ${kacir(d.apiKaynagi)}` : "kapalı"}</b>.
        Anahtarı console.anthropic.com adresinden alırsınız. Kullanılan model: claude-opus-5.</div></div>
    </div>

    <div class="ayar-sat">
      <div class="et">Sesli komut<small>Konuşarak puantaj, avans, kasa ve ödeme kaydı. Ses ve cümle asistan sunucusuna (n8n) gider.</small></div>
      <div>
        <input type="text" id="ayAsAdres" value="${kacir(d.asistan?.adres || "")}" placeholder="${kacir(d.asistan?.varsayilanAdres || "https://n8n.ornek.com")} (boş bırakılabilir)" autocomplete="off">
        <input type="password" id="ayAsAnahtar" style="margin-top:6px" autocomplete="off"
          placeholder="${d.asistan?.anahtarVar ? "•••••••• (kayıtlı, değiştirmek için yeni anahtar yazın)" : d.asistan?.gomulu ? "programda hazır — bir şey girmeniz gerekmez" : "asistan anahtarı"}">
        <div class="ipuc">Şu an: <b>${d.asistan?.hazir ? "açık" : "kapalı"}</b>. ${d.asistan?.gomulu ? "Anahtar programla birlikte geldi." : "Anahtarı sistemi kuran kişi verir."} Adres boş kalırsa varsayılan sunucu kullanılır.
          Anahtar bu bilgisayarda kalır, yedeğe girmez. Asistan sunucusuna personel adları ile puantaj, avans, ödeme ve kasa özetleri gider;
          IBAN, telefon, pasaport ve notlar gitmez. Asistanı iyileştirmek için söylenen komut, asistanın yaptığı işlem ve
          sonucu (onaylandı / vazgeçildi / geri alındı) sunucuda kayıt altına alınır; ses kaydedilmez.</div>
      </div>
    </div>

    <div class="ayar-sat">
      <div class="et">Yapay zekâya sorma eşiği<small>Kural motorunun güveni bu değerin altındaysa Claude devreye girer.</small></div>
      <div><input type="number" id="ayEsik" min="0" max="1" step="0.01" value="${d.esik}">
        <div class="ipuc">Yükseltirseniz daha çok belge Claude'a gider (daha isabetli, daha pahalı). Sadece "Kural + yapay zekâ" modunda etkilidir.</div></div>
    </div>

    <div class="ayar-sat">
      <div class="et">Kullanıcı adı<small>Belge Defteri'ne kimin işlem yaptığı yazılır.</small></div>
      <div><input type="text" id="ayKullanici" value="${kacir(d.kullanici)}"></div>
    </div>

    <div class="ayar-sat">
      <div class="et">Para birimi ve kur<small>Kur elle girilir; internetten çekilmez.</small></div>
      <div>
        <label class="kur-sat"><span>Ana para birimi</span><select id="ayAnaPB">${["EUR", "TRY", "RSD"].map((pb) =>
          `<option ${(d.kur?.ana || "EUR") === pb ? "selected" : ""}>${pb}</option>`).join("")}</select></label>
        <div id="ayKurlar"></div>
        <div class="ipuc">Puantajda maaştan farklı para birimindeki yemek, kira ve avans bu kurla çevrilip maaştan düşülür
          (ör. 600 RSD ÷ 117 = 5,13 EUR). Kasa, Ödemeler ve puantaj özetlerindeki "≈" satırı ana para birimindeki karşılıktır.<br>
          Yeni açılan puantaj dönemleri kuru buradan kopyalar; açık bir dönemin kuru puantaj panelinden "Güncel kuru al" ile değişir.
          Kapalı dönemler ve "ödendi" işaretlenmiş ödemeler değişmez.</div>
      </div>
    </div>

    <div class="ayar-sat">
      <div class="et">Görünüm<small>Koyu ve açık tema.</small></div>
      <div><select id="ayTema">
        <option value="">Sistem ayarını kullan</option>
        <option value="light">Açık</option>
        <option value="dark">Koyu</option>
      </select></div>
    </div>

    <div class="ayar-sat">
      <div class="et">Veri ve yedek<small>Kayıtları başka bir bilgisayara taşımak ya da yedeklemek için.</small></div>
      <div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="dg" id="yedekIndir">Yedeği indir</button>
          <button class="dg" id="yedekYukle">Yedekten yükle…</button>
          <input type="file" id="yedekDosya" accept=".json,application/json" hidden>
        </div>
        <div class="ipuc">Yedek, tüm kayıtları (personel, ekipler, puantaj, kasa, öngörü…) tek bir <b>.json</b> dosyasına yazar.
          Başka bilgisayarda "Yedekten yükle" ile açılır; oradaki kayıtların yerini alır, eskileri önce
          <code style="font-family:var(--f-mono)">veri/yedekler</code> klasörüne saklanır. API anahtarı yedeğe girmez.<br>
          Belgeler (PDF, fotoğraf) yedeğe girmez; gerekirse şu klasörü ayrıca kopyalayın:
          <code style="font-family:var(--f-mono)">${kacir(d.belgeKoku)}</code></div>
      </div>
    </div>

    <div class="ayar-sat">
      <div class="et">Kayıtları sıfırla<small>Deneme kayıtlarından kurtulup temiz başlamak için.</small></div>
      <div>
        <button class="dg tehlike" id="sifirla">Tüm kayıtları sil…</button>
        <div class="ipuc">Personel, ekip, proje, ev, araç, müşteri, zimmet, avans, puantaj, kasa, ödeme ve Belge Defteri kayıtları silinir.
          Ayarlar (belge kökü, kur, API anahtarı) kalır. Silmeden önce otomatik yedek alınır
          (<code style="font-family:var(--f-mono)">veri/yedekler</code>); yanlışlıkla silinirse "Yedekten yükle" ile geri gelir.</div>
      </div>
    </div>

  </div>
  <div class="kart-bas" style="border-top:1px solid var(--line);border-bottom:0">
    <div class="sag" style="margin-left:0"><button class="dg bas" id="ayKaydet">Ayarları kaydet</button></div>
  </div></div>`);
  ana.appendChild(kart);

  const temaSec = kart.querySelector("#ayTema");
  temaSec.value = localStorage.getItem("kadro-tema") || "";
  temaSec.onchange = () => {
    const v = temaSec.value;
    if (v) { document.documentElement.setAttribute("data-theme", v); localStorage.setItem("kadro-tema", v); }
    else { document.documentElement.removeAttribute("data-theme"); localStorage.removeItem("kadro-tema"); }
  };

  kart.querySelectorAll('input[name="aimod"]').forEach((r) => {
    r.onchange = () => kart.querySelectorAll(".secim-og").forEach((o) => o.classList.toggle("secili", o.contains(r) && r.checked));
  });

  // Kur: 1 ana = x diğer. Ana para birimi değişince girilmiş oranlar yeni anaya göre yeniden yazılır.
  const kurD = { ana: d.kur?.ana || "EUR", oran: { ...(d.kur?.oran || {}) } };
  const kurKutu = kart.querySelector("#ayKurlar");
  const kurOku = () => {
    for (const i of kurKutu.querySelectorAll("[data-kur]")) {
      const n = Number(i.value.replace(",", "."));
      if (i.value.trim() && n > 0) kurD.oran[i.dataset.kur] = n; else delete kurD.oran[i.dataset.kur];
    }
  };
  const kurCiz = () => {
    kurKutu.innerHTML = ["EUR", "TRY", "RSD"].filter((pb) => pb !== kurD.ana).map((pb) =>
      `<label class="kur-sat"><span>1 ${kurD.ana} =</span><input type="number" step="any" min="0" data-kur="${pb}" value="${kurD.oran[pb] ?? ""}" placeholder="girilmedi"><span>${pb}</span></label>`).join("");
  };
  kurCiz();
  kart.querySelector("#ayAnaPB").onchange = (ev) => {
    kurOku();
    const yeni = ev.target.value;
    const o = { ...kurD.oran, [kurD.ana]: 1 };
    const oran = {};
    if (o[yeni]) for (const [pb, v] of Object.entries(o)) if (pb !== yeni) oran[pb] = Number((v / o[yeni]).toPrecision(10));
    kurD.ana = yeni; kurD.oran = oran;
    kurCiz();
  };

  kart.querySelector("#yedekIndir").onclick = () => { location.href = "/api/yedek"; };
  const yedekDosya = kart.querySelector("#yedekDosya");
  kart.querySelector("#yedekYukle").onclick = () => yedekDosya.click();
  yedekDosya.onchange = async () => {
    const f = yedekDosya.files[0];
    yedekDosya.value = "";
    if (!f) return;
    const ok = await onay("Yedekten yüklensin mi?",
      `"${f.name}" yüklenecek. Bu bilgisayardaki tüm kayıtlar yedektekilerle DEĞİŞTİRİLİR. ` +
      "Mevcut kayıtlar önce veri/yedekler klasörüne kaydedilir. Belge kökü ve API anahtarı bu bilgisayardaki gibi kalır.", "Yedekten yükle");
    if (!ok) return;
    const fd = new FormData(); fd.append("dosya", f);
    try {
      const r = await api("/yedek", { method: "POST", body: fd });
      const z = r.sayilar;
      bildir("Yedek yüklendi", `${z.personel} personel, ${z.ekip} ekip, ${z.proje} proje, ${z.puantaj} puantaj dönemi, ${z.kasa} kasa satırı. ` +
        `Önceki kayıtlar: ${r.eskiYedek}`, "iyi");
      S.agac = null; S.hedefler = [];
      for (const k of Object.keys(tabloDurum)) delete tabloDurum[k];
      await durumYukle(); gezintiCiz(); ayarlarCiz();
    } catch (e) { hataBildir(e); }
  };

  kart.querySelector("#sifirla").onclick = async () => {
    const secim = await sifirlaPano();
    if (!secim) return;
    try {
      const r = await api("/sifirla", { method: "POST", body: JSON.stringify({ onay: "SİL", belgeler: secim.belgeler }) });
      bildir("Kayıtlar sıfırlandı", `Önceki kayıtların yedeği: ${r.yedek}` +
        (r.eskiKok ? `. Eski belgeler kenara alındı: ${r.eskiKok}` : ""), "iyi");
      S.agac = null; S.hedefler = [];
      for (const k of Object.keys(tabloDurum)) delete tabloDurum[k];
      await durumYukle(); gezintiCiz(); ayarlarCiz();
    } catch (e) { hataBildir(e); }
  };

  kart.querySelector("#ayKaydet").onclick = async (ev) => {
    ev.target.disabled = true;
    const yeni = {
      belgeKoku: kart.querySelector("#ayKok").value.trim(),
      aiModu: kart.querySelector('input[name="aimod"]:checked')?.value || "karma",
      esik: Number(kart.querySelector("#ayEsik").value),
      kullanici: kart.querySelector("#ayKullanici").value.trim() || "Yönetici",
    };
    kurOku();
    yeni.kur = { ana: kurD.ana, oran: kurD.oran };
    const anahtar = kart.querySelector("#ayAnahtar").value.trim();
    if (anahtar) yeni.apiAnahtari = anahtar;
    yeni.asistanAdres = kart.querySelector("#ayAsAdres").value.trim();
    const asAnahtar = kart.querySelector("#ayAsAnahtar").value.trim();
    if (asAnahtar) yeni.asistanAnahtari = asAnahtar;
    try {
      await api("/ayarlar", { method: "POST", body: JSON.stringify(yeni) });
      bildir("Ayarlar kaydedildi", "", "iyi");
      S.agac = null; S.hedefler = [];
      await durumYukle(); ustBilgiCiz(); ayarlarCiz();
    } catch (e) { hataBildir(e); }
    ev.target.disabled = false;
  };
}

/** Sıfırlama onayı: iki adım. 1) ne silineceği ve belge klasörü seçimi, 2) "SİL" yazarak onay. Döner: { belgeler } ya da null. */
function sifirlaPano() {
  return new Promise((coz) => {
    const s = S.durum.sayilar;
    const p = el(`<div class="pano"><div class="pano-ic">
      <div class="pano-bas"><h3>Tüm kayıtlar silinsin mi?</h3></div>
      <div class="pano-govde">
        <div data-adim="1">
          <p style="margin:0 0 10px">Şu kayıtlar silinecek: ${s.personel} personel, ${s.ekip} ekip, ${s.proje} aktif proje, ${s.ev} ev,
            ${s.arac} araç, ${s.musteri} müşteri, ${s.avans} avans, ${s.kasa} kasa satırı, ${s.belge} belge kaydı ve bütün puantaj dönemleri.</p>
          <p style="margin:0 0 12px" class="soluk">Silmeden önce otomatik yedek alınır. Ayarlar (belge kökü, kur, API anahtarı) kalır.</p>
          <label style="display:flex;gap:9px;align-items:flex-start;cursor:pointer">
            <input type="checkbox" data-belge style="margin-top:3px;accent-color:var(--kotu)">
            <span><b>Belge klasörünü de temizle</b><br><span class="soluk" style="font-size:12.5px">Belgeler silinmez:
              <code style="font-family:var(--f-mono)">${kacir(S.durum.belgeKoku)}</code> klasörü "(eski tarih)" adıyla kenara alınır,
              yerine boş klasör yapısı kurulur. İşaretlemezseniz belgeler olduğu gibi kalır.</span></span>
          </label>
        </div>
        <div data-adim="2" hidden>
          <p style="margin:0 0 10px">Son adım. Onaylamak için kutuya büyük harflerle <b>SİL</b> yazın.</p>
          <input type="text" data-yazi autocomplete="off" style="width:100%;padding:8px 10px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);font-size:14px">
        </div>
      </div>
      <div class="pano-alt"><button class="dg" data-h>Vazgeç</button><button class="dg bas" data-e>Devam et</button></div>
    </div></div>`);
    const kapat = (v) => { p.remove(); coz(v); };
    const e = p.querySelector("[data-e]"), yazi = p.querySelector("[data-yazi]");
    let adim = 1;
    p.querySelector("[data-h]").onclick = () => kapat(null);
    p.onclick = (ev) => { if (ev.target === p) kapat(null); };
    // Türkçe klavyesi olmayan bilgisayarda "SIL" de kabul edilir.
    yazi.oninput = () => { e.disabled = !["SİL", "SIL"].includes(yazi.value.trim().toLocaleUpperCase("tr")); };
    e.onclick = () => {
      if (adim === 1) {
        adim = 2;
        p.querySelector('[data-adim="1"]').hidden = true;
        p.querySelector('[data-adim="2"]').hidden = false;
        e.textContent = "Tüm kayıtları sil"; e.disabled = true; e.style.background = "var(--kotu)"; e.style.borderColor = "var(--kotu)";
        yazi.focus();
        return;
      }
      kapat({ belgeler: p.querySelector("[data-belge]").checked });
    };
    document.getElementById("panoAlani").appendChild(p);
    e.focus();
  });
}

/* ---------------- SESLİ KOMUT ---------------- */

// Konuşma → n8n (yazıya dökme + model) → onay kartları. Hiçbir şey Onayla'ya basılmadan yazılmaz.
const AS = { konusmaId: null, kayit: null, parcalar: [], baslangic: 0, sayac: null, mesgul: false };
const MIK_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>`;

function asistanDugmesiKur() {
  const d = el(`<button class="as-dugme" id="asDugme" title="Sesli komut" aria-label="Sesli komut">${MIK_SVG}</button>`);
  d.onclick = () => (document.getElementById("asPano") ? asistanKapat() : asistanAc());
  document.body.appendChild(d);
}

function asistanKapat() {
  if (AS.kayit?.state === "recording") AS.kayit.stop();
  document.getElementById("asPano")?.remove();
  document.getElementById("asDugme")?.classList.remove("acik");
}

async function asistanAc() {
  const hazir = S.durum?.asistan?.hazir;
  const p = el(`<aside class="as-pano" id="asPano" aria-label="Sesli komut">
    <div class="as-bas"><h3>Sesli komut</h3>
      <button class="dg ufak" data-yeni title="Önceki konuşmayı unut">Yeni konuşma</button>
      <button class="as-kapat" data-kapat aria-label="Kapat">×</button></div>
    <div class="as-akis" data-akis>
      ${hazir ? `<div class="as-ipucu">Mikrofona dokunup konuşun, bitince tekrar dokunun. Örnek:<br>
        <i>"Yiğit bugün gelmedi, Burak 10 saat çalıştı"</i> · <i>"Mehmet'e 100 euro avans verdim"</i> ·
        <i>"Yiğit bu ay ne alacak?"</i><br>Hiçbir şey siz <b>Onayla</b>'ya basmadan yazılmaz.</div>`
        : `<div class="as-ipucu">Sesli komut henüz açık değil. Size verilen anahtarı <a href="#ayarlar">Ayarlar</a> → Sesli komut alanına girin.</div>`}
    </div>
    <div class="as-alt">
      <button class="as-mik" data-mik ${hazir ? "" : "disabled"}>${MIK_SVG}<span>Konuşmak için dokunun</span></button>
      <form class="as-form" data-form><input type="text" data-metin placeholder="ya da yazın…" autocomplete="off" ${hazir ? "" : "disabled"}>
        <button class="dg" ${hazir ? "" : "disabled"}>Gönder</button></form>
    </div>
    <details class="as-gunluk" data-gunluk><summary>Son işlemler</summary><div data-gunluk-liste><div class="soluk">Yükleniyor…</div></div></details>
  </aside>`);
  document.body.appendChild(p);
  document.getElementById("asDugme").classList.add("acik");
  p.querySelector("[data-kapat]").onclick = asistanKapat;
  p.querySelector("[data-yeni]").onclick = () => {
    AS.konusmaId = null;
    p.querySelector("[data-akis]").querySelectorAll(".as-balon,.as-kart,.as-cevap").forEach((x) => x.remove());
  };
  p.querySelector("[data-mik]").onclick = () => (AS.kayit?.state === "recording" ? AS.kayit.stop() : kayitBaslat());
  p.querySelector("[data-form]").onsubmit = (ev) => {
    ev.preventDefault();
    const i = p.querySelector("[data-metin]");
    const m = i.value.trim();
    if (!m || AS.mesgul) return;
    i.value = "";
    komutGonder({ metin: m });
  };
  p.querySelector("[data-gunluk]").ontoggle = (ev) => { if (ev.target.open) gunlukCiz(); };
  if (hazir) p.querySelector("[data-metin]").focus();
}

function akisaEkle(dugum) {
  const akis = document.querySelector("#asPano [data-akis]");
  if (!akis) return null;
  akis.querySelector(".as-ipucu")?.remove();
  akis.appendChild(dugum);
  akis.scrollTop = akis.scrollHeight;
  return dugum;
}

async function kayitBaslat() {
  if (AS.mesgul) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    return hataBildir(new Error("Bu tarayıcı mikrofona erişemiyor. Telefonda HTTPS adresinden açılmalı."));
  }
  let akim;
  try { akim = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return hataBildir(new Error("Mikrofon izni verilmedi. Tarayıcının adres çubuğundan mikrofona izin verin.")); }
  const tur = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  const k = new MediaRecorder(akim, tur ? { mimeType: tur } : undefined);
  AS.kayit = k; AS.parcalar = []; AS.baslangic = Date.now();
  const mik = document.querySelector("#asPano [data-mik]");
  const yazi = mik?.querySelector("span");
  mik?.classList.add("kayitta");
  AS.sayac = setInterval(() => {
    const sn = Math.floor((Date.now() - AS.baslangic) / 1000);
    if (yazi) yazi.textContent = `Dinliyorum… ${sn} sn · bitince dokunun`;
    if (sn >= 90) k.stop();   // uzun kayıt yerine kısa komutlar
  }, 250);
  k.ondataavailable = (e) => { if (e.data.size) AS.parcalar.push(e.data); };
  k.onstop = () => {
    clearInterval(AS.sayac);
    akim.getTracks().forEach((t) => t.stop());
    mik?.classList.remove("kayitta");
    if (yazi) yazi.textContent = "Konuşmak için dokunun";
    const sure = Date.now() - AS.baslangic;
    const blob = new Blob(AS.parcalar, { type: k.mimeType || "audio/webm" });
    if (sure < 700 || !blob.size) return;
    komutGonder({ ses: blob });
  };
  k.start(250);
}

async function komutGonder({ metin, ses }) {
  AS.mesgul = true;
  const pano = document.getElementById("asPano");
  pano?.classList.add("mesgul");
  const balon = akisaEkle(el(`<div class="as-balon">${metin ? kacir(metin) : '<span class="soluk">Ses yazıya dökülüyor…</span>'}</div>`));
  const bekle = akisaEkle(el(`<div class="as-cevap soluk">Düşünüyor…</div>`));
  try {
    let r;
    if (ses) {
      const fd = new FormData();
      const uz = ses.type.includes("mp4") ? "mp4" : ses.type.includes("ogg") ? "ogg" : "webm";
      fd.append("ses", ses, `komut.${uz}`);
      if (AS.konusmaId) fd.append("konusmaId", AS.konusmaId);
      r = await api("/asistan/ses", { method: "POST", body: fd });
    } else {
      r = await api("/asistan/metin", { method: "POST", body: JSON.stringify({ metin, konusmaId: AS.konusmaId }) });
    }
    if (r.konusmaId) AS.konusmaId = r.konusmaId;
    if (balon) balon.innerHTML = r.metin ? kacir(r.metin) : '<span class="soluk">(konuşma duyulmadı)</span>';
    bekle?.remove();
    akisaEkle(el(`<div class="as-cevap">${kacir(r.cevap)}</div>`));
    const kartDugumleri = r.kartlar.map((k) => akisaEkle(kartHtml(k)));
    if (r.kartlar.length > 1) {
      const hepsi = akisaEkle(el(`<div class="as-hepsi"><button class="dg bas">Hepsini onayla (${r.kartlar.length})</button></div>`));
      hepsi.querySelector("button").onclick = async () => {
        hepsi.remove();
        for (const d of kartDugumleri) { const b = d?.querySelector("[data-onayla]"); if (b && !b.disabled) await kartOnayla(d); }
      };
    }
  } catch (e) {
    bekle?.remove();
    if (balon && ses) balon.innerHTML = '<span class="soluk">(ses gönderilemedi)</span>';
    akisaEkle(el(`<div class="as-cevap hata">${kacir(e.message)}</div>`));
  } finally {
    AS.mesgul = false;
    pano?.classList.remove("mesgul");
  }
}

function kartHtml(k) {
  const d = el(`<div class="as-kart" data-kart="${kacir(k.id)}">
    <div class="as-kart-bas">${kacir(k.baslik)}</div>
    <ul>${k.satirlar.map((s) => `<li>${kacir(s)}</li>`).join("")}</ul>
    ${k.not ? `<div class="as-not">${kacir(k.not)}</div>` : ""}
    <div class="as-kart-alt"><button class="dg" data-vazgec>Vazgeç</button><button class="dg bas" data-onayla>Onayla</button></div>
  </div>`);
  d.querySelector("[data-onayla]").onclick = () => kartOnayla(d);
  d.querySelector("[data-vazgec]").onclick = async () => {
    try { await api("/asistan/vazgec", { method: "POST", body: JSON.stringify({ id: k.id }) }); } catch {}
    d.classList.add("bitti");
    d.querySelector(".as-kart-alt").innerHTML = `<span class="soluk">Vazgeçildi</span>`;
  };
  return d;
}

async function kartOnayla(d) {
  const alt = d.querySelector(".as-kart-alt");
  alt.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  try {
    const r = await api("/asistan/onayla", { method: "POST", body: JSON.stringify({ id: d.dataset.kart }) });
    d.classList.add("bitti", "iyi");
    alt.innerHTML = `<span class="as-tamam">✓ Yazıldı</span><button class="dg ufak" data-geri>Geri al</button>`;
    if (r.uyari) alt.insertAdjacentHTML("beforebegin", `<div class="as-not">${kacir(r.uyari)}</div>`);
    alt.querySelector("[data-geri]").onclick = () => islemGeriAl(r.kayit.id, alt);
    tazeleArkada();
  } catch (e) {
    alt.innerHTML = `<span class="as-hata">${kacir(e.message)}</span>`;
  }
}

async function islemGeriAl(id, kutu) {
  if (!(await onay("İşlem geri alınsın mı?", "Sesli komutla yazılan kayıt eski hâline döner.", "Geri al"))) return;
  try {
    await api("/asistan/geri-al", { method: "POST", body: JSON.stringify({ id }) });
    if (kutu) kutu.innerHTML = `<span class="soluk">Geri alındı</span>`;
    bildir("İşlem geri alındı", "", "iyi");
    tazeleArkada();
    if (document.querySelector("#asPano [data-gunluk]")?.open) gunlukCiz();
  } catch (e) { hataBildir(e); }
}

/** Panelin arkasındaki sayfa yazılan kaydı göstersin. */
function tazeleArkada() {
  for (const k of Object.keys(tabloDurum)) delete tabloDurum[k];
  durumYukle().then(() => { gezintiCiz(); yonlendir(); }).catch(() => {});
}

async function gunlukCiz() {
  const kutu = document.querySelector("#asPano [data-gunluk-liste]");
  if (!kutu) return;
  try {
    const { gunluk } = await api("/asistan");
    if (!gunluk.length) { kutu.innerHTML = bosSatir("Henüz sesli komutla yazılan bir işlem yok."); return; }
    kutu.innerHTML = "";
    for (const g of gunluk) {
      const z = new Date(g.tarih);
      const s = el(`<div class="as-gunluk-og ${g.geriAlindi ? "geri" : ""}">
        <div><b>${kacir(g.baslik)}</b> <span class="soluk">${z.toLocaleDateString("tr-TR")} ${z.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} · ${kacir(g.kullanici)}</span></div>
        <div>${g.satirlar.map(kacir).join("<br>")}</div>
        <div class="soluk">"${kacir(g.cumle)}"</div>
        <div class="as-gunluk-alt">${g.geriAlindi ? '<span class="soluk">Geri alındı</span>' : '<button class="dg ufak" data-geri>Geri al</button>'}</div>
      </div>`);
      s.querySelector("[data-geri]")?.addEventListener("click", () => islemGeriAl(g.id, s.querySelector(".as-gunluk-alt")));
      kutu.appendChild(s);
    }
  } catch (e) { kutu.innerHTML = bosSatir(e.message); }
}

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && document.getElementById("asPano") && !document.querySelector("#panoAlani .pano")) asistanKapat();
});

/* ---------------- yönlendirme ---------------- */

async function durumYukle() {
  S.durum = await api("/durum");
  try { S.uyarilar = await api("/uyarilar"); } catch { S.uyarilar = []; }
  ustBilgiCiz();
}

async function yonlendir() {
  const y = (location.hash || "#panel").slice(1);
  gezintiCiz();
  try {
    if (y === "panel") await panelCiz();
    else if (y === "agac") await agacCiz();
    else if (y === "yukle") await yukleCiz();
    else if (y === "ayarlar") ayarlarCiz();
    else if (y.startsWith("t/")) {
      const ad = y.slice(2);
      // Bağlantı sütunları için kaynak tabloları her girişte tazele (başka ekranda değişmiş olabilirler).
      await kaynaklariYukle(ad);
      await tabloCiz(ad);
    } else if (y.startsWith("d/")) {
      const [, ad, id] = y.split("/");
      await detayCiz(ad, id);
    } else if (y === "puantaj" || y.startsWith("puantaj/")) {
      await puantajCiz(y.split("/")[1] || "");
    } else if (y === "istatistik") {
      await istatistikCiz();
    } else if (y === "odemeler" || y.startsWith("odemeler/")) {
      await odemelerCiz(y.split("/")[1] || "");
    } else if (y.startsWith("calisan/")) {
      const [, kod, secim] = y.split("/");
      await calisanCiz(decodeURIComponent(kod || ""), secim || "");
    } else if (y === "ongoru") {
      await ongoruCiz();
    } else if (y === "kasa" || y.startsWith("kasa/")) {
      await kasaCiz(y.split("/")[1] || "");
    } else location.hash = "#panel";
  } catch (e) { hataBildir(e); }
}

window.addEventListener("hashchange", yonlendir);

(async function baslat() {
  const t = localStorage.getItem("kadro-tema");
  if (t) document.documentElement.setAttribute("data-theme", t);
  asistanDugmesiKur();
  try {
    await durumYukle();
    await yonlendir();
  } catch (e) {
    ana.innerHTML = `<div class="bos"><div class="bs">Sunucuya bağlanılamadı</div>
      <p>baslat.bat penceresinin açık olduğundan emin olun, sonra sayfayı yenileyin.</p></div>`;
  }
})();
