# Employee's view: no big earnings box, the earnings calculation + meal payments on screen and in the PDF, at most 2 periods.
import os, re
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4417"
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(OUTPUT, exist_ok=True)
CODE = "KDR-2026-0001"
failed = 0
def ok(c, name, extra=""):
    global failed
    print(("  ✓ " if c else "  ✗ ") + name + (f" — {extra}" if extra else ""))
    if not c: failed += 1

with sync_playwright() as p:
    b = p.chromium.launch()
    s = b.new_page(viewport={"width": 1366, "height": 900})
    console = []
    s.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
    s.on("pageerror", lambda e: console.append(str(e)))
    s.goto(f"{URL}/#employee/{CODE}")
    s.wait_for_selector(".ev-paper .ev-earnings", timeout=10000)
    text = s.inner_text(".ev-paper")
    headings = s.evaluate("() => [...document.querySelectorAll('.ev-paper h4')].map(h => h.textContent.trim())")
    print("    sections:", headings)
    ok("Earnings for this half" not in text and not s.query_selector(".ev-big"), "no big earnings box")
    ok(any(h.startswith("How your earnings are calculated") for h in headings), "earnings calculation is there")
    ok(any(h.startswith("Your payments") for h in headings), "payments section is there")
    pays = s.inner_text(".ev-section:has(h4:text-matches('Your payments', 'i'))")
    rows = [l for l in pays.splitlines() if re.match(r"\d\d/\d\d/\d{4}", l.strip())]
    print("    payment rows:", rows)
    ok(all("Meal allowance" in l for l in rows), "only meal allowance in payments")
    ok("salary" not in pays.lower() and "Hourly" not in pays, "no salary in payments")
    chips = s.query_selector_all(".ev-chip")
    print("    periods:", [c.inner_text() for c in chips])
    s.screenshot(path=f"{OUTPUT}/ev-1-screen.png", full_page=True)

    # try to add a 3rd period
    for i in range(3):
        c = s.query_selector_all(".ev-chip")[i]
        if "active" not in (c.get_attribute("class") or ""):
            c.click(); s.wait_for_timeout(700)
    active = s.query_selector_all(".ev-chip.active")
    ok(len(active) <= 2, "at most 2 periods in the chips", str(len(active)))
    ok(len(s.query_selector_all(".ev-ts-period")) <= 2, "at most 2 periods in the timesheet", str(len(s.query_selector_all(".ev-ts-period"))))

    # A wide date range (4 periods) → trimmed to 2, with a warning
    s.goto(f"{URL}/#employee/{CODE}/2026-08-01..2026-10-31")
    s.wait_for_selector(".ev-paper .ev-ts")
    n = len(s.query_selector_all(".ev-ts-period"))
    ok(n == 2, "wide range trimmed to 2 periods", f"{n} periods · {s.inner_text('.ev-pick-sum')}")
    ok("at most 2" in s.inner_text(".ev-pick-sum"), "the trim warning is shown")
    ok(s.query_selector('[data-h="all"]') is None and "Last 2 periods" in s.inner_text(".ev-pick"), "'Last 2 periods' instead of 'All'")
    s.click('[data-h="last"]'); s.wait_for_timeout(700)
    ok(len(s.query_selector_all(".ev-ts-period")) == 2, "Last 2 periods button")
    s.screenshot(path=f"{OUTPUT}/ev-2-two-periods.png", full_page=True)

    # Print
    s.emulate_media(media="print")
    visible = s.evaluate("""() => [...document.querySelectorAll('.ev-paper h4')].filter(h => h.offsetParent).map(h => h.textContent.trim())""")
    print("    sections when printed:", visible)
    ok(any("timesheet" in h for h in visible) and any("earnings" in h for h in visible) and any("Your payments" in h for h in visible),
       "printed: timesheet + earnings calculation + payments")
    ok(not any("employment periods" in h or "documents" in h for h in visible), "printed: no documents / employment periods")
    tables = s.evaluate("() => [...document.querySelectorAll('.ev-pay .ev-calc')].map(t => t.offsetHeight)")
    ok(tables and all(h > 0 for h in tables), "earnings tables visible when printed", str(tables))
    s.screenshot(path=f"{OUTPUT}/ev-3-print.png", full_page=True)
    s.emulate_media(media="screen")
    s.pdf(path=f"{OUTPUT}/ev-sample.pdf", format="A4", print_background=True, margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"})

    # Phone
    s.set_viewport_size({"width": 390, "height": 844})
    s.reload(); s.wait_for_selector(".ev-paper .ev-earnings")
    overflow = s.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
    ok(not overflow, "no horizontal overflow on a phone")
    s.screenshot(path=f"{OUTPUT}/ev-4-phone.png", full_page=True)
    ok(not console, "clean console", "; ".join(console))
    b.close()
print("ALL PASSED" if not failed else f"{failed} FAILED")
