// Checks the local profile system: storage backend, migration, isolation,
// durability, export/import, and the fallback when IndexedDB is blocked.
// Served over http because IndexedDB is unavailable on file:// origins —
// which is itself one of the things worth proving the game survives.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/profiles.mjs
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
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8'
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

// A fresh browser context each time, so no test inherits another's storage.
async function fresh(init) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  if (init) await page.addInitScript(init);
  await page.goto(ORIGIN);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

// --- the backend actually in use --------------------------------------
{
  const { context, page } = await fresh();
  const st = await page.evaluate(() => __dreybird.storage());
  check('uses IndexedDB when the origin allows it', st.backend === 'indexeddb', JSON.stringify(st));

  const first = await page.evaluate(() => __dreybird.profiles().map(p => p.name));
  check('creates one profile on a clean install', first.length === 1, JSON.stringify(first));
  await context.close();
}

// --- migration from the single-player build ---------------------------
{
  const { context, page } = await fresh(() => {
    localStorage.setItem('dreybird.best', '23');
    localStorage.setItem('dreybird.skin', '"ember"');
  });
  const p = await page.evaluate(() => __dreybird.active());
  check('carries the old localStorage best score into a profile',
    p.best === 23 && p.skin === 'ember', JSON.stringify({ best: p.best, skin: p.skin }));
  const equipped = await page.evaluate(() => __dreybird.G.skin.id);
  check('and equips the bird that best score had unlocked', equipped === 'ember', equipped);
  await context.close();
}

// --- two players do not bleed into each other -------------------------
{
  const { context, page } = await fresh();
  const out = await page.evaluate(async () => {
    const d = __dreybird;
    const play = score => {                    // finish a run worth `score`
      d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
      d.G.score = score; d.G.state = d.states.DYING; d.bird.y = 999;
      for (let i = 0; i < 400 && d.G.state !== d.states.OVER; i++) d.tick();
    };
    const a = d.active();
    play(12);
    const b = d.createProfile('Bee');
    play(4);
    return {
      names: d.profiles().map(p => p.name),
      aBest: d.profiles().find(p => p.id === a.id).best,
      bBest: d.profiles().find(p => p.id === b.id).best,
      shownBest: d.G.best,
      games: d.profiles().map(p => p.stats.games)
    };
  });
  check('each player keeps their own best score',
    out.aBest === 12 && out.bBest === 4 && out.shownBest === 4, JSON.stringify(out));
  check('and their own game count', JSON.stringify(out.games) === '[1,1]', JSON.stringify(out.games));

  const switched = await page.evaluate(() => {
    const d = __dreybird;
    const first = d.profiles()[0];
    d.switchProfile(first.id);
    return { active: d.active().name, best: d.G.best };
  });
  check('switching player swaps in their record', switched.best === 12, JSON.stringify(switched));
  await context.close();
}

// --- durability across a reload ---------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(ORIGIN);
  await page.waitForFunction(() => !!window.__dreybird);
  await page.evaluate(async () => {
    const d = __dreybird;
    d.createProfile('Kestrel');
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    d.G.score = 31; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 400 && d.G.state !== d.states.OVER; i++) d.tick();
    await d.flush();
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const after = await page.evaluate(() => ({
    names: __dreybird.profiles().map(p => p.name),
    active: __dreybird.active().name,
    best: __dreybird.active().best,
    pipes: __dreybird.active().stats.games
  }));
  check('profiles and the active player survive a reload',
    after.names.includes('Kestrel') && after.active === 'Kestrel' && after.best === 31,
    JSON.stringify(after));

  // A player who finishes a run and closes the tab a moment later gets no
  // chance to cooperate, so prove the write lands on its own too.
  await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    d.G.score = 44; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 400 && d.G.state !== d.states.OVER; i++) d.tick();
  });
  await page.waitForTimeout(250);                  // no flush() — just time
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const uncooperative = await page.evaluate(() => __dreybird.active().best);
  check('a run survives a reload with no explicit flush', uncooperative === 44, 'best=' + uncooperative);

  // ...and after the service worker takes over with the network gone.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dreybird);
  const offline = await page.evaluate(() => ({
    active: __dreybird.active().name, best: __dreybird.active().best
  }));
  check('and survive an offline reload', offline.active === 'Kestrel' && offline.best === 44, JSON.stringify(offline));
  await context.setOffline(false);
  await context.close();
}

// --- persistent-storage request, both answers -------------------------
{
  const { context, page } = await fresh(() => {
    window.__persistCalls = 0;
    if (navigator.storage) {
      navigator.storage.persisted = async () => false;
      navigator.storage.persist = async () => { window.__persistCalls++; return true; };
    }
  });
  await page.evaluate(() => __dreybird.openPlayers());
  await page.waitForTimeout(120);
  const granted = await page.evaluate(() => ({
    calls: window.__persistCalls,
    persisted: __dreybird.storage().persisted,
    note: document.getElementById('storage-note').textContent,
    warn: document.getElementById('storage-note').className.includes('warn')
  }));
  check('asks the browser for durable storage', granted.calls === 1, JSON.stringify({ calls: granted.calls }));
  check('reports a granted request honestly',
    granted.persisted === true && !granted.warn && /agreed not to clear/.test(granted.note), granted.note);
  await context.close();
}
{
  const { context, page } = await fresh(() => {
    if (navigator.storage) {
      navigator.storage.persisted = async () => false;
      navigator.storage.persist = async () => false;      // browser says no
    }
  });
  await page.evaluate(() => __dreybird.openPlayers());
  await page.waitForTimeout(120);
  const denied = await page.evaluate(() => ({
    persisted: __dreybird.storage().persisted,
    note: document.getElementById('storage-note').textContent,
    warn: document.getElementById('storage-note').className.includes('warn')
  }));
  check('warns plainly when the request is refused',
    denied.persisted === false && denied.warn && /may still clear/.test(denied.note), denied.note);
  await context.close();
}

// --- export / import ---------------------------------------------------
{
  const { context, page } = await fresh();
  const round = await page.evaluate(async () => {
    const d = __dreybird;
    const p = d.createProfile('Export Me');
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    d.G.score = 17; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 400 && d.G.state !== d.states.OVER; i++) d.tick();
    const save = d.exportSave();
    d.deleteProfile(p.id);
    const goneAfterDelete = !d.profiles().some(x => x.id === p.id);
    const res = d.importSave(save);
    const back = d.profiles().find(x => x.id === p.id);
    return { goneAfterDelete, res, back: back ? { name: back.name, best: back.best, games: back.stats.games } : null };
  });
  check('a deleted player comes back from an exported save',
    round.goneAfterDelete && round.back && round.back.name === 'Export Me' && round.back.best === 17,
    JSON.stringify(round));

  const merge = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    // Give the live profile a real record first, so the stale copy below
    // is genuinely worse and the merge has something to protect.
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    d.G.score = 26; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 400 && d.G.state !== d.states.OVER; i++) d.tick();
    const before = d.profiles().find(x => x.id === p.id).best;
    const save = d.exportSave();
    save.profiles = save.profiles.map(x => x.id === p.id ? { ...x, best: 1, stats: { ...x.stats, games: 0 } } : x);
    d.importSave(save);
    const after = d.profiles().find(x => x.id === p.id);
    return { before, after: after.best, games: after.stats.games };
  });
  check('importing an older save never lowers a best score or wipes stats',
    merge.after === merge.before && merge.after === 26 && merge.games >= 1, JSON.stringify(merge));

  // Coins and purchases must travel with the save, and a merge must never
  // repossess something already bought or hand back spent coins.
  const wallet = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.coins = 500;
    d.buy(d.HATS.find(h => h.id === 'crown'));
    d.buy(d.WORLDS.find(w => w.id === 'neon'));
    const rich = d.exportSave();

    // A stale backup: fewer coins, and one of the two items never bought.
    const stale = JSON.parse(JSON.stringify(rich));
    stale.profiles = stale.profiles.map(x =>
      x.id === p.id ? { ...x, coins: 5, owned: ['trail:spark'] } : x);
    d.importSave(stale);
    const after = d.profiles().find(x => x.id === p.id);
    return { coins: after.coins, owned: after.owned.slice().sort() };
  });
  check('a stale import keeps the higher balance and the union of purchases',
    wallet.coins === 500 - 110 - 260 &&
    wallet.owned.join() === 'hat:crown,trail:spark,world:neon', JSON.stringify(wallet));

  // Comfort settings travel with the save too.
  const comfort = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.haptics = true; p.assist = true; p.bg = 1;
    const save = d.exportSave();
    const round = JSON.parse(JSON.stringify(save)).profiles.find(x => x.id === p.id);
    return { haptics: round.haptics, assist: round.assist, bg: round.bg };
  });
  const prog = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.xp = d.xpForLevel(16);
    p.feathers = [];
    d.equip('feather', 'thrift');
    const rich = d.exportSave();
    const stale = JSON.parse(JSON.stringify(rich));
    stale.profiles = stale.profiles.map(x => x.id === p.id ? { ...x, xp: 1, feathers: [] } : x);
    d.importSave(stale);
    const after = d.profiles().find(x => x.id === p.id);
    return { xp: after.xp, level: d.levelFor(after.xp), feathers: after.feathers.slice() };
  });
  check('a stale import never lowers XP or strips an equipped perk',
    prog.level === 16 && prog.feathers.indexOf('thrift') >= 0, JSON.stringify(prog));

  check('haptics, assist and the background choice survive an export',
    comfort.haptics === true && comfort.assist === true && comfort.bg === 1,
    JSON.stringify(comfort));

  const junk = await page.evaluate(() => __dreybird.importSave({ hello: 'world' }));
  check('a file that is not a DreyBird save is refused', junk.ok === false, JSON.stringify(junk));
  await context.close();
}

// --- knowing whether the file on disk is current -----------------------
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(ORIGIN);
  await page.waitForFunction(() => !!window.__dreybird);

  const flow = await page.evaluate(async () => {
    const d = __dreybird;
    const never = d.saveState().state;
    const neverText = d.saveButtonText();

    d.markSaved(d.saveState().print);              // stands in for a real save
    const afterSave = d.saveState();
    const savedText = d.saveButtonText();

    d.resetWorld(); d.startPlay(5); if (d.resumeRun) d.resumeRun();
    d.G.score = 12; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 500 && d.G.state !== d.states.OVER; i++) d.tick();
    const afterRun = d.saveState();
    const staleText = d.saveButtonText();

    d.markSaved(d.saveState().print);
    const resaved = d.saveState().state;
    await d.flush();
    return { never, neverText, afterSave, savedText, afterRun, staleText, resaved };
  });
  check('a never-saved player says so', flow.never === 'never', flow.neverText);
  check('saving flips it to up to date',
    flow.afterSave.state === 'current' && /Saved/.test(flow.savedText), flow.savedText);
  check('a finished run makes it stale, and counts the runs',
    flow.afterRun.state === 'stale' && flow.afterRun.runs === 1 && /\(1\)/.test(flow.staleText),
    JSON.stringify({ state: flow.afterRun.state, runs: flow.afterRun.runs, text: flow.staleText }));
  check('saving again settles it', flow.resaved === 'current');

  // The badge is worthless if it cries wolf, so a reload with nothing
  // played must come back up to date.
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const survived = await page.evaluate(() => ({ state: __dreybird.saveState().state, text: __dreybird.saveButtonText() }));
  check('and a reload with nothing played is still up to date',
    survived.state === 'current', JSON.stringify(survived));

  const stable = await page.evaluate(() => {
    const d = __dreybird;
    const a = d.fingerprint(d.exportSave());
    const b = d.fingerprint(d.exportSave());
    d.active().coins += 1;
    const c = d.fingerprint(d.exportSave());
    return { a, b, c };
  });
  check('the fingerprint holds still for an identical save and moves when it changes',
    stable.a === stable.b && stable.a !== stable.c, JSON.stringify(stable));
  await context.close();
}

// --- IndexedDB blocked: the game must still run and still save ---------
{
  const { context, page } = await fresh(() => {
    Object.defineProperty(window, 'indexedDB', { get() { return undefined; } });
  });
  const st = await page.evaluate(() => __dreybird.storage());
  check('falls back to localStorage when IndexedDB is unavailable',
    st.backend === 'localstorage', JSON.stringify(st));

  await page.evaluate(async () => {
    const d = __dreybird;
    d.createProfile('Fallback');
    d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
    d.G.score = 8; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 400 && d.G.state !== d.states.OVER; i++) d.tick();
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const kept = await page.evaluate(() => ({ name: __dreybird.active().name, best: __dreybird.active().best }));
  check('and still saves through the fallback', kept.name === 'Fallback' && kept.best === 8, JSON.stringify(kept));
  await context.close();
}

// --- screenshots -------------------------------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh();
  await page.evaluate(async () => {
    const d = __dreybird;
    const run = score => {
      d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
      d.G.score = score; d.G.state = d.states.DYING; d.bird.y = 999;
      for (let i = 0; i < 400 && d.G.state !== d.states.OVER; i++) d.tick();
    };
    run(34);
    const b = d.createProfile('Marta');
    b.skin = 'ember'; d.switchProfile(b.id); run(21);
    const c = d.createProfile('Sam');
    c.skin = 'ghost'; d.switchProfile(c.id); run(7);
    d.switchProfile(d.profiles()[0].id);
    d.openPlayers();
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: HERE + 'shots/shot-players.png' });
  await page.evaluate(() => __dreybird.closePlayers());
  await page.waitForTimeout(150);
  await page.screenshot({ path: HERE + 'shots/shot-ready-player.png' });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
server.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
