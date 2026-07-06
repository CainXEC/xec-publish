#!/usr/bin/env python3
"""glyphgen1 — the ANY-NOUN pipeline.
A symbol/emoji glyph from an open-licensed font becomes a silhouette mask
(threshold + cell sampling at the 2:1 char aspect), then our ASCII system
fills it: txid hex or density ramp, edge brightening, per-seed hue.
Backgrounds: vivid dark colorways (visibly colored, not black) + a PAPER
variant — dark ink on light manuscript ground (natural rare tier).
Run: python3 glyphgen1.py -> glyph_0..glyph_8.png
"""
import hashlib, random, os
from PIL import Image, ImageDraw, ImageFont

CANVAS=1024; W,H=64,32
CW,CH=CANVAS//W,CANVAS//H
FMONO=["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"]
FSYM ="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
def font(sz,path=None):
    try: return ImageFont.truetype(path or FMONO[0],sz)
    except Exception: return ImageFont.load_default()
def sh(c,f): return tuple(max(0,min(255,int(v*f))) for v in c)
def mix(a,b,t): return tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))

HUES=[(0,255,156),(61,240,255),(255,180,40),(255,70,140),(178,120,255),(235,255,245)]
GOLD=(255,214,120)

# vivid dark colorways (visibly colored) + paper
BGS=[('midnight',(14,22,46)),('plum',(38,14,42)),('wine',(46,10,20)),
     ('pine',(8,34,22)),('storm',(22,26,36)),('ember',(40,20,8)),
     ('void',(6,8,9))]
PAPER=(233,226,209); PAPER_BOT=(214,204,182); INK=(44,38,32)

SUBJECTS={'knight':'♞','queen':'♛','moon':'☾','pen-nib':'✒','anchor':'⚓',
          'note':'♪','umbrella':'☂','star':'★','heart':'♥','snowflake':'❄',
          'plane':'✈','sword':'⚔','scissors':'✂','phone':'☎','cup':'☕',
          'yin':'☯','comet':'☄','key':'⚿','flower':'✿','envelope':'✉'}

def glyph_mask(ch, max_cols=46, max_rows=26):
    """Render glyph large, threshold, sample at cell centers (2:1 aspect)."""
    f=font(560,FSYM)
    img=Image.new('L',(900,900),0)
    d=ImageDraw.Draw(img)
    d.text((450,450),ch,font=f,fill=255,anchor='mm')
    bb=img.getbbox()
    if not bb: return set()
    gx0,gy0,gx1,gy1=bb; gw,gh=gx1-gx0,gy1-gy0
    s=max(gw/max_cols, gh/(2*max_rows))       # cell is twice as tall as wide
    cols=int(gw/s); rows=int(gh/(2*s))
    ox=(W-cols)//2; oy=(H-rows)//2
    mask=set()
    px=img.load()
    for cy in range(rows):
        for cx in range(cols):
            # average a small neighborhood at the cell center
            sx=int(gx0+(cx+0.5)*s); sy=int(gy0+(cy+0.5)*2*s)
            tot=0; n=0
            for dy in (-2,0,2):
                for dx in (-2,0,2):
                    x,y=sx+dx,sy+dy
                    if 0<=x<900 and 0<=y<900: tot+=px[x,y]; n+=1
            if n and tot/n>110: mask.add((ox+cx,oy+cy))
    return mask

FILLRAMP='.:-=+*#%@'
def fill(g_ch,g_co,mask,rng,txid,hue,paper=False):
    if not mask: return
    ys=[y for (_,y) in mask]; y0,y1=min(ys),max(ys)
    edge={(x,y) for (x,y) in mask if not all((x+dx,y+dy) in mask
          for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)))}
    use_tx = rng.random()<0.6
    for (x,y) in sorted(mask,key=lambda c:(c[1],c[0])):
        t=(y-y0)/max(1,y1-y0)
        b=0.85-0.4*t
        if (x,y) in edge:
            b=min(1.0,b+0.35); ch='@' if rng.random()<0.3 else '#'
        else:
            ch = txid[rng.randrange(64)] if use_tx else FILLRAMP[min(8,int(2+b*6))]
        col = mix(INK,PAPER,1-b*1.05) if paper else sh(hue,b)
        g_ch[y][x]=ch; g_co[y][x]=col

def render(seed:str, subject=None, paper=None):
    rng=random.Random(hashlib.sha256(seed.encode()).digest())
    txid=hashlib.sha256(("txid:"+seed).encode()).hexdigest()
    hue=HUES[rng.randrange(len(HUES))]
    name = subject or rng.choice(sorted(SUBJECTS))
    is_paper = paper if paper is not None else (rng.random()<0.12)
    mask=glyph_mask(SUBJECTS[name])
    g_ch=[[' ']*W for _ in range(H)]; g_co=[[None]*W for _ in range(H)]
    fill(g_ch,g_co,mask,rng,txid,hue,paper=is_paper)
    # sparse ambience + txid signature
    amb = INK if is_paper else None
    for _ in range(rng.randrange(8,16)):
        x,y=rng.randrange(1,W-1),rng.randrange(0,H)
        if g_ch[y][x]!=' ': continue
        g_ch[y][x]=rng.choice('.·')
        g_co[y][x]= mix(INK,PAPER,0.72) if is_paper else sh(hue,0.25)
    sig='«'+txid[:12]+'»'
    for i,c in enumerate(sig):
        g_ch[H-1][W-2-len(sig)+i]=c
        g_co[H-1][W-2-len(sig)+i]= mix(INK,PAPER,0.6) if is_paper else sh(hue,0.3)
    # background
    if is_paper: top,bot=PAPER,PAPER_BOT
    else:
        bgname,bg=BGS[rng.randrange(len(BGS))]
        top,bot=mix(bg,sh(hue,0.12),0.35),sh(bg,0.7)
    img=Image.new('RGB',(CANVAS,CANVAS))
    d=ImageDraw.Draw(img)
    for py in range(CANVAS):
        d.line([(0,py),(CANVAS,py)],fill=mix(top,bot,py/CANVAS))
    f=font(min(int(CH*0.88),int(CW*1.55)))
    for y in range(H):
        for x in range(W):
            if g_ch[y][x]==' ' or g_co[y][x] is None: continue
            d.text((x*CW,y*CH-int(CH*0.08)),g_ch[y][x],font=f,fill=g_co[y][x])
    return img,name,('paper' if is_paper else 'dark')

if __name__=='__main__':
    here=os.path.dirname(os.path.abspath(__file__))
    picks=[('pen-nib',False),('knight',False),('moon',False),('anchor',False),
           ('sword',False),('cup',False),('yin',False),('queen',True),('flower',True)]
    for i,(subj,pap) in enumerate(picks):
        im,name,modev=render(f'seed-{i+30}',subject=subj,paper=pap)
        p=os.path.join(here,f'glyph_{i}.png'); im.save(p)
        print('wrote',p,f'({name}, {modev})')
