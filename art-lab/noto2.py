#!/usr/bin/env python3
"""noto2 — FULL-BREADTH library. No hand-picking:
 - scans every emoji codepoint range in NotoEmoji.ttf
 - names each glyph from the Unicode database (unicodedata.name)
 - QUALITY FILTERS: mask must have >= MIN_CELLS cells and >= MIN_SOLIDITY
   fill ratio (culls thin line-art that thresholds patchily)
 - excludes people/skin-tone/flag ranges (identity-sensitive, ZWJ-dependent)
Outputs: noto_library.json (name->char), noto_library.txt (readable),
         noto_breadth_sheet.png (16 random subjects, full-res tiles)
"""
import json, random, unicodedata, os
from PIL import Image, ImageFont
from noto1 import glyph_mask_centered, render, NOTO

RANGES=[(0x2600,0x27BF),(0x1F300,0x1F5FF),(0x1F600,0x1F64F),
        (0x1F680,0x1F6FF),(0x1F900,0x1F9FF),(0x1FA00,0x1FAFF)]
EXCLUDE=[(0x1F3FB,0x1F3FF),(0x1F1E6,0x1F1FF),   # skin tones, flags
         (0x1F466,0x1F487),(0x1F9D0,0x1F9DD),   # people
         (0x1F574,0x1F575),(0x1F645,0x1F64F),   # people gestures
         (0x1F6B4,0x1F6B7),(0x1F930,0x1F93E)]   # people activities
MIN_CELLS=70
MIN_SOLIDITY=0.16

def excluded(cp):
    return any(a<=cp<=b for a,b in EXCLUDE)

def build_library():
    f=ImageFont.truetype(NOTO,100)
    lib={}
    stats={'scanned':0,'rendered':0,'kept':0}
    for a,b in RANGES:
        for cp in range(a,b+1):
            if excluded(cp): continue
            ch=chr(cp); stats['scanned']+=1
            try: bb=f.getbbox(ch)
            except Exception: continue
            if not bb or bb[2]-bb[0]<6 or bb[3]-bb[1]<6: continue
            stats['rendered']+=1
            mask=glyph_mask_centered(ch)
            if len(mask)<MIN_CELLS: continue
            xs=[x for x,_ in mask]; ys=[y for _,y in mask]
            area=(max(xs)-min(xs)+1)*(max(ys)-min(ys)+1)
            if len(mask)/max(1,area)<MIN_SOLIDITY: continue
            try: name=unicodedata.name(ch).lower().replace(' ','-')
            except ValueError: name=f'u{cp:04x}'
            lib[name]=ch; stats['kept']+=1
    return lib,stats

if __name__=='__main__':
    here=os.path.dirname(os.path.abspath(__file__))
    lib,stats=build_library()
    print(f"scanned {stats['scanned']} codepoints, {stats['rendered']} render, "
          f"{stats['kept']} pass quality filters")
    with open(os.path.join(here,'noto_library.json'),'w') as fh:
        json.dump(lib,fh,ensure_ascii=False,indent=0)
    with open(os.path.join(here,'noto_library.txt'),'w') as fh:
        for name in sorted(lib): fh.write(f"{lib[name]}  {name}\n")
    print("wrote noto_library.json / noto_library.txt")
    rng=random.Random(7)
    picks=rng.sample(sorted(lib.items()),16)
    cols=4
    sheet=Image.new('RGB',(1024*cols,1024*4),(0,0,0))
    for i,(name,ch) in enumerate(picks):
        im=render(f'breadth-{i}',ch,paper=(i==13))
        sheet.paste(im,((i%cols)*1024,(i//cols)*1024))
        print('rendered',name)
    p=os.path.join(here,'noto_breadth_sheet.png'); sheet.save(p)
    print('wrote',p)
