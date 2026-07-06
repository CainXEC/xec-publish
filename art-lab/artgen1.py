#!/usr/bin/env python3
"""proofofwriting ASCII art — categories prototype.
Three art idioms, one collection:
  SCENES      : mountains / ocean (procedural, 64x32 grid)
  SILHOUETTES : cat / owl / skull / butterfly — shape masks filled with glowing
                characters, features as negative space (dense-ASCII idiom)
  TYPED       : small hand-typed critters rendered HUGE (minimal idiom)
All seeded; one neon hue + accents; txid signed in the corner.
Run: python3 artgen1.py -> art_0..art_5.png (1024x1024 each)
"""
import hashlib, random, os
from PIL import Image, ImageDraw, ImageFont

FONTS=["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
       "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
def font(sz):
    for p in FONTS:
        try: return ImageFont.truetype(p,sz)
        except Exception: pass
    return ImageFont.load_default()
def sh(c,f): return tuple(max(0,min(255,int(v*f))) for v in c)

HUES=[(0,255,156),(61,240,255),(255,180,40),(255,70,140),(178,120,255),(235,255,245)]
GOLD=(255,214,120); WHITE=(240,250,246)
CANVAS=1024

# ------------------------------------------------------------ grid canvas
class Grid:
    def __init__(self,W,H):
        self.W,self.H=W,H
        self.ch=[[' ']*W for _ in range(H)]
        self.co=[[None]*W for _ in range(H)]
    def put(self,x,y,c,col):
        if 0<=x<self.W and 0<=y<self.H:
            self.ch[y][x]=c; self.co[y][x]=col
    def render(self,bg):
        cw,chh=CANVAS//self.W,CANVAS//self.H
        img=Image.new('RGB',(CANVAS,CANVAS),bg)
        d=ImageDraw.Draw(img)
        f=font(int(chh*0.88))
        for y in range(self.H):
            for x in range(self.W):
                if self.ch[y][x]==' ' or self.co[y][x] is None: continue
                d.text((x*cw,y*chh-int(chh*0.08)),self.ch[y][x],font=f,fill=self.co[y][x])
        return img

def signature(g,txid,hue):
    s='«'+txid[:12]+'»'
    for i,c in enumerate(s):
        g.put(g.W-2-len(s)+i,g.H-1,c,sh(hue,0.3))

def ell(cx,cy,rx,ry):
    cells=set()
    for y in range(int(cy-ry),int(cy+ry)+1):
        for x in range(int(cx-rx),int(cx+rx)+1):
            if ((x-cx)/rx)**2+((y-cy)/ry)**2<=1.0: cells.add((x,y))
    return cells

def tri(x0,y0,x1,y1,x2,y2):
    cells=set()
    minx,maxx=min(x0,x1,x2),max(x0,x1,x2)
    miny,maxy=min(y0,y1,y2),max(y0,y1,y2)
    def sign(ax,ay,bx,by,px,py): return (px-bx)*(ay-by)-(ax-bx)*(py-by)
    for y in range(miny,maxy+1):
        for x in range(minx,maxx+1):
            b1=sign(x0,y0,x1,y1,x,y)<=0; b2=sign(x1,y1,x2,y2,x,y)<=0; b3=sign(x2,y2,x0,y0,x,y)<=0
            if b1==b2==b3: cells.add((x,y))
    return cells

FILL=' .:-=+*#%@'
def fill_mask(g,mask,holes,hue,rng,txchars=None,vert_light=True):
    if not mask: return
    ys=[y for (_,y) in mask]; y0,y1=min(ys),max(ys)
    edge={(x,y) for (x,y) in mask if not all((x+dx,y+dy) in mask for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)))}
    for (x,y) in sorted(mask,key=lambda c:(c[1],c[0])):
        if (x,y) in holes: continue
        t=(y-y0)/max(1,y1-y0)
        b=0.85-0.45*t if vert_light else 0.6
        if (x,y) in edge: b=min(1.0,b+0.35); ch='@' if rng.random()<0.3 else '#'
        else:
            ch = txchars[rng.randrange(64)] if txchars else FILL[min(len(FILL)-1,int(3+b*6))]
        g.put(x,y,ch,sh(hue,b))

# ------------------------------------------------------------ silhouettes
def art_cat(g,rng,hue,txid):
    head=ell(32,9,9,5)
    earL=tri(24,7,27,1,31,6); earR=tri(33,6,37,1,40,7)
    body=ell(32,22,11,9)
    base={(x,y) for (x,y) in body if y<=29}
    tail=set()
    for i in range(14):
        tx=43+int(3.5*(1 if i<7 else -0.2)*(i/7 if i<7 else 1))
        tail |= {(43+i//2, 29-i)} if False else set()
    for i in range(12):
        tail.add((44+ (i//3), 28-i))
    mask=head|earL|earR|base|tail
    eyes={(28,9),(29,9),(35,9),(36,9)}
    fill_mask(g,mask,eyes,hue,rng,txchars=txid)
    for (x,y) in eyes: g.put(x,y,'@',GOLD)
    g.put(32,11,'v',sh(WHITE,0.9))
    for (dx,c) in ((-3,'-'),(-4,'-'),(3,'-'),(4,'-')):
        g.put(32+dx,12,c,sh(hue,0.5))

def art_owl(g,rng,hue,txid):
    body=ell(32,17,10,11)
    tuftL=tri(23,9,25,3,28,8); tuftR=tri(36,8,39,3,41,9)
    mask=body|tuftL|tuftR
    eyeL=ell(27,12,3,2); eyeR=ell(37,12,3,2)
    holes=eyeL|eyeR
    fill_mask(g,mask,holes,hue,rng)
    for (x,y) in eyeL|eyeR:
        edge = not all((x+dx,y+dy) in (eyeL|eyeR) for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)))
        if edge: g.put(x,y,'O',sh(GOLD,0.9))
    g.put(27,12,'@',WHITE); g.put(37,12,'@',WHITE)
    g.put(32,14,'v',sh(GOLD,0.95))
    for x in range(20,45): g.put(x,29,'─',sh(hue,0.5))
    g.put(29,28,'w',sh(GOLD,0.8)); g.put(35,28,'w',sh(GOLD,0.8))
    for _ in range(10):
        g.put(rng.randrange(2,62),rng.randrange(0,5),rng.choice('.·*'),sh(hue,0.3))

def art_skull(g,rng,hue,txid):
    cran=ell(32,11,10,7)
    jaw={(x,y) for x in range(26,39) for y in range(17,24)}
    jaw={(x,y) for (x,y) in jaw if abs(x-32)<= (23-y)//1 +4}
    mask=cran|jaw
    eyeL=ell(28,11,2.6,1.8); eyeR=ell(36,11,2.6,1.8)
    nose=tri(31,16,33,16,32,13)
    holes=eyeL|eyeR|nose
    fill_mask(g,mask,holes,WHITE,rng,txchars=txid,vert_light=True)
    for x in range(27,38):
        if 27<=x<=37: g.put(x,20,'|' if x%2 else ' ',sh(WHITE,0.85))
    g.put(28,11,'@',sh(hue,1.0)); g.put(36,11,'@',sh(hue,1.0))
    for _ in range(8):
        g.put(rng.randrange(2,62),rng.randrange(26,31),rng.choice('.,·'),sh(hue,0.25))

def art_butterfly(g,rng,hue,txid):
    hue2=HUES[rng.randrange(len(HUES))]
    wUL=ell(24,11,9,6); wUR=ell(40,11,9,6)
    wLL=ell(26,21,7,5); wLR=ell(38,21,7,5)
    body={(x,y) for x in (31,32,33) for y in range(7,26)}
    fill_mask(g,wUL|wLL,set(),hue,rng,txchars=txid)
    fill_mask(g,wUR|wLR,set(),hue2,rng,txchars=txid)
    for (x,y) in body: g.put(x,y,'#',sh(WHITE,0.7))
    g.put(30,6,'\\',sh(WHITE,0.8)); g.put(34,6,'/',sh(WHITE,0.8))
    g.put(29,5,'·',GOLD); g.put(35,5,'·',GOLD)
    for (dx,dy) in [(-4,-2),(4,-2),(-5,3),(5,3)]:
        g.put(32+dx*2,16+dy,'o',sh(hue,0.4))

# ------------------------------------------------------------ typed critters
TYPED={
'cat':[
r"  /\_/\  ",
r" ( o.o ) ",
r" =( ^ )= ",
r"  |   |  ",
r" (_)-(_) "],
'owl':[
r"  ,___,  ",
r"  (O,O)  ",
r"  /)_)   ",
r'   " "   '],
'bunny':[
r" (\ (\   ",
r" ( -.-)  ",
r" o(\")(\")"],
'writer':[
r" \\(*_*)  ",
r"  ( (>¶  ",
r"  /  \\   "],
}
def art_typed(g,rng,hue,txid,which=None):
    name=which or rng.choice(list(TYPED))
    art=TYPED[name]
    h=len(art); w=max(len(r) for r in art)
    # coarse placement: center on the grid, 1 art char per 2x1 grid cells? keep 1:1 on a coarse grid
    ox=(g.W-w)//2; oy=(g.H-h)//2
    accent={'o':GOLD,'O':GOLD,'*':GOLD,'@':GOLD,'¶':sh(hue,1.0)}
    for j,row in enumerate(art):
        for i,c in enumerate(row):
            if c==' ': continue
            g.put(ox+i,oy+j,c,accent.get(c,sh(hue,0.9)))
    for _ in range(12):
        g.put(rng.randrange(1,g.W-1),rng.randrange(0,g.H),rng.choice('.·'),sh(hue,0.22))

# ------------------------------------------------------------ scenes (from scenegen)
def scene_mountains(g,rng,hue,txid):
    hor=rng.randrange(20,25)
    for _ in range(16):
        g.put(rng.randrange(g.W),rng.randrange(0,hor-6),rng.choice('.·+*'),sh(hue,rng.choice([0.3,0.5])))
    cx,cy=rng.randrange(8,g.W-8),rng.randrange(3,8)
    for y in range(cy-2,cy+3):
        for x in range(cx-4,cx+5):
            d=(((x-cx)/2)**2+(y-cy)**2)**0.5
            if d<=1.6: g.put(x,y,'@',sh(GOLD,0.95))
            elif d<=2.4: g.put(x,y,'o',sh(GOLD,0.55))
    for base,amp,chars,bright in [(hor-2,7,'-:',0.35),(hor-1,9,'=+',0.55),(hor,12,'#%',0.85)]:
        y=base-amp*0.5; v=rng.uniform(-1,1); ridge=[]
        for x in range(g.W):
            v+=rng.uniform(-0.5,0.5); v=max(-1.2,min(1.2,v)); y+=v*0.6
            y=max(base-amp,min(base+amp*0.4,y)); ridge.append(int(y))
        for x in range(g.W):
            top=max(1,ridge[x])
            for yy in range(top,base+1):
                t=(yy-top)/max(1,base-top)
                g.put(x,yy,chars[0] if t<0.5 else chars[1],sh(hue,bright*(0.7+0.3*t)))
            if top<base-3: g.put(x,top,'^',sh(WHITE,0.8))
    for y in range(hor+1,g.H):
        for x in range(g.W):
            if rng.random()<0.5:
                g.put(x,y,rng.choice('~-'),sh(hue,0.28*(1-(y-hor)/(g.H-hor)*0.5)))

CATS=[('scene',scene_mountains),('cat',art_cat),('owl',art_owl),
      ('skull',art_skull),('butterfly',art_butterfly),('typed',art_typed)]

def render(seed:str,force=None):
    rng=random.Random(hashlib.sha256(seed.encode()).digest())
    txid=hashlib.sha256(("txid:"+seed).encode()).hexdigest()
    hue=HUES[rng.randrange(len(HUES))]
    name,fn = CATS[force] if force is not None else CATS[rng.randrange(len(CATS))]
    g=Grid(64,32) if name!='typed' else Grid(26,13)
    fn(g,rng,hue,txid)
    if name!='typed': signature(g,txid,hue)
    return g.render(sh(hue,0.045))

if __name__=='__main__':
    here=os.path.dirname(os.path.abspath(__file__))
    for i in range(6):
        im=render(f'seed-{i}',force=i)          # one of each category
        p=os.path.join(here,f'art_{i}.png'); im.save(p); print('wrote',p)
