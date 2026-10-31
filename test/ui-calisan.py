# Çalışanın gözünden: büyük hakediş kutusu yok, hakediş hesabı + yemek ödemeleri ekranda ve PDF'te, en fazla 2 dönem.
import os, re
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4417"
CIKTI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cikti")
os.makedirs(CIKTI, exist_ok=True)
KOD = "KDR-2026-0001"
hata = 0
def ok(k, ad, ek=""):
    global hata
    print(("  ✓ " if k else "  ✗ ") + ad + (f" — {ek}" if ek else ""))
    if not k: hata += 1

with sync_playwright() as p:
    t = p.chromium.launch()
    s = t.new_page(viewport={"width": 1366, "height": 900})
    konsol = []
    s.on("console", lambda m: konsol.append(m.text) if m.type == "error" else None)
    s.on("pageerror", lambda e: konsol.append(str(e)))
    s.goto(f"{URL}/#calisan/{KOD}")
    s.wait_for_selector(".cg-kagit .cg-hakedis", timeout=10000)
    metin = s.inner_text(".cg-kagit")
    basliklar = s.evaluate("() => [...document.querySelectorAll('.cg-kagit h4')].map(h => h.textContent.trim())")
    print("    bölümler:", basliklar)
    ok("Bu yarının hakedişi" not in metin and not s.query_selector(".cg-buyuk"), "büyük hakediş kutusu yok")
    ok(any(h.startswith("Hakedişinizin hesabı") for h in basliklar), "hakediş hesabı var")
    ok(any(h.startswith("Ödemeleriniz") for h in basliklar), "ödemeler bölümü var")
    od = s.inner_text(".cg-bolum:has(h4:text-matches('Ödemeleriniz', 'i'))")
    satirlar = [l for l in od.splitlines() if re.match(r"\d\d\.\d\d\.\d{4}", l.strip())]
    print("    ödeme satırları:", satirlar)
    ok(all("Yemek parası" in l for l in satirlar), "ödemelerde sadece yemek parası")
    ok("Maaş" not in od and "Saatlik" not in od, "ödemelerde maaş yok")
    cipler = s.query_selector_all(".cg-cip")
    print("    dönemler:", [c.inner_text() for c in cipler])
    s.screenshot(path=f"{CIKTI}/cg-1-ekran.png", full_page=True)

    # 3. dönemi eklemeyi dene
    for i in range(3):
        c = s.query_selector_all(".cg-cip")[i]
        if "aktif" not in (c.get_attribute("class") or ""):
            c.click(); s.wait_for_timeout(700)
    aktif = s.query_selector_all(".cg-cip.aktif")
    ok(len(aktif) <= 2, "çiplerde en fazla 2 dönem", str(len(aktif)))
    ok(len(s.query_selector_all(".cg-pt-donem")) <= 2, "puantajda en fazla 2 dönem", str(len(s.query_selector_all(".cg-pt-donem"))))

    # Geniş tarih aralığı (4 dönem) → 2'ye kırpılır, uyarı görünür
    s.goto(f"{URL}/#calisan/{KOD}/2026-08-01..2026-10-31")
    s.wait_for_selector(".cg-kagit .cg-puantaj")
    n = len(s.query_selector_all(".cg-pt-donem"))
    ok(n == 2, "geniş aralık 2 döneme kırpıldı", f"{n} dönem · {s.inner_text('.cg-secim-ozet')}")
    ok("en fazla 2" in s.inner_text(".cg-secim-ozet"), "kırpma uyarısı görünüyor")
    ok(s.query_selector('[data-h="tum"]') is None and "Son 2 dönem" in s.inner_text(".cg-secim"), "'Tümü' yerine 'Son 2 dönem'")
    s.click('[data-h="son"]'); s.wait_for_timeout(700)
    ok(len(s.query_selector_all(".cg-pt-donem")) == 2, "Son 2 dönem düğmesi")
    s.screenshot(path=f"{CIKTI}/cg-2-iki-donem.png", full_page=True)

    # Baskı
    s.emulate_media(media="print")
    gorunen = s.evaluate("""() => [...document.querySelectorAll('.cg-kagit h4')].filter(h => h.offsetParent).map(h => h.textContent.trim())""")
    print("    baskıda bölümler:", gorunen)
    ok(any("Puantaj" in h for h in gorunen) and any("Hakedişinizin" in h for h in gorunen) and any("Ödemeleriniz" in h for h in gorunen),
       "baskıda puantaj + hakediş hesabı + ödemeler")
    ok(not any("Çalışma dönemleriniz" in h or "Belgeleriniz" in h for h in gorunen), "baskıda belgeler / çalışma dönemleri yok")
    hk = s.evaluate("() => [...document.querySelectorAll('.cg-hk .cg-hesap')].map(t => t.offsetHeight)")
    ok(hk and all(h > 0 for h in hk), "baskıda hakediş tabloları görünür", str(hk))
    s.screenshot(path=f"{CIKTI}/cg-3-baski.png", full_page=True)
    s.emulate_media(media="screen")
    s.pdf(path=f"{CIKTI}/cg-ornek.pdf", format="A4", print_background=True, margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"})

    # Telefon
    s.set_viewport_size({"width": 390, "height": 844})
    s.reload(); s.wait_for_selector(".cg-kagit .cg-hakedis")
    yatay = s.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
    ok(not yatay, "telefonda yatay taşma yok")
    s.screenshot(path=f"{CIKTI}/cg-4-telefon.png", full_page=True)
    ok(not konsol, "konsol temiz", "; ".join(konsol))
    t.close()
print("HEPSİ GEÇTİ" if not hata else f"{hata} HATA")
