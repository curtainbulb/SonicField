# Downloads each matched cover once, writes 160/320/480px WebP files into art/, and stores the average colour
# in data/resolved.json ("col") so tiles paint a correct-colour placeholder before the image arrives.
import json, io, os, urllib.request
from PIL import Image
P = 'data/resolved.json'; db = json.load(open(P)); os.makedirs('art', exist_ok=True); n = 0
for k, r in db.items():
    if not r or r.get('col') or not r.get('art'): continue
    try:
        raw = urllib.request.urlopen(urllib.request.Request(r['art'], headers={'User-Agent': 'sonicfield'}), timeout=30).read()
        im = Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception as e: print('skip', k, e); continue
    for s in (160, 320, 480): im.resize((s, s), Image.LANCZOS).save(f'art/{r["id"]}-{s}.webp', 'WEBP', quality=72, method=6)
    r['col'] = '#%02x%02x%02x' % im.resize((1, 1), Image.BOX).getpixel((0, 0)); n += 1
    if n % 25 == 0: json.dump(db, open(P, 'w'), separators=(',', ':'))
json.dump(db, open(P, 'w'), separators=(',', ':')); print('processed', n)
