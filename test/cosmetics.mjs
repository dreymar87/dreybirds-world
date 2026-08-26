// Checks the coin economy and the cosmetics shop: what you earn, what you
// can buy, what sticks, and whether any of it reaches the screen.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/cosmetics.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = normalize(HERE + '..');
const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (info ? '  [' + info + ']' : ''));
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8'
};
const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + server.address().port + '/';

const browser = await chromium.launch();
const errors = [];
async function fresh(init) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  if (init) await page.addInitScript(init);
  await page.goto(ORIGIN);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

// A run that ends with exactly `score` pipes cleared, driven through the
// real loop rather than by calling the award functions directly.
// Plays until `score` pipes are cleared, restarting on a crash. Power-ups
// are counted from the start of the *successful* attempt — the profile's
// running total also includes any collected in the attempts that failed.
const RUN = `(score) => {
  const d = window.__dreybird;
  let startPowers = 0, startCoins = 0;
  const begin = () => {
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    startPowers = d.active().stats.powers;
    startCoins = d.coins();
  };
  begin();
  for (let i = 0; i < 6000 && d.G.score < score; i++) {
    const p = d.pipes.find(p => p.x + d.PIPE_W > d.bird.x) || d.pipes[0];
    if (d.bird.y > p.gap + 18 && d.bird.vy > -1) d.flap();
    d.tick();
    if (d.G.state !== d.states.PLAYING) { begin(); i = 0; }
  }
  const powers = d.active().stats.powers - startPowers;
  d.G.state = d.states.DYING; d.bird.y = 999;
  for (let i = 0; i < 500 && d.G.state !== d.states.OVER; i++) d.tick();
  return { score: d.G.score, powers: powers, coins: d.coins() - startCoins };
}`;

// --- catalogue integrity ----------------------------------------------
{
  const { context, page } = await fresh();
  const cat = await page.evaluate(() => {
    const d = __dreybird;
    const lists = { bird: d.SKINS, hat: d.HATS, trail: d.TRAILS, world: d.WORLDS };
    const ids = [], bad = [];
    const GLYPHS = ['O', 'B', 'L', 'W', 'E', 'P', 'K', 'S'];
    for (const kind of Object.keys(lists)) {
      for (const item of lists[kind]) {
        ids.push(item.id);
        if (!item.name) bad.push(kind + ':' + item.id + ' no name');
        if (item.need == null && typeof item.cost !== 'number') bad.push(kind + ':' + item.id + ' no price');
        if (item.cost != null && item.cost < 0) bad.push(kind + ':' + item.id + ' negative price');
        if (kind === 'bird') {
          for (const g of GLYPHS) if (!item.p[g]) bad.push('bird:' + item.id + ' missing glyph ' + g);
          for (const g of Object.keys(item.p)) {
            if (!/^#[0-9a-f]{6}$/.test(item.p[g])) bad.push('bird:' + item.id + ' bad colour ' + g + '=' + item.p[g]);
          }
        }
        if (kind === 'hat' && item.art) {
          if (item.art.length !== 6) bad.push('hat:' + item.id + ' wrong row count');
          for (const row of item.art) if (row.length !== 11) bad.push('hat:' + item.id + ' wrong row width');
          for (const row of item.art) for (const ch of row) {
            if (ch !== '.' && !item.c[ch]) bad.push('hat:' + item.id + ' glyph ' + ch + ' has no colour');
          }
        }
        if (kind === 'world' && !item.pipes) bad.push('world:' + item.id + ' no pipe palette');
      }
    }
    const keys = [];
    for (const kind of Object.keys(lists)) {
      const seen = [];
      for (const item of lists[kind]) {
        if (seen.indexOf(item.id) >= 0) bad.push(kind + ':' + item.id + ' duplicate id within its list');
        seen.push(item.id);
        keys.push(kind + ':' + item.id);
        if (item.kind !== kind) bad.push(kind + ':' + item.id + ' is not stamped with its kind');
      }
    }
    const dupes = keys.filter((v, i) => keys.indexOf(v) !== i);
    return { count: ids.length, dupes, bad };
  });
  check('every ownership key is globally unique', cat.dupes.length === 0, JSON.stringify(cat.dupes));
  check('every item is well formed (art size, palette keys, prices)',
    cat.bad.length === 0, cat.bad.slice(0, 4).join(' | '));
  check('the catalogue is the expected size', cat.count === 12 + 7 + 6 + 5, 'items=' + cat.count);
  await context.close();
}

// --- earning -----------------------------------------------------------
{
  const { context, page } = await fresh();
  const earned = await page.evaluate(async run => {
    const d = window.__dreybird;
    const r = eval('(' + run + ')')(12);
    return { scored: r.score, powers: r.powers, coins: r.coins, runCoins: d.G.runCoins };
  }, RUN);
  // 1 coin a pipe, 2 a power-up, plus the medal bonus for a 12-pipe run.
  // Measured over the successful attempt only — a crashed attempt earns
  // coins too, and folding those in would make this assertion meaningless.
  const expected = earned.scored * 1 + earned.powers * 2 + 5;   // bronze at 10
  check('a run pays per pipe, per power-up and a medal bonus',
    earned.coins === expected, JSON.stringify({ ...earned, expected }));
  check('the run total shown on the game-over panel matches what was banked',
    earned.runCoins === earned.coins, JSON.stringify({ runCoins: earned.runCoins, banked: earned.coins }));
  await context.close();
}

// --- buying ------------------------------------------------------------
{
  const { context, page } = await fresh();
  const poor = await page.evaluate(() => {
    const d = __dreybird;
    const item = d.SKINS.find(s => s.id === 'gilded');       // 120 coins
    const before = d.coins();
    const ok = d.buy(item);
    return { before, ok, after: d.coins(), owns: d.owns(item) };
  });
  check('an unaffordable item is refused and costs nothing',
    poor.ok === false && poor.after === poor.before && !poor.owns, JSON.stringify(poor));

  const rich = await page.evaluate(() => {
    const d = __dreybird;
    d.active().coins = 500;
    const item = d.SKINS.find(s => s.id === 'gilded');
    const before = d.coins();
    const ok = d.buy(item);
    const afterFirst = d.coins();
    const twice = d.buy(item);                                // must be refused
    return { ok, spent: before - afterFirst, price: item.cost, twice, after: d.coins(), owns: d.owns(item) };
  });
  check('buying deducts exactly the price and grants the item',
    rich.ok && rich.spent === rich.price && rich.owns, JSON.stringify(rich));
  check('the same item cannot be bought twice',
    rich.twice === false && rich.after === 500 - rich.price,
    JSON.stringify({ twice: rich.twice, balance: rich.after, expected: 500 - rich.price }));
  await context.close();
}

// --- persistence -------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(ORIGIN);
  await page.waitForFunction(() => !!window.__dreybird);
  await page.evaluate(async () => {
    const d = __dreybird;
    d.active().coins = 900;
    d.buy(d.HATS.find(h => h.id === 'crown'));
    d.buy(d.TRAILS.find(t => t.id === 'rainbow'));
    d.buy(d.WORLDS.find(w => w.id === 'neon'));
    d.equip('hat', 'crown'); d.equip('trail', 'rainbow'); d.equip('world', 'neon');
    await d.flush();
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const kept = await page.evaluate(() => {
    const p = __dreybird.active();
    return { coins: p.coins, owned: p.owned.slice().sort(), hat: p.hat, trail: p.trail, world: p.world,
             liveHat: __dreybird.G.hat.id, liveWorld: __dreybird.G.world.id };
  });
  check('purchases and equipment survive a reload',
    kept.hat === 'crown' && kept.trail === 'rainbow' && kept.world === 'neon' &&
    kept.liveHat === 'crown' && kept.liveWorld === 'neon' &&
    kept.owned.join() === 'hat:crown,trail:rainbow,world:neon', JSON.stringify(kept));
  await context.close();
}

// --- back-pay for play from before the shop existed --------------------
{
  const { context, page } = await fresh(() => {
    // A profile in exactly the shape the previous release wrote.
    localStorage.setItem('dreybird.vault', JSON.stringify({
      activeId: 'old1',
      profiles: [{
        id: 'old1', name: 'Veteran', skin: 'ember', best: 31, created: 1,
        stats: { games: 9, pipes: 140, longest: 900, powers: 6, bronze: 2, silver: 3, gold: 1, platinum: 0 }
      }]
    }));
    Object.defineProperty(window, 'indexedDB', { get() { return undefined; } });
  });
  const granted = await page.evaluate(() => {
    const p = __dreybird.active();
    return { name: p.name, coins: p.coins, granted: p.granted, best: p.best };
  });
  // 140 pipes + 6 power-ups×2 + (2×5 + 3×15 + 1×30)
  const expected = 140 + 12 + (10 + 45 + 30);
  check('a profile from the previous release is paid for play already done',
    granted.coins === expected && granted.granted === true,
    JSON.stringify({ ...granted, expected }));

  await page.evaluate(() => __dreybird.flush());
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const again = await page.evaluate(() => __dreybird.active().coins);
  check('and is not paid a second time on the next load', again === expected, 'coins=' + again);
  await context.close();
}

// --- the cosmetics actually reach the screen ---------------------------
{
  const { context, page } = await fresh();
  const shot = async () => (await page.locator('#game').screenshot()).toString('base64');
  await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    for (let i = 0; i < 30; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
  });
  await page.waitForTimeout(120);
  const plain = await shot();

  await page.evaluate(() => {
    const d = __dreybird;
    d.active().coins = 2000;
    d.buy(d.HATS.find(h => h.id === 'crown'));
    d.buy(d.WORLDS.find(w => w.id === 'neon'));
    d.equip('hat', 'crown'); d.equip('world', 'neon');
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    for (let i = 0; i < 30; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
  });
  await page.waitForTimeout(120);
  const dressed = await shot();
  check('a hat and a world visibly change the frame', plain !== dressed,
    'identical=' + (plain === dressed));

  const trailOn = await page.evaluate(() => {
    const d = __dreybird;
    d.buy(d.TRAILS.find(t => t.id === 'rainbow'));
    d.equip('trail', 'rainbow');
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    for (let i = 0; i < 60; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
    return d.trailParticles().length;
  });
  check('an equipped trail emits particles', trailOn > 0, 'particles=' + trailOn);

  const cleared = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld();
    return d.trailParticles().length;
  });
  check('and the trail is cleared between runs', cleared === 0, 'left=' + cleared);
  await context.close();
}

// --- screenshots -------------------------------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.coins = 1400; p.best = 45;                       // show the score-gated ones open too
    d.G.best = 45;
    for (const id of ['mint', 'plum', 'candy', 'gilded']) d.buy(d.SKINS.find(s => s.id === id));
    for (const id of ['cap', 'crown', 'halo']) d.buy(d.HATS.find(h => h.id === id));
    for (const id of ['spark', 'rainbow']) d.buy(d.TRAILS.find(t => t.id === id));
    d.buy(d.WORLDS.find(w => w.id === 'neon'));
    d.equip('bird', 'gilded'); d.equip('hat', 'crown');
    d.equip('trail', 'rainbow'); d.equip('world', 'neon');
  });
  for (const kind of ['bird', 'hat', 'trail', 'world']) {
    await page.evaluate(k => { __dreybird.setTab(k); __dreybird.openPlayers(); __dreybird.closePlayers();
                               document.getElementById('sheet').hidden = false; }, kind);
    await page.waitForTimeout(180);
    await page.screenshot({ path: HERE + 'shots/shot-shop-' + kind + '.png' });
  }
  await page.evaluate(() => {
    document.getElementById('sheet').hidden = true;
    const d = __dreybird;
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun(); d.G.score = 18;
    for (let i = 0; i < 90; i++) { if (d.bird.y > 235) d.flap(); d.tick(); }
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: HERE + 'shots/shot-dressed.png' });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
server.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
