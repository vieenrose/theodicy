#!/usr/bin/env python3
"""
e2e_test.py — headless-browser smoke test of the deployed Theodicy game.

Not "do the files serve" (we know they do) but "does the game actually run":
React mounts, the SVG map renders, clicking actions advances turns, and the god
actually acts (omens/ledger appear) — all with no uncaught JS errors. Also loads
the RTS page and checks the canvas comes up clean.

    .venv/bin/python test/e2e_test.py            # tests the live HF Space
    .venv/bin/python test/e2e_test.py <base_url> # e.g. http://localhost:8000
"""
import sys, re, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://luigi-theodicy.static.hf.space"

results = []
def check(name, ok, detail=""):
    results.append((ok, name, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))

def turn_of(page):
    m = re.search(r"TURN\s+(\d+)", page.inner_text("header"))
    return int(m.group(1)) if m else None

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = ctx.new_page()
    errors, console_errors = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # ---- GOD-SIM ----------------------------------------------------------
    print(f"\n▶ god-sim  {BASE}/game/index.html")
    page.goto(f"{BASE}/game/index.html", wait_until="networkidle", timeout=60000)
    page.wait_for_selector("h1", timeout=30000)
    check("React app mounts (h1 THEODICY)", "THEODICY" in page.inner_text("h1"))
    # dismiss the intro overlay
    try:
        page.get_by_role("button", name=re.compile("enter the vale")).click(timeout=5000)
        page.wait_for_timeout(300)
    except Exception:
        pass
    check("intro dismisses", page.locator("text=enter the vale").count() == 0)
    check("SVG world map renders", page.locator("svg").count() > 0 and "Vale of Theodicy" in page.content())
    check("stats panel present", all(s in page.content() for s in ["Souls", "Food", "Water", "Morale"]))
    check("economy legibility (upkeep shown)", "upkeep" in page.content())
    check("action affinity shown", "+Vurm" in page.content() or "Ithra" in page.content())

    t0 = turn_of(page)
    check("turn counter reads", t0 is not None, f"turn={t0}")

    # play turns; accuse a god each time the "whose hand?" prompt appears
    saw_omen = False; accused = False
    for i in range(10):
        btn = page.get_by_role("button", name=re.compile("Harvest|Rest|Tend the Well|Fortify"))
        btn.first.click()
        page.wait_for_timeout(500)
        if "sign · turn" in page.content():
            saw_omen = True
        # accuse: click a deity face in the omen banner if present
        acc = page.locator('button[title^="accuse"]')
        if acc.count() > 0:
            acc.first.click(); page.wait_for_timeout(250); accused = True
    t1 = turn_of(page)
    check("turns advance on action", t1 is not None and t0 is not None and t1 > t0, f"{t0} -> {t1}")
    check("god acts (an omen appears)", saw_omen)
    check("accusation mechanic works", accused and re.search(r"theodicy:\s*\d+", page.inner_text("header").lower()) is not None)

    # open the ledger and confirm the arbiter recorded acts
    try:
        page.get_by_text(re.compile("read the ledger"), exact=False).first.click()
        page.wait_for_timeout(300)
    except Exception:
        pass
    ledger_ok = ("divine ledger" in page.content())
    check("ledger panel opens", ledger_ok)

    check("no uncaught JS errors (god-sim)", len(errors) == 0, "; ".join(errors[:3]))

    # ---- RTS --------------------------------------------------------------
    print(f"\n▶ rts  {BASE}/game/rts.html")
    errors.clear()
    page.goto(f"{BASE}/game/rts.html", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(1500)  # let the rAF loop spin
    check("RTS canvas present", page.locator("canvas").count() > 0)
    check("RTS HUD renders (grain)", "🌾" in page.content() or "wave" in page.content())
    check("RTS build button present", page.get_by_text(re.compile("Barracks")).count() > 0)
    check("no uncaught JS errors (rts)", len(errors) == 0, "; ".join(errors[:3]))

    browser.close()

# ---- report --------------------------------------------------------------
passed = sum(1 for ok, _, _ in results if ok)
print(f"\n{'='*54}\n{passed}/{len(results)} checks passed")
if console_errors:
    print(f"(console.error messages seen: {len(console_errors)} — first: {console_errors[0][:100]})")
sys.exit(0 if passed == len(results) else 1)
