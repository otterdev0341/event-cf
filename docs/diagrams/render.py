"""Rebuild architecture JPEGs: python3 docs/diagrams/render.py (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

OUT = Path(__file__).resolve().parent
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
INK = '#18283e'
BLUE = '#2563eb'

def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)

def canvas(title, subtitle):
    im = Image.new('RGB', (1800, 1100), '#f5f7fb')
    d = ImageDraw.Draw(im)
    d.text((70, 48), title, font=font(43, True), fill=INK)
    d.text((72, 112), subtitle, font=font(23), fill='#526178')
    return im, d

def box(d, rect, title, lines, color=BLUE):
    x, y, r, b = rect
    d.rounded_rectangle(rect, radius=18, fill='white', outline='#cbd5e1', width=2)
    d.rounded_rectangle((x, y, x+8, b), radius=4, fill=color)
    d.text((x+26, y+24), title, font=font(26, True), fill=color)
    for n, line in enumerate(lines):
        d.text((x+26, y+77+n*36), line, font=font(21), fill=INK)

def arrow(d, points, label=None, at=None, color=BLUE):
    d.line(points, fill=color, width=4, joint='curve')
    a, b = points[-2:]
    angle = math.atan2(b[1]-a[1], b[0]-a[0])
    wing = [(b[0]-17*math.cos(angle+s), b[1]-17*math.sin(angle+s)) for s in (-.5,.5)]
    d.polygon([b, *wing], fill=color)
    if label:
        x,y=at
        bounds=d.textbbox((x,y),label,font=font(19))
        d.rectangle((bounds[0]-8,bounds[1]-5,bounds[2]+8,bounds[3]+5),fill='#f5f7fb')
        d.text((x,y),label,font=font(19),fill=INK)

im,d=canvas('Event Confirm | Application architecture', 'Source baseline: 8a7ea40  /  Existing app code; NOT served by the new foundation deployment')
box(d,(70,300,490,665),'Browser / React + Vite',[
    'src/App.tsx + src/routes.ts', 'Pages, components and hooks', 'Campaign CSV + mapping',
    'Supabase session', 'Botnoi API client', 'Audio repair Web Worker'])
box(d,(650,300,1150,665),'API adapters + server modules',[
    'api/*.mjs -> server/*.mjs', 'voice: auth, routing, ownership', 'connection: encrypted credentials',
    'results / recordings / events', 'agent setup / scheduler', 'shared/: rules reused by UI + API'])
box(d,(1300,300,1730,665),'Supabase',[
    'Auth: users + sessions', 'Postgres + owner RLS', 'Campaigns + call requests',
    'Encrypted Voice Bot links', 'Jobs + scheduler heartbeat', 'Setup locks + audit trail'], '#087f6b')
box(d,(650,810,1150,1010),'Botnoi Voice Bot services',[
    'Account, agents, calls, logs', 'Audio + live preview WebSocket', 'Result / recording callbacks'], '#a65a08')
box(d,(70,810,490,1010),'Optional scheduler trigger',[
    'Supabase pg_cron + pg_net', 'Authenticated HTTP tick', 'Requires separate provisioning'], '#7851a9')
arrow(d,[(490,435),(650,435)],'Session JWT',(496,399))
arrow(d,[(1150,435),(1300,435)],'DB / RPC',(1168,399))
arrow(d,[(280,300),(280,215),(1510,215),(1510,300)],'Direct Auth + campaign access under RLS',(555,182),'#087f6b')
arrow(d,[(820,665),(820,810)],'Provider API',(835,719),'#a65a08')
arrow(d,[(1150,905),(1220,905),(1220,575),(1150,575)],'Callbacks',(1235,724),'#a65a08')
arrow(d,[(490,900),(565,900),(565,600),(650,600)],'Tick',(510,742),'#7851a9')
im.save(OUT/'application-architecture.jpg',quality=95,subsampling=0)

im,d=canvas('Event Confirm | Deployment foundation', 'Infrastructure only  /  Current app, Supabase credentials and scheduled calls are not activated')
box(d,(70,270,490,515),'Public client',[
    'https://otterdev.xyz', '/event-confirm/', '/event-confirm/*'])
box(d,(680,270,1100,515),'Shared edge nginx',[
    'Separate shared-edge service', 'Exact 308 trailing-slash redirect', 'Prefix proxy + route header'])
box(d,(1290,270,1730,515),'Project nginx container',[
    'Host port 18346', 'Readiness message + healthz', 'API routes return JSON 503'], '#087f6b')
arrow(d,[(490,390),(680,390)],'HTTPS ingress',(506,350))
arrow(d,[(1100,390),(1290,390)],'HTTP proxy',(1130,350))
box(d,(70,720,490,955),'GitHub',[
    'otterdev0341/event-cf', 'main branch', 'Jenkinsfile + infra + compose'])
box(d,(680,720,1100,955),'Jenkins: event-confirm',[
    'Disk gate + owned cleanup', 'Build / validate / deploy / smoke', 'Post cleanup on every outcome'])
box(d,(1290,720,1730,955),'Shared BuildKit builder',[
    'otter-shared-ci', 'One parallel build step', 'Central cache GC; shared lock'])
arrow(d,[(490,835),(680,835)],'SCM polling',(520,795))
arrow(d,[(1100,835),(1290,835)],'Build image',(1132,795))
arrow(d,[(1510,720),(1510,515)],'Immutable image',(1528,604),'#087f6b')
d.text((75,575),'Runtime: 0.25 CPU | 64 MiB RAM | no extra swap | 64 PIDs | bounded logs',font=font(25,True),fill=INK)
d.text((75,625),'Retention: deployed + rollback images; all volumes and container-referenced images protected',font=font(22),fill='#526178')
d.text((75,1022),'The rewrite replaces the project nginx readiness response while retaining routing and CI controls.',font=font(23),fill=INK)
im.save(OUT/'deployment-foundation.jpg',quality=95,subsampling=0)
print('Generated application-architecture.jpg and deployment-foundation.jpg')
