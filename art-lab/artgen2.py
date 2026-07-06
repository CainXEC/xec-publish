#!/usr/bin/env python3
"""artgen2 — fixes + variety on the approved direction:
  1. TYPED critters rebuilt with verified symmetry (escaping bug fixed);
     they print to stdout so symmetry is provable in text.
  2. BACKGROUNDS: independent dark-hue palette (8 tints) + vertical gradient,
     chosen per seed separately from the foreground hue.
  3. Font size clamped to cell width so glyphs never crowd or clip.
Run: python3 artgen2.py -> art2_0..art2_7.png + prints typed art for review
"""
import hashlib, random, os
from PIL import Image, ImageDraw
from artgen1 import (Grid, art_cat, art_owl, art_skull, art_butterfly,
                     scene_mountains, signature, HUES, GOLD, WHITE, sh, font, CANVAS)

def mix(a,b,t): return tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))

# dark background tints — independent variety axis
BGS=[('void',(5,7,8)),('deep-teal',(6,16,14)),('indigo',(9,11,24)),
     ('violet',(17,9,24)),('crimson',(24,8,13)),('forest',(6,17,10)),
     ('slate',(13,15,18)),('abyss-blue',(5,12,22))]

class Grid2(Grid):
    def render_grad(self,bg_top,bg_bot):
        cw,chh=CANVAS//self.W,CANVAS//self.H
        img=Image.new('RGB',(CANVAS,CANVAS))
        d=ImageDraw.Draw(img)
        for py in range(CANVAS):
            d.line([(0,py),(CANVAS,py)],fill=mix(bg_top,bg_bot,py/CANVAS))
        size=min(int(chh*0.88),int(cw*1.55))   # never wider than the cell
        f=font(size)
        for y in range(self.H):
            for x in range(self.W):
                if self.ch[y][x]==' ' or self.co[y][x] is None: continue
                d.text((x*cw,y*chh-int(chh*0.08)),self.ch[y][x],font=f,fill=self.co[y][x])
        return img

# ---------------- typed critters, symmetry verified --------------------------
TYPED={
'cat':[
"  /\\_/\\  ",
" ( o.o ) ",
" =( ^ )= ",
"  |   |  ",
" (_)-(_) "],
'owl':[
"  ,___,  ",
"  (O.O)  ",
"  /)_(\\  ",
"   \" \"   "],
'bunny':[
"  (\\_/)  ",
" ( -.- ) ",
" (\")_(\") "],
'writer':[
" \\(^_^)/ ",
"   |¶|   ",
"   / \\   "],
}

def art_typed(g,rng,hue,txid,which=None):
    name=which or rng.choice(sorted(TYPED))
    art=TYPED[name]
    w=max(len(r) for r in art); h=len(art)
    ox=(g.W-w)//2; oy=(g.H-h)//2
    accent={'o':GOLD,'O':GOLD,'^':GOLD,'¶':sh(hue,1.0)}
    for j,row in enumerate(art):
        for i,c in enumerate(row):
            if c==' ': continue
            g.put(ox+i,oy+j,c,accent.get(c,sh(hue,0.92)))
    return name

CATS=[('scene',scene_mountains),('cat',art_cat),('owl',art_owl),
      ('skull',art_skull),('butterfly',art_butterfly),('typed',art_typed)]

def render(seed:str,force=None):
    rng=random.Random(hashlib.sha256(seed.encode()).digest())
    txid=hashlib.sha256(("txid:"+seed).encode()).hexdigest()
    hue=HUES[rng.randrange(len(HUES))]
    bgname,bg=BGS[rng.randrange(len(BGS))]
    name,fn = CATS[force%len(CATS)] if force is not None else CATS[rng.randrange(len(CATS))]
    g=Grid2(64,32) if name!='typed' else Grid2(26,13)
    fn(g,rng,hue,txid)
    if name!='typed': signature(g,txid,hue)
    top=mix(bg,sh(hue,0.10),0.4)             # faint hue bloom at the top
    return g.render_grad(top,bg), name, bgname

if __name__=='__main__':
    here=os.path.dirname(os.path.abspath(__file__))
    print("== typed art symmetry check ==")
    for name,art in TYPED.items():
        print(f"-- {name} --")
        for r in art: print(f"|{r}|")
    for i in range(8):
        im,name,bgname=render(f'seed-{i+10}',force=i)
        p=os.path.join(here,f'art2_{i}.png'); im.save(p)
        print('wrote',p,f'({name} on {bgname})')
