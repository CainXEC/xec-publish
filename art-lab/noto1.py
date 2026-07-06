#!/usr/bin/env python3
"""noto1 — the ANY-NOUN LIBRARY, powered by Noto Emoji (monochrome, OFL).
- curated noun list across animals / nature / objects / writer-things
- coverage check: only nouns whose glyphs actually render make the library
- CENTERING FIX: after thresholding, the mask is recentered on its ACTUAL
  bounding box, so every subject lands dead-center on the card
Run: python3 noto1.py -> prints library, renders noto_sheet.png (full-res
tiles, no downscaling) + a few singles
"""
import hashlib, random, os, math
from PIL import Image, ImageDraw, ImageFont
from glyphgen1 import (fill, HUES, GOLD, PAPER, PAPER_BOT, INK, BGS,
                       CANVAS, W, H, CW, CH, font, sh, mix)

NOTO=os.path.join(os.path.dirname(os.path.abspath(__file__)),'NotoEmoji.ttf')

LIBRARY={
 'animals':{'cat':'🐱','dog':'🐶','wolf':'🐺','fox':'🦊','owl':'🦉','eagle':'🦅',
            'butterfly':'🦋','fish':'🐟','whale':'🐋','octopus':'🐙','dragon':'🐉',
            'snake':'🐍','turtle':'🐢','rabbit':'🐰','frog':'🐸','horse':'🐴',
            'elephant':'🐘','lion':'🦁','tiger':'🐯','bear':'🐻','penguin':'🐧',
            'bat':'🦇','spider':'🕷','scorpion':'🦂','crab':'🦀','shark':'🦈',
            'unicorn':'🦄','t-rex':'🦖','raven':'🐦'},
 'nature': {'evergreen':'🌲','palm':'🌴','leaf':'🍁','rose':'🌹','sunflower':'🌻',
            'mushroom':'🍄','cactus':'🌵','wave':'🌊','volcano':'🌋','mountain':'⛰',
            'sun':'☀','crescent':'🌙','star':'⭐','comet':'☄','snowflake':'❄',
            'lightning':'⚡','cloud':'☁','rainbow':'🌈','earth':'🌍','full-moon':'🌕'},
 'objects':{'anchor':'⚓','key':'🗝','hourglass':'⌛','telescope':'🔭','crystal-ball':'🔮',
            'sword':'⚔','shield':'🛡','crown':'👑','gem':'💎','bell':'🔔',
            'lantern':'🏮','umbrella':'☂','balloon':'🎈','rocket':'🚀','sailboat':'⛵',
            'moai':'🗿','skull':'💀','ghost':'👻','robot':'🤖','alien':'👽',
            'chess-pawn':'♟','dice':'🎲','guitar':'🎸','violin':'🎻','trumpet':'🎺',
            'camera':'📷','clock':'🕰','compass':'🧭','coffee':'☕','wine':'🍷'},
 'writer': {'fountain-pen':'🖋','pen':'🖊','pencil':'✏','quill-nib':'✒','book':'📖',
            'books':'📚','scroll':'📜','envelope':'✉','newspaper':'📰','bookmark':'🔖',
            'memo':'📝','mailbox':'📮','paperclip':'📎','inbox':'📥','label':'🏷'},
}

def coverage():
    f=ImageFont.truetype(NOTO,100)
    ok={}
    for cat,subs in LIBRARY.items():
        good={}
        for name,ch in subs.items():
            try:
                bb=f.getbbox(ch)
                if bb and bb[2]-bb[0]>5 and bb[3]-bb[1]>5: good[name]=ch
            except Exception: pass
        ok[cat]=good
    return ok

def glyph_mask_centered(ch, max_cols=46, max_rows=26):
    f=ImageFont.truetype(NOTO,560)
    img=Image.new('L',(900,900),0)
    d=ImageDraw.Draw(img)
    d.text((450,450),ch,font=f,fill=255,anchor='mm')
    bb=img.getbbox()
    if not bb: return set()
    gx0,gy0,gx1,gy1=bb; gw,gh=gx1-gx0,gy1-gy0
    s=max(gw/max_cols, gh/(2*max_rows))
    cols=max(1,int(gw/s)); rows=max(1,int(gh/(2*s)))
    px=img.load()
    raw=set()
    for cy in range(rows):
        for cx in range(cols):
            sx=int(gx0+(cx+0.5)*s); sy=int(gy0+(cy+0.5)*2*s)
            tot=0; n=0
            for dy in (-2,0,2):
                for dx in (-2,0,2):
                    x,y=sx+dx,sy+dy
                    if 0<=x<900 and 0<=y<900: tot+=px[x,y]; n+=1
            if n and tot/n>110: raw.add((cx,cy))
    if not raw: return set()
    # CENTERING FIX: recenter on the actual mask bbox
    xs=[x for (x,_) in raw]; ys=[y for (_,y) in raw]
    mw,mh=max(xs)-min(xs)+1,max(ys)-min(ys)+1
    ox=(W-mw)//2-min(xs); oy=(H-mh)//2-min(ys)
    return {(x+ox,y+oy) for (x,y) in raw}

def render(seed:str, ch, paper=False):
    rng=random.Random(hashlib.sha256(seed.encode()).digest())
    txid=hashlib.sha256(("txid:"+seed).encode()).hexdigest()
    hue=HUES[rng.randrange(len(HUES))]
    mask=glyph_mask_centered(ch)
    g_ch=[[' ']*W for _ in range(H)]; g_co=[[None]*W for _ in range(H)]
    fill(g_ch,g_co,mask,rng,txid,hue,paper=paper)
    for _ in range(rng.randrange(8,14)):
        x,y=rng.randrange(1,W-1),rng.randrange(0,H)
        if g_ch[y][x]!=' ': continue
        g_ch[y][x]=rng.choice('.·')
        g_co[y][x]= mix(INK,PAPER,0.72) if paper else sh(hue,0.25)
    sig='«'+txid[:12]+'»'
    for i,c in enumerate(sig):
        g_ch[H-1][W-2-len(sig)+i]=c
        g_co[H-1][W-2-len(sig)+i]= mix(INK,PAPER,0.6) if paper else sh(hue,0.3)
    if paper: top,bot=PAPER,PAPER_BOT
    else:
        bg=BGS[rng.randrange(len(BGS))][1]
        top,bot=mix(bg,sh(hue,0.12),0.35),sh(bg,0.7)
    img=Image.new('RGB',(CANVAS,CANVAS))
    d=ImageDraw.Draw(img)
    for py in range(CANVAS):
        d.line([(0,py),(CANVAS,py)],fill=mix(top,bot,py/CANVAS))
    f2=font(min(int(CH*0.88),int(CW*1.55)))
    for y in range(H):
        for x in range(W):
            if g_ch[y][x]==' ' or g_co[y][x] is None: continue
            d.text((x*CW,y*CH-int(CH*0.08)),g_ch[y][x],font=f2,fill=g_co[y][x])
    return img

if __name__=='__main__':
    here=os.path.dirname(os.path.abspath(__file__))
    lib=coverage()
    total=0
    for cat,subs in lib.items():
        print(f"{cat}: {len(subs)} -> {', '.join(sorted(subs))}")
        total+=len(subs)
    print(f"TOTAL available: {total}")
    # full-res spread: 12 subjects, tiles at native 1024 (no downscaling)
    picks=[('fox',lib['animals'].get('fox')),('owl',lib['animals'].get('owl')),
           ('dragon',lib['animals'].get('dragon')),('whale',lib['animals'].get('whale')),
           ('evergreen',lib['nature'].get('evergreen')),('wave',lib['nature'].get('wave')),
           ('rocket',lib['objects'].get('rocket')),('crystal-ball',lib['objects'].get('crystal-ball')),
           ('crown',lib['objects'].get('crown')),('fountain-pen',lib['writer'].get('fountain-pen')),
           ('book',lib['writer'].get('book')),('scroll',lib['writer'].get('scroll'))]
    picks=[(n,c) for n,c in picks if c]
    cols=4; rows=(len(picks)+cols-1)//cols
    sheet=Image.new('RGB',(CANVAS*cols,CANVAS*rows),(0,0,0))
    for i,(name,ch) in enumerate(picks):
        im=render(f'noto-{i}',ch,paper=(name=='scroll'))
        sheet.paste(im,((i%cols)*CANVAS,(i//cols)*CANVAS))
        print('rendered',name)
    p=os.path.join(here,'noto_sheet.png'); sheet.save(p); print('wrote',p,sheet.size)
