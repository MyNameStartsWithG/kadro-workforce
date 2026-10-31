# Sesli komut arayüzü: panel, yazılı komut, kart onay/geri al, sahte mikrofonla kayıt, telefon genişliği, koyu tema.
import sys, os
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4417"
CIKTI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cikti")
os.makedirs(CIKTI, exist_ok=True)
hata = 0
def ok(k, ad, ek=""):
    global hata
    print(("  ✓ " if k else "  ✗ ") + ad + (f" — {ek}" if ek else ""))
    if not k: hata += 1

with sync_playwright() as p:
    t = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    c = t.new_context(viewport={"width": 1366, "height": 860}, permissions=["microphone"])
    s = c.new_page()
    konsol = []
    s.on("console", lambda m: konsol.append(m.text) if m.type == "error" else None)
    s.on("pageerror", lambda e: konsol.append(str(e)))
    s.goto(URL + "/#puantaj")
    s.wait_for_selector("#ana table", timeout=10000)
    ok(s.is_visible("#asDugme"), "mikrofon düğmesi görünüyor")
    s.click("#asDugme")
    s.wait_for_selector("#asPano")
    ok("Onayla" in s.inner_text("#asPano"), "panelde açıklama var")
    s.screenshot(path=f"{CIKTI}/ui-1-pano.png")

    s.fill("#asPano [data-metin]", "Cem bugün gelmedi, Tolga 10 saat çalıştı")
    s.press("#asPano [data-metin]", "Enter")
    s.wait_for_selector("#asPano .as-kart")
    ok("Cem Polat" in s.inner_text("#asPano .as-kart"), "kart geldi")
    s.screenshot(path=f"{CIKTI}/ui-2-kart.png")
    s.click("#asPano .as-kart [data-onayla]")
    s.wait_for_selector("#asPano .as-tamam")
    ok(True, "onaylandı")
    s.wait_for_timeout(800)
    ok("–" in s.inner_text("#ana"), "arkadaki puantaj tazelendi (– görünüyor)")
    s.screenshot(path=f"{CIKTI}/ui-3-onay.png")

    s.fill("#asPano [data-metin]", "60 euro yakıt aldım ve Murat'a 50 avans verdim")
    s.press("#asPano [data-metin]", "Enter")
    s.wait_for_selector("#asPano .as-hepsi button")
    s.click("#asPano .as-hepsi button")
    s.wait_for_function("document.querySelectorAll('#asPano .as-tamam').length >= 3")
    ok(True, "hepsini onayla çalıştı")

    s.click("#asPano [data-gunluk] summary")
    s.wait_for_selector("#asPano .as-gunluk-og")
    n = s.locator("#asPano .as-gunluk-og").count()
    ok(n >= 3, "son işlemler listesi", str(n))
    s.locator("#asPano .as-gunluk-og [data-geri]").first.click()
    s.wait_for_selector("#panoAlani .pano")
    s.click("#panoAlani .pano [data-e]")
    s.wait_for_selector("#asPano .as-gunluk-og.geri")
    ok(True, "günlükten geri al")

    # sahte mikrofon: Chrome bip sesi üretir; sahte n8n onu "metin" olarak döndürür
    s.click("#asPano [data-mik]")
    s.wait_for_selector("#asPano .as-mik.kayitta")
    s.wait_for_timeout(1500)
    ok("Dinliyorum" in s.inner_text("#asPano [data-mik]"), "kayıt sayacı")
    s.screenshot(path=f"{CIKTI}/ui-4-kayit.png")
    s.click("#asPano [data-mik]")
    s.wait_for_function("!document.querySelector('#asPano').classList.contains('mesgul') && document.querySelectorAll('#asPano .as-cevap').length >= 3", timeout=15000)
    son = s.locator("#asPano .as-cevap").last.inner_text()
    ok(len(son) > 0 and "hata" not in s.locator("#asPano .as-cevap").last.get_attribute("class"), "ses gönderildi, cevap geldi", son[:60])

    s.keyboard.press("Escape")
    ok(not s.is_visible("#asPano"), "Esc kapatır")
    ok(not konsol, "konsol hatası yok", "; ".join(konsol)[:200])

    # Ayarlar
    s.goto(URL + "/#ayarlar")
    s.wait_for_selector("#ayAsAdres")
    ok("Sesli komut" in s.inner_text("#ana"), "ayarlarda sesli komut bölümü")
    s.locator("#ayAsAdres").scroll_into_view_if_needed()
    s.screenshot(path=f"{CIKTI}/ui-5-ayar.png")

    # telefon + koyu tema
    m = t.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", is_mobile=True, has_touch=True, permissions=["microphone"])
    ms = m.new_page()
    ms.goto(URL + "/#panel")
    ms.wait_for_selector("#asDugme")
    ms.click("#asDugme")
    ms.wait_for_selector("#asPano")
    ms.fill("#asPano [data-metin]", "Mehmet'e 100 euro avans verdim")
    ms.press("#asPano [data-metin]", "Enter")
    ms.wait_for_selector("#asPano .as-kart")
    k = ms.eval_on_selector("#asPano", "e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }")
    ok(k[0] == 0 and k[2] == 390, "telefonda tam ekran", str(k))
    ok(ms.evaluate("document.documentElement.scrollWidth <= 390"), "yatay kaydırma yok")
    ok(not ms.is_visible("#asDugme"), "panel açıkken yüzen düğme gizli")
    ms.screenshot(path=f"{CIKTI}/ui-6-telefon.png")
    ms.click("#asPano [data-kapat]")
    ok(ms.is_visible("#asDugme"), "kapatınca düğme geri geldi")

    # yazdırmada görünmez
    s.goto(URL + "/#panel"); s.wait_for_selector("#asDugme")
    s.emulate_media(media="print")
    ok(not s.is_visible("#asDugme"), "yazdırmada düğme gizli")
    t.close()

print(f"\n{hata} HATA" if hata else "\nHEPSİ GEÇTİ")
sys.exit(1 if hata else 0)
