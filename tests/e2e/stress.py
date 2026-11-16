"""Stress test: many games, difficulties, seeds, random plans, failing router, reloads."""
import random, sys, json
from playwright.sync_api import sync_playwright
import smoke_helpers as H

errors = []
def play(ctx, tag, url, rounds, mode, rng):
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"[{tag}] pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"[{tag}] console.error: {m.text}") if m.type == "error" and "ERR_FAILED" not in m.text and "503" not in m.text else None)
    H.stub(page, router=mode)
    page.goto(url); page.wait_for_selector(".board, .wordmark")
    if page.locator(".wordmark").count():
        page.wait_for_timeout(500)
        shared = page.locator("text=Play the shared game")
        (shared if shared.count() else page.locator("text=Free play")).first.click(); page.wait_for_selector(".board")
    scores = []
    for rnd in range(rounds):
        page.wait_for_selector(".board"); page.wait_for_timeout(400)
        if page.locator(".view-pane .pane-toggle").is_visible():
            page.click(".view-pane .pane-toggle"); page.wait_for_timeout(200)
        box = page.locator(".side-pane .map-host").bounding_box()
        fx, fy = rng.choice([(.5,.5),(.1,.1),(.9,.9),(.2,.8)])
        page.mouse.click(box["x"]+box["width"]*fx, box["y"]+box["height"]*fy)
        page.wait_for_timeout(150)
        page.click("text=Confirm my location"); page.wait_for_timeout(500)
        # random mixed legs, then undo, then finish by walking to the flag
        for _ in range(rng.randint(0, 4)):
            m = rng.choice(["walk","rail","bus","taxi"])
            page.click(f'.mode-btn[data-mode="{m}"]')
            box = page.locator(".side-pane .map-host").bounding_box()
            page.mouse.click(box["x"]+rng.uniform(.1,.9)*box["width"], box["y"]+rng.uniform(.1,.9)*box["height"])
            page.wait_for_timeout(250)
        if page.locator("text=Undo last step").is_enabled() and rng.random() < .6:
            page.click("text=Undo last step"); page.wait_for_timeout(150)
        page.click('.mode-btn[data-mode="taxi"]')
        for attempt in range(6):
            page.wait_for_timeout(500)
            pole = page.locator(".side-pane .flag-pole").bounding_box()
            page.mouse.click(pole["x"]+pole["width"]/2, pole["y"]+pole["height"]+2)
            page.wait_for_timeout(600)
            c = page.locator("text=Continue to prediction")
            if c.count() and c.is_enabled(): break
            if attempt >= 1:
                page.mouse.move(pole["x"]+1, pole["y"]+pole["height"]); page.mouse.wheel(0, -600); page.wait_for_timeout(400)
            if attempt == 3: page.click('.mode-btn[data-mode="walk"]')
        else:
            page.screenshot(path=f"/tmp/shots/{tag}-stuck-{rnd}.png")
            errors.append(f"[{tag}] round {rnd}: could not finish plan (budget/route?)")
            page.close(); return None
        c.click(); page.wait_for_timeout(250)
        page.fill(".num-input", str(rng.choice([1, 12, 45, 120, 600]))); page.dispatch_event(".num-input", "change")
        page.click("text=Lock in my answer")
        page.wait_for_selector(".result-panel", timeout=15000); page.wait_for_timeout(900)
        t = page.locator(".result-panel").inner_text()
        if "NaN" in t or "undefined" in t or "Infinity" in t: errors.append(f"[{tag}] bad text in result round {rnd}: {t[:200]}")
        page.locator(".result-panel .btn-primary").click()
    try:
        page.wait_for_selector(".final-total", timeout=15000)
    except Exception:
        page.screenshot(path=f"/tmp/shots/{tag}-nofinal.png"); errors.append(f"[{tag}] no final screen; text={page.locator('body').inner_text()[:300]!r}"); page.close(); return None
    tot = page.locator(".final-total").inner_text().replace("\n"," ")
    if "NaN" in page.locator("body").inner_text(): errors.append(f"[{tag}] NaN on final")
    print(tag, "OK", tot); page.close(); return tot

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    n = 0
    for diff in ["relaxed","standard","expert"]:
        for k, (rounds, mode) in enumerate([(3,"ok"),(3,"fail"),(3,"slow")]):
            seed = f"st{diff}{k}"
            ctx = b.new_context(viewport={"width": 1280, "height": 800})
            play(ctx, f"{diff}-{mode}-{seed}", f"{H.BASE.split('index')[0]}#seed={seed}&d={diff}&n={rounds}", rounds, mode, random.Random(n)); ctx.close(); n += 1
    # mobile, 5 rounds, daily-style hash
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    play(ctx, "mobile-std", f"{H.BASE.split('index')[0]}#seed=mob1&d=standard&n=5", 5, "ok", random.Random(99)); ctx.close()
    b.close()
print("ERRORS:" if errors else "no errors")
for e in errors[:40]: print(" ", e)
