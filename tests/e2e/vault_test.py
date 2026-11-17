import smoke_helpers as H
from playwright.sync_api import sync_playwright
FAKE = """
window.google={maps:{StreetViewPanorama:function(){},StreetViewService:function(){this.getPanorama=function(_a,cb){cb({},'OK')}}}};
window.__sgwMapsReady&&window.__sgwMapsReady();"""
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    pg=b.new_context(viewport={"width":1100,"height":900}).new_page()
    seen=[]
    H.stub(pg)
    def maps(r):
        seen.append(r.request.url); r.fulfill(status=200,content_type="text/javascript",body=FAKE)
    pg.route("**/maps.googleapis.com/**",maps)
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("http://localhost:8765/index.html"); pg.wait_for_selector(".drawer")
    pg.click(".drawer summary")
    pg.fill("#vault-pw","wrong"); pg.click("text=Unlock"); pg.wait_for_timeout(1500)
    print("wrong ->", pg.locator(".status").inner_text(), "| saved:", pg.evaluate("localStorage.length"))
    pg.fill("#vault-pw","deva2009"); pg.click("text=Unlock"); pg.wait_for_timeout(2500)
    print("right ->", pg.locator(".status").inner_text())
    print("key requested from Google with real key:", any("key=AIza" in u for u in seen))
    pg.screenshot(path="/tmp/shots/vault.png")
    print("errors:", errs)
    b.close()
