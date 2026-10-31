# README ekran görüntüleri: örnek veriyle açık bir Kadro (4417) ve sahte n8n (4499) üzerinde.
#   node test/hazirla.mjs <klasör> && (sahte n8n + sunucu) && python docs/ekran-goruntuleri.py
import os
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4417"
CIKTI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")
os.makedirs(CIKTI, exist_ok=True)
KOD = "KDR-2026-0001"

with sync_playwright() as p:
    t = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    c = t.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light", device_scale_factor=1)
    s = c.new_page()

    s.goto(f"{URL}/#panel"); s.wait_for_timeout(1500)
    s.screenshot(path=f"{CIKTI}/dashboard.png")

    # Örnek veride dolu dönem: Ekim 2026'nın ilk yarısı.
    s.goto(f"{URL}/#puantaj/2026-10-1"); s.wait_for_selector("#ana table"); s.wait_for_timeout(800)
    s.screenshot(path=f"{CIKTI}/timesheet.png")

    s.click("#asDugme"); s.wait_for_selector("#asPano")
    s.fill("#asPano [data-metin]", "Cem bugün gelmedi, Tolga 10 saat çalıştı")
    s.press("#asPano [data-metin]", "Enter")
    s.wait_for_selector("#asPano .as-kart"); s.wait_for_timeout(500)
    s.screenshot(path=f"{CIKTI}/voice-command.png")
    s.click("#asPano [data-kapat]")

    s.goto(f"{URL}/#calisan/{KOD}/2026-10-1"); s.wait_for_selector(".cg-hakedis"); s.wait_for_timeout(800)
    s.screenshot(path=f"{CIKTI}/employee-view.png", full_page=True)
    s.emulate_media(media="print")
    s.screenshot(path=f"{CIKTI}/employee-pdf.png", full_page=True)
    s.emulate_media(media="screen")

    m = t.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", is_mobile=True, has_touch=True,
                      device_scale_factor=2, permissions=["microphone"])
    ms = m.new_page()
    ms.goto(f"{URL}/#panel"); ms.wait_for_selector("#asDugme")
    ms.click("#asDugme"); ms.wait_for_selector("#asPano")
    ms.fill("#asPano [data-metin]", "Mehmet'e 100 euro avans verdim")
    ms.press("#asPano [data-metin]", "Enter")
    ms.wait_for_selector("#asPano .as-kart"); ms.wait_for_timeout(500)
    ms.screenshot(path=f"{CIKTI}/mobile-voice.png")
    t.close()
print("tamam:", sorted(os.listdir(CIKTI)))
