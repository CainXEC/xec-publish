#!/usr/bin/env python3
"""faces1 — faces for the collection, three idioms:
  GLYPH  : ☺ ☻ ☹ through the any-noun pipeline (features = negative space, free)
  GEO    : circle mask + feature holes — smiley, wink, tragedy mask
  KAOMOJI: punctuation faces rendered huge — (^_^) (•_•) (>_<) and the shrug
Paper variant appears where noted (confirmed prize tier).
Run: python3 faces1.py -> face_0..face_7.png
"""
import hashlib, random, os
from PIL import Image, ImageDraw, ImageFont
from glyphgen1 import (glyph_mask, fill, HUES, GOLD, PAPER, PAPER_BOT, INK, BGS,
                       CANVAS, W, H, CW, CH, font, sh, mix)

def ell(cx,cy,rx,ry):
    cells=set()
    for y in range(int(cy-ry),int(cy+ry)+1):
        for x in range(int(cx-rx),int(cx+rx)+1):
            if ((x-cx)/rx)**2+((y-cy)/ry)**2<=1.0: cells.add((x,y))
    return cells

def arc_smile(cx,cy,rx,ry,thick=1.6,frown=False):
    cells=set()
    for y in range(int(cy-ry-2),int(cy+ry+3)):
        for x in range(int(cx-rx-2),int(cx+rx+3)):
            d=((x-cx)/rx)**2+((y-cy)/ry)**2
            if 1.0-thick*0.28<=d<=1.0+thick*0.28:
                below = y>cy if not frown else y<cy
                if below: cells.add((x,y))
    return cells

# ---------------- geometric faces (mask + holes) ------------------------------
def geo_smiley(kind,rng):
    face=ell(32,15,15,11)
    eyeL=ell(26,11,2.2,1.6); eyeR=ell(38,11,2.2,1.6)
    if kind=='wink':
        eyeR={(x,12) for x in range(36,41)}
    mouth=arc_smile(32,14,8,6)
    if kind=='tragedy':
        mouth=arc_smile(32,24,8,5,frown=True)
        eyeL=arc_smile(26,12,3,2,frown=True); eyeR=arc_smile(38,12,3,2,frown=True)
    holes=eyeL|eyeR|mouth
    return face,holes

def render_geo(seed,kind,paper=False):
    rng=random.Random(hashlib.sha256(seed.encode()).digest())
    txid=hashlib.sha256(("txid:"+seed).encode()).hexdigest()
    hue=HUES[rng.randrange(len(HUES))]
    mask,holes=geo_smiley(kind,rng)
    g_ch=[[' ']*W for _ in range(H)]; g_co=[[None]*W for _ in range(H)]
    fill(g_ch,g_co,mask-holes,rng,txid,hue,paper=paper)
    return finish(g_ch,g_co,rng,txid,hue,paper)

# ---------------- glyph faces -------------------------------------------------
def render_glyphface(seed,ch,paper=False):
    rng=random.Random(hashlib.sha256(seed.encode()).digest())
    txid=hashlib.sha256(("txid:"+seed).encode()).hexdigest()
    hue=HUES[rng.randrange(len(HUES))]
    mask=glyph_mask(ch)
    g_ch=[[' ']*W for _ in range(H)]; g_co=[[None]*W for _ in range(H)]
    fill(g_ch,g_co,mask,rng,txid,hue,paper=paper)
    return finish(g_ch,g_co,rng,txid,hue,paper)

# ---------------- kaomoji (typed, huge) ---------------------------------------
KAOMOJI={
'joy':    "(^_^)",
'stare':  "(•_•)",
'wince':  "(>_<)",
'shrug':  "¯\\_(ツ)_/¯",
'surprise':"(°ο°)",
}
def render_kaomoji(seed,name,paper=False):
    rng=random.Random(hashlib.sha256(seed.encode()).digest())
    txid=hashlib.sha256(("txid:"+seed).encode()).hexdigest()
    hue=HUES[rng.randrange(len(HUES))]
    s=KAOMOJI[name]
    Wk,Hk=max(14,len(s)+4),7
    g_ch=[[' ']*Wk for _ in range(Hk)]; g_co=[[None]*Wk for _ in range(Hk)]
    ox=(Wk-len(s))//2; oy=Hk//2
    for i,c in enumerate(s):
        if c==' ': continue
        col = mix(INK,PAPER,0.05) if paper else sh(hue,0.95)
        if c in '•°ο^': col=GOLD if not paper else mix((150,60,40),PAPER,0.1)
        g_ch[oy][ox+i]=c; g_co[oy][ox+i]=col
    return finish(g_ch,g_co,rng,txid,hue,paper,grid=(Wk,Hk),sig=False)

# ---------------- shared finisher ---------------------------------------------
def finish(g_ch,g_co,rng,txid,hue,paper,grid=None,sig=True):
    gw,gh = grid or (W,H)
    cw,chh = CANVAS//gw, CANVAS//gh
    if sig:
        s='«'+txid[:12]+'»'
        for i,c in enumerate(s):
            g_ch[gh-1][gw-2-len(s)+i]=c
            g_co[gh-1][gw-2-len(s)+i]= mix(INK,PAPER,0.6) if paper else sh(hue,0.3)
    if paper: top,bot=PAPER,PAPER_BOT
    else:
        bg=BGS[rng.randrange(len(BGS))][1]
        top,bot=mix(bg,sh(hue,0.12),0.35),sh(bg,0.7)
    img=Image.new('RGB',(CANVAS,CANVAS))
    d=ImageDraw.Draw(img)
    for py in range(CANVAS):
        d.line([(0,py),(CANVAS,py)],fill=mix(top,bot,py/CANVAS))
    f=font(min(int(chh*0.88),int(cw*1.55)))
    for y in range(gh):
        for x in range(gw):
            if g_ch[y][x]==' ' or g_co[y][x] is None: continue
            d.text((x*cw,y*chh-int(chh*0.08)),g_ch[y][x],font=f,fill=g_co[y][x])
    return img

if __name__=='__main__':
    here=os.path.dirname(os.path.abspath(__file__))
    jobs=[('glyph ☺',lambda: render_glyphface('seed-40','☺')),
          ('glyph ☻',lambda: render_glyphface('seed-41','☻')),
          ('glyph ☹ paper',lambda: render_glyphface('seed-42','☹',paper=True)),
          ('geo smiley',lambda: render_geo('seed-43','smiley')),
          ('geo wink',lambda: render_geo('seed-44','wink')),
          ('geo tragedy',lambda: render_geo('seed-45','tragedy')),
          ('kaomoji shrug',lambda: render_kaomoji('seed-46','shrug')),
          ('kaomoji stare paper',lambda: render_kaomoji('seed-47','stare',paper=True))]
    for i,(label,fn) in enumerate(jobs):
        im=fn(); p=os.path.join(here,f'face_{i}.png'); im.save(p)
        print('wrote',p,f'({label})')
