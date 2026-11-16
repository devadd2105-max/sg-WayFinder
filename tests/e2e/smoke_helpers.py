import io, json, math, re
from PIL import Image, ImageDraw
BASE = "http://localhost:8765/index.html"
def _tile():
    img = Image.new("RGB",(256,256),(233,236,229)); d=ImageDraw.Draw(img)
    for i in range(0,256,64): d.line([(i,0),(i,256)],fill=(214,219,210)); d.line([(0,i),(256,i)],fill=(214,219,210))
    b=io.BytesIO(); img.save(b,"PNG"); return b.getvalue()
TILE=_tile()
def hav(a,b):
    R=6371008.8; p=math.radians; s=math.sin(p(b[0]-a[0])/2)**2+math.cos(p(a[0]))*math.cos(p(b[0]))*math.sin(p(b[1]-a[1])/2)**2
    return 2*R*math.asin(math.sqrt(s))
def stub(page, router="ok"):
    def osrm(route):
        if router=="fail": return route.fulfill(status=503, body="down")
        if router=="slow":
            import time; time.sleep(1.5)
        m=re.search(r"/route/v1/\w+/([\d.]+),([\d.]+);([\d.]+),([\d.]+)",route.request.url)
        x1,y1,x2,y2=map(float,m.groups()); d=hav((y1,x1),(y2,x2))*1.25
        route.fulfill(status=200,content_type="application/json",headers={"access-control-allow-origin":"*"},
          body=json.dumps({"code":"Ok","routes":[{"distance":d,"duration":d/1.3,"geometry":{"type":"LineString","coordinates":[[x1,y1],[(x1+x2)/2+.002,(y1+y2)/2+.001],[x2,y2]]}}]}))
    page.route("**/{tile.openstreetmap.org,server.arcgisonline.com}/**",lambda r:r.fulfill(status=200,content_type="image/png",body=TILE))
    page.route("**/routing.openstreetmap.de/**",osrm)
    page.route("**/fonts.googleapis.com/**",lambda r:r.abort()); page.route("**/fonts.gstatic.com/**",lambda r:r.abort())
