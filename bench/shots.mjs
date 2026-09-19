// A contact sheet of every screen the story has, in one picture.
//
// The suite drives the simulation and almost never renders, which is how a
// missing constant once crashed every land while 47 checks passed. Ticking is
// not seeing. This renders each land and each passage in the states a player
// meets them in, tiles them, and writes one PNG — small enough to open on a
// phone from the Actions tab after a push.
//
// It captures the whole stage, not just the canvas, because half the game's
// screens are DOM sheets laid over it — the map, the shop, pause. Capturing
// the canvas alone silently showed whatever was behind the sheet instead.
//
// The tiles are for spotting layout, not for reading 7px type. To look at one
// screen properly, open the game with ?land=glade or ?stage=reeds.
//
// It lives outside test/ on purpose: run-all.mjs treats every file there as a
// suite, and smoke.mjs then demands a matching CI matrix entry and npm script.
// This is a bench tool, not a gate. It asserts nothing, but it does fail on a
// screen that throws.
//
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  npm run shots        (writes bench/contact-sheet.png)
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const PAGE = pathToFileURL(HERE + '../index.html').href;
const OUT = process.env.SHEET_OUT || HERE + 'contact-sheet.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(PAGE);
await page.waitForFunction(() => !!window.__dreybird);

/* The list is built from the tables, not written out, so a new land appears
   here the moment it exists — which is most of the point of the sheet. */
const plan = await page.evaluate(() => {
  const d = window.__dreybird;
  const out = [{ kind: 'title' }, { kind: 'map' }];
  for (const id of Object.keys(d.LANDS)) {
    const land = d.LANDS[id];
    out.push({ kind: 'land', id, state: 'arriving' });
    if (land.pickups) out.push({ kind: 'land', id, state: 'mid errand' });
    if (land.npc) out.push({ kind: 'land', id, state: 'talking' });
    if (land.gate) out.push({ kind: 'land', id, state: 'way open' });
  }
  for (const id of Object.keys(d.STAGES)) {
    for (const state of ['waiting for the tap', 'fallen', 'arrived']) out.push({ kind: 'stage', id, state });
  }
  out.push({ kind: 'over' });
  return out;
});

const stage = await page.$('#stage');
const shots = [];
for (const shot of plan) {
  const label = await page.evaluate(async shot => {
    const d = window.__dreybird;
    const fresh = () => {
      const pr = d.active();
      pr.story = { at: 'glade', flags: [], flock: ['sky', 'ember'], lands: {} };
      pr.best = 0;
      if (!document.getElementById('map').hidden) d.closeMap(false);
      d.resetWorld();
    };
    const settle = () => d.frame(performance.now() + 4000);

    if (shot.kind === 'title') { fresh(); settle(); return 'title · first run'; }
    if (shot.kind === 'map') { fresh(); d.openMap(); settle(); return 'the map'; }

    if (shot.kind === 'land') {
      const land = d.LANDS[shot.id];
      fresh();
      d.enterLand(shot.id, true);
      const E = d.land();
      if (shot.state === 'mid errand') { E.got = E.got.map((_, i) => i === 0); E.t = 200; }
      if (shot.state === 'way open') { E.opened = true; E.t = 200; E.got = E.got.map(() => true); }
      if (shot.state === 'talking') {
        E.t = 200;
        d.bird.x = land.npc.x; d.bird.y = land.npc.y - 20;
        d.tapLand(0, 0);
      }
      settle();
      return shot.id + ' · ' + shot.state;
    }

    if (shot.kind === 'over') {
      fresh();
      d.startPlay(4242); d.G.score = 12;
      d.bird.y = d.GY; d.bird.vy = 20;
      for (let i = 0; i < 300 && d.G.state !== d.states.OVER; i++) d.tick();
      for (let i = 0; i < 40; i++) d.tick();
      settle();
      return 'free flight · game over';
    }

    const st = d.STAGES[shot.id];
    fresh();
    if (shot.state === 'arrived') { d.active().story.flock = []; d.active().owned = []; }
    d.enterLand(st.from, true);
    d.enterStage(st);
    if (shot.state !== 'waiting for the tap') d.press();
    if (shot.state === 'fallen') {
      for (let i = 0; i < 600 && !d.stage().failed; i++) { d.bird.y = d.GY; d.bird.vy = 20; d.tick(); }
      for (let i = 0; i < 40; i++) d.tick();
    }
    if (shot.state === 'arrived') {
      let guard = 0;
      while (!d.stage().won && guard++ < 20000) {
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0;
        d.tick();
      }
      for (let i = 0; i < 220; i++) d.tick();
    }
    settle();
    return shot.id + ' · ' + shot.state;
  }, shot).catch(e => { errors.push(String(e)); return shot.kind + ' · FAILED'; });

  shots.push({ label, png: (await stage.screenshot()).toString('base64') });
}

// Tile them, in the page, so the only dependency stays Playwright.
const sheet = await page.evaluate(async shots => {
  const TILE_W = 216, TILE_H = 384, CAP = 26, PAD = 10, COLS = 5;
  const rows = Math.ceil(shots.length / COLS);
  const c = document.createElement('canvas');
  c.width = COLS * (TILE_W + PAD) + PAD;
  c.height = rows * (TILE_H + CAP + PAD) + PAD;
  const g = c.getContext('2d');
  g.fillStyle = '#14161f';
  g.fillRect(0, 0, c.width, c.height);

  for (let i = 0; i < shots.length; i++) {
    const x = PAD + (i % COLS) * (TILE_W + PAD);
    const y = PAD + Math.floor(i / COLS) * (TILE_H + CAP + PAD);
    const im = new Image();
    await new Promise(done => { im.onload = done; im.onerror = done; im.src = 'data:image/png;base64,' + shots[i].png; });
    const scale = Math.min(TILE_W / im.naturalWidth, TILE_H / im.naturalHeight);
    const w = im.naturalWidth * scale, h = im.naturalHeight * scale;
    g.drawImage(im, x + (TILE_W - w) / 2, y + (TILE_H - h) / 2, w, h);
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.strokeRect(x + 0.5, y + 0.5, TILE_W - 1, TILE_H - 1);
    g.fillStyle = /FAILED/.test(shots[i].label) ? '#ff8a80' : '#cdd3e0';
    g.font = '14px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(shots[i].label, x + 2, y + TILE_H + CAP / 2, TILE_W - 4);
  }
  return c.toDataURL('image/png');
}, shots);

mkdirSync(HERE, { recursive: true });
writeFileSync(OUT, Buffer.from(sheet.split(',')[1], 'base64'));
console.log('wrote ' + OUT + '  (' + shots.length + ' screens)');
if (errors.length) {
  console.error('page errors while rendering:\n  ' + errors.join('\n  '));
  await browser.close();
  process.exit(1);            // a screen that throws is worth failing for
}
await browser.close();
