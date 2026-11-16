"""Smoke test: play through a full game in practice mode with stubbed tiles/routing."""
import io, json, math, re, sys
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765/index.html"
OUT = "/tmp/shots"

def tile_png():
    img = Image.new("RGB", (256, 256), (233, 236, 229))
    d = ImageDraw.Draw(img)
    for i in range(0, 256, 64):
        d.line([(i, 0), (i, 256)], fill=(214, 219, 210))
        d.line([(0, i), (256, i)], fill=(214, 219, 210))
    d.rectangle([90, 90, 170, 130], fill=(220, 214, 200))
    buf = io.BytesIO(); img.save(buf, "PNG"); return buf.getvalue()

TILE = tile_png()

def hav(a, b):
    R = 6371008.8
    dlat = math.radians(b[0]-a[0]); dlng = math.radians(b[1]-a[1])
    s = math.sin(dlat/2)**2 + math.cos(math.radians(a[0]))*math.cos(math.radians(b[0]))*math.sin(dlng/2)**2
    return 2*R*math.asin(math.sqrt(s))

def osrm(route):
    m = re.search(r"/route/v1/\w+/([\d.]+),([\d.]+);([\d.]+),([\d.]+)", route.request.url)
    lng1, lat1, lng2, lat2 = map(float, m.groups())
    dist = hav((lat1, lng1), (lat2, lng2)) * 1.25
    mid = [(lng1+lng2)/2 + 0.002, (lat1+lat2)/2 + 0.001]
    body = {"code": "Ok", "routes": [{"distance": dist, "duration": dist/1.3,
            "geometry": {"type": "LineString", "coordinates": [[lng1, lat1], mid, [lng2, lat2]]}}]}
    route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(body))

errors = []

def run(page, tag, mobile=False):
    page.on("pageerror", lambda e: errors.append(f"[{tag}] pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"[{tag}] console.{m.type}: {m.text}") if m.type in ("error",) else None)
    page.route("**/{tile.openstreetmap.org,server.arcgisonline.com}/**", lambda r: r.fulfill(status=200, content_type="image/png", body=TILE))
    page.route("**/routing.openstreetmap.de/**", osrm)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(BASE)
    page.wait_for_selector(".wordmark")
    page.wait_for_timeout(3000)  # let the line diagram finish drawing
    page.screenshot(path=f"{OUT}/{tag}-1-title.png")

    # choose 3 rounds, then free play
    page.click('[aria-label="Rounds"] >> text=3')
    page.click("text=Free play")
    page.wait_for_selector(".board")
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/{tag}-2-locate.png")

    for rnd in range(3):
        if rnd > 0:
            page.wait_for_selector(".board")
            page.wait_for_timeout(600)
        if rnd == 0:
            tiles = page.locator(".practice-holder img.slippy-tile").count()
            if tiles == 0:
                errors.append(f"[{tag}] practice clue has no tiles")
            page.screenshot(path=f"{OUT}/{tag}-2b-view.png")
        # on small screens the map lives behind a toggle
        if page.locator(".view-pane .pane-toggle").is_visible():
            page.click(".view-pane .pane-toggle")
            page.wait_for_timeout(300)
        # drop a pin near the middle of the map
        mh = page.locator(".side-pane .map-host")
        box = mh.bounding_box()
        page.mouse.click(box["x"] + box["width"]*0.55, box["y"] + box["height"]*0.5)
        page.wait_for_timeout(200)
        if rnd == 0:
            page.screenshot(path=f"{OUT}/{tag}-3-pin.png")
        cb = page.locator("text=Confirm my location").bounding_box()
        vh = page.viewport_size["height"]
        if cb is None or cb["y"] + cb["height"] > vh + 1:
            errors.append(f"[{tag}] confirm button clipped: {cb}")
        page.click("text=Confirm my location")
        page.wait_for_timeout(700)

        # try an MRT step first to exercise snapping (may be rejected, that is fine)
        page.click('.mode-btn[data-mode="rail"]')
        page.wait_for_timeout(300)
        if rnd == 0:
            page.screenshot(path=f"{OUT}/{tag}-4-plan-rail.png")
        page.click('.mode-btn[data-mode="walk"]')

        # walk straight to the destination (always free)
        page.wait_for_timeout(800)
        pole = page.locator(".side-pane .flag-pole").bounding_box()
        page.mouse.click(pole["x"] + pole["width"]/2, pole["y"] + pole["height"] + 2)
        page.wait_for_timeout(300)
        if rnd == 0:
            page.screenshot(path=f"{OUT}/{tag}-5-plan-done.png")
        cont = page.locator("text=Continue to prediction")
        if cont.count() == 0:
            page.screenshot(path=f"{OUT}/{tag}-FAIL-plan-{rnd}.png")
            errors.append(f"[{tag}] round {rnd}: plan not complete after clicking destination; pole box={pole}")
            return
        if not cont.is_enabled():
            errors.append(f"[{tag}] round {rnd}: plan not complete after clicking destination")
            page.screenshot(path=f"{OUT}/{tag}-FAIL-plan-{rnd}.png")
            return
        cont.click()
        page.wait_for_timeout(300)
        page.fill(".num-input", "35")
        page.dispatch_event(".num-input", "change")
        if rnd == 0:
            page.screenshot(path=f"{OUT}/{tag}-6-predict.png")
        page.click("text=Lock in my answer")
        page.wait_for_selector(".result-panel", timeout=15000)
        page.wait_for_timeout(1800)
        if rnd == 0:
            page.screenshot(path=f"{OUT}/{tag}-7-result.png")
        nxt = page.locator(".result-panel .btn-primary")
        nxt.click()

    page.wait_for_selector(".final-total")
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUT}/{tag}-8-final.png")
    print(tag, "final text:", page.locator(".final-total").inner_text().replace("\n", " "), "|", page.locator(".final-rank").inner_text())

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    run(ctx.new_page(), "desk")
    ctx.close()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    run(ctx.new_page(), "mob")
    b.close()

print("ERRORS:" if errors else "no errors")
for e in errors[:30]:
    print(" ", e)
