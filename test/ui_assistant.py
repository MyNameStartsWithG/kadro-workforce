# Voice command UI: panel, typed command, card approve/undo, recording with a fake microphone, phone width, dark theme.
import sys, os
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4417"
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(OUTPUT, exist_ok=True)
failed = 0
def ok(c, name, extra=""):
    global failed
    print(("  ✓ " if c else "  ✗ ") + name + (f" — {extra}" if extra else ""))
    if not c: failed += 1

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    c = b.new_context(viewport={"width": 1366, "height": 860}, permissions=["microphone"])
    s = c.new_page()
    console = []
    s.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
    s.on("pageerror", lambda e: console.append(str(e)))
    s.goto(URL + "/#timesheet")
    s.wait_for_selector("#main table", timeout=10000)
    ok(s.is_visible("#vaButton"), "microphone button is visible")
    s.click("#vaButton")
    s.wait_for_selector("#vaPanel")
    ok("Approve" in s.inner_text("#vaPanel"), "the panel explains itself")
    s.screenshot(path=f"{OUTPUT}/ui-1-panel.png")

    s.fill("#vaPanel [data-text]", "Cem was absent today, Tolga worked 10 hours")
    s.press("#vaPanel [data-text]", "Enter")
    s.wait_for_selector("#vaPanel .va-card")
    ok("Cem Polat" in s.inner_text("#vaPanel .va-card"), "card arrived")
    s.screenshot(path=f"{OUTPUT}/ui-2-card.png")
    s.click("#vaPanel .va-card [data-approve]")
    s.wait_for_selector("#vaPanel .va-ok")
    ok(True, "approved")
    s.wait_for_timeout(800)
    ok("–" in s.inner_text("#main"), "the timesheet behind was refreshed (– is shown)")
    s.screenshot(path=f"{OUTPUT}/ui-3-approved.png")

    s.fill("#vaPanel [data-text]", "I bought 60 euro of fuel and gave Murat a 50 advance")
    s.press("#vaPanel [data-text]", "Enter")
    s.wait_for_selector("#vaPanel .va-all button")
    s.click("#vaPanel .va-all button")
    s.wait_for_function("document.querySelectorAll('#vaPanel .va-ok').length >= 3")
    ok(True, "approve all works")

    s.click("#vaPanel [data-log] summary")
    s.wait_for_selector("#vaPanel .va-log-item")
    n = s.locator("#vaPanel .va-log-item").count()
    ok(n >= 3, "recent actions list", str(n))
    s.locator("#vaPanel .va-log-item [data-undo]").first.click()
    s.wait_for_selector("#modalHost .modal")
    s.click("#modalHost .modal [data-yes]")
    s.wait_for_selector("#vaPanel .va-log-item.undone")
    ok(True, "undo from the log")

    # fake microphone: Chrome produces a beep; the fake n8n returns it as "text"
    s.click("#vaPanel [data-mic]")
    s.wait_for_selector("#vaPanel .va-mic.recording")
    s.wait_for_timeout(1500)
    ok("Listening" in s.inner_text("#vaPanel [data-mic]"), "recording counter")
    s.screenshot(path=f"{OUTPUT}/ui-4-recording.png")
    s.click("#vaPanel [data-mic]")
    s.wait_for_function("!document.querySelector('#vaPanel').classList.contains('busy') && document.querySelectorAll('#vaPanel .va-reply').length >= 3", timeout=15000)
    last = s.locator("#vaPanel .va-reply").last.inner_text()
    ok(len(last) > 0 and "error" not in s.locator("#vaPanel .va-reply").last.get_attribute("class"), "audio sent, reply received", last[:60])

    s.keyboard.press("Escape")
    ok(not s.is_visible("#vaPanel"), "Esc closes it")
    ok(not console, "no console errors", "; ".join(console)[:200])

    # Settings
    s.goto(URL + "/#settings")
    s.wait_for_selector("#setVaUrl")
    ok("Voice commands" in s.inner_text("#main"), "voice command section in settings")
    s.locator("#setVaUrl").scroll_into_view_if_needed()
    s.screenshot(path=f"{OUTPUT}/ui-5-settings.png")

    # phone + dark theme
    m = b.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", is_mobile=True, has_touch=True, permissions=["microphone"])
    ms = m.new_page()
    ms.goto(URL + "/#dashboard")
    ms.wait_for_selector("#vaButton")
    ms.click("#vaButton")
    ms.wait_for_selector("#vaPanel")
    ms.fill("#vaPanel [data-text]", "I gave Mehmet a 100 euro advance")
    ms.press("#vaPanel [data-text]", "Enter")
    ms.wait_for_selector("#vaPanel .va-card")
    k = ms.eval_on_selector("#vaPanel", "e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }")
    ok(k[0] == 0 and k[2] == 390, "full screen on a phone", str(k))
    ok(ms.evaluate("document.documentElement.scrollWidth <= 390"), "no horizontal scrolling")
    ok(not ms.is_visible("#vaButton"), "floating button hidden while the panel is open")
    ms.screenshot(path=f"{OUTPUT}/ui-6-phone.png")
    ms.click("#vaPanel [data-close]")
    ok(ms.is_visible("#vaButton"), "button comes back after closing")

    # hidden when printing
    s.goto(URL + "/#dashboard"); s.wait_for_selector("#vaButton")
    s.emulate_media(media="print")
    ok(not s.is_visible("#vaButton"), "button hidden when printing")
    b.close()

print(f"\n{failed} FAILED" if failed else "\nALL PASSED")
sys.exit(1 if failed else 0)
