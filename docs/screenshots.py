# README screenshots: taken from a Kadro running on the sample data (4417) with the fake n8n (4499).
#   node test/prepare.mjs <folder> && (fake n8n + server) && python docs/screenshots.py
import os
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4417"
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")
os.makedirs(OUTPUT, exist_ok=True)
CODE = "KDR-2026-0001"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    c = b.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light", device_scale_factor=1)
    s = c.new_page()

    s.goto(f"{URL}/#dashboard"); s.wait_for_timeout(1500)
    s.screenshot(path=f"{OUTPUT}/dashboard.png")

    # The filled-in period in the sample data: the first half of October 2026.
    s.goto(f"{URL}/#timesheet/2026-10-1"); s.wait_for_selector("#main table"); s.wait_for_timeout(800)
    s.screenshot(path=f"{OUTPUT}/timesheet.png")

    s.click("#vaButton"); s.wait_for_selector("#vaPanel")
    s.fill("#vaPanel [data-text]", "Cem was absent today, Tolga worked 10 hours")
    s.press("#vaPanel [data-text]", "Enter")
    s.wait_for_selector("#vaPanel .va-card"); s.wait_for_timeout(500)
    s.screenshot(path=f"{OUTPUT}/voice-command.png")
    s.click("#vaPanel [data-close]")

    s.goto(f"{URL}/#employee/{CODE}/2026-10-1"); s.wait_for_selector(".ev-earnings"); s.wait_for_timeout(800)
    s.screenshot(path=f"{OUTPUT}/employee-view.png", full_page=True)
    s.emulate_media(media="print")
    s.screenshot(path=f"{OUTPUT}/employee-pdf.png", full_page=True)
    s.emulate_media(media="screen")

    m = b.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", is_mobile=True, has_touch=True,
                      device_scale_factor=2, permissions=["microphone"])
    ms = m.new_page()
    ms.goto(f"{URL}/#dashboard"); ms.wait_for_selector("#vaButton")
    ms.click("#vaButton"); ms.wait_for_selector("#vaPanel")
    ms.fill("#vaPanel [data-text]", "I gave Mehmet a 100 euro advance")
    ms.press("#vaPanel [data-text]", "Enter")
    ms.wait_for_selector("#vaPanel .va-card"); ms.wait_for_timeout(500)
    ms.screenshot(path=f"{OUTPUT}/mobile-voice.png")
    b.close()
print("done:", sorted(os.listdir(OUTPUT)))
