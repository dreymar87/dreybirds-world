// A seed must fully determine a run. Everything downstream — the shared
// daily challenge, the ghost replay — is only honest if this holds.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/determinism.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const HERE = new URL('.', import.meta.url).pathname;
const PAGE = pathToFileURL(HERE + '../index.html').href;
const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (info ? '  [' + info + ']' : ''));
};

const browser = await chromium.launch();
const errors = [];
async function fresh() {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

// Plays a fixed script of flaps so the run depends on nothing but the seed.
const SCRIPTED = `(seed, flapEvery) => {
  const d = window.__dreybird;
  d.resetWorld(); d.startPlay(seed); if (d.resumeRun) d.resumeRun();
  const gaps = [], powers = [];
  for (let i = 0; i < 900 && d.G.state === d.states.PLAYING; i++) {
    if (i % flapEvery === 0) d.flap();
    d.tick();
    for (const p of d.pipes) if (gaps.indexOf(p.gap) < 0) gaps.push(p.gap);
    for (const q of d.powers) {
      const tag = Math.round(q.y) + ':' + q.kind;
      if (powers.indexOf(tag) < 0) powers.push(tag);
    }
  }
  return { seed: d.G.seed, score: d.G.score, ticks: d.G.runTicks, gaps: gaps, powers: powers };
}`;

// --- same seed, same run -----------------------------------------------
{
  const a = await fresh();
  const b = await fresh();
  const runA = await a.page.evaluate(([s, seed]) => eval('(' + s + ')')(seed, 11), [SCRIPTED, 12345]);
  const runB = await b.page.evaluate(([s, seed]) => eval('(' + s + ')')(seed, 11), [SCRIPTED, 12345]);
  check('the same seed reproduces the same run in a fresh browser context',
    JSON.stringify(runA) === JSON.stringify(runB),
    `A score=${runA.score} ticks=${runA.ticks} gaps=${runA.gaps.length} | B score=${runB.score} ticks=${runB.ticks}`);

  const runC = await a.page.evaluate(([s, seed]) => eval('(' + s + ')')(seed, 11), [SCRIPTED, 999]);
  check('a different seed produces a different run',
    JSON.stringify(runC.gaps) !== JSON.stringify(runA.gaps),
    `seed 12345 first gaps=${runA.gaps.slice(0, 3)} | seed 999 first gaps=${runC.gaps.slice(0, 3)}`);

  // The stream must not depend on how well the player is doing, or two
  // people sharing a daily seed would diverge the moment one scored.
  const pipesOnly = `(seed, flapEvery) => {
    const d = window.__dreybird;
    d.resetWorld(); d.startPlay(seed); if (d.resumeRun) d.resumeRun();
    const gaps = [];
    for (let i = 0; i < 900; i++) {
      if (i % flapEvery === 0) d.flap();
      if (d.G.state !== d.states.PLAYING) { d.G.state = d.states.PLAYING; d.bird.y = 200; d.bird.vy = 0; }
      d.tick();
      for (const p of d.pipes) if (gaps.indexOf(p.gap) < 0) gaps.push(p.gap);
    }
    return gaps;
  }`;
  const skilled = await a.page.evaluate(([s, seed]) => eval('(' + s + ')')(seed, 11), [pipesOnly, 4242]);
  const clumsy = await b.page.evaluate(([s, seed]) => eval('(' + s + ')')(seed, 40), [pipesOnly, 4242]);
  check('the pipe sequence does not depend on how the player plays',
    JSON.stringify(skilled) === JSON.stringify(clumsy),
    `skilled=${skilled.slice(0, 4)} clumsy=${clumsy.slice(0, 4)}`);

  await a.context.close();
  await b.context.close();
}

// --- cosmetic randomness stays free ------------------------------------
{
  const { context, page } = await fresh();
  const same = await page.evaluate(() => {
    const d = __dreybird;
    const shot = () => {
      d.resetWorld(); d.startPlay(777); if (d.resumeRun) d.resumeRun();
      for (let i = 0; i < 40; i++) { if (i % 11 === 0) d.flap(); d.tick(); }
      return d.G.score + ':' + Math.round(d.bird.y * 1000);
    };
    return [shot(), shot()];
  });
  check('replaying a seed lands the bird in exactly the same place',
    same[0] === same[1], same.join(' vs '));
  await context.close();
}

// --- every world offers a real cycle ------------------------------------
{
  const { context, page } = await fresh();
  const worlds = await page.evaluate(() => {
    const d = __dreybird;
    return d.WORLDS.map(w => ({
      id: w.id,
      phases: (w.phases || []).length || 4,          // meadow inherits the default 4
      names: (w.phaseNames || []).length
    }));
  });
  check('every world has at least three times of day',
    worlds.every(w => w.phases >= 3), JSON.stringify(worlds));
  check('and a name for each of them',
    worlds.every(w => w.names === w.phases), JSON.stringify(worlds));
  await context.close();
}

// --- holding versus cycling --------------------------------------------
{
  const { context, page } = await fresh();
  const sky = await page.evaluate(() => {
    const d = __dreybird;
    const at = cycle => { d.G.cycle = cycle; return JSON.stringify(d.phaseNow()); };
    d.setBackground('cycle');
    const cycling = [at(0), at(1750 * 2.2)];
    d.setBackground(0);
    const held = [at(0), at(1750 * 2.2)];
    return { cycling, held, saved: d.active().bg };
  });
  check('cycling changes the sky as you fly', sky.cycling[0] !== sky.cycling[1]);
  check('holding pins it regardless of distance flown', sky.held[0] === sky.held[1]);
  check('and the choice is stored on the profile', sky.saved === 0, 'bg=' + sky.saved);

  // setBackground enqueues the write; it does not wait for it. This check
  // is about the setting persisting, not about how fast the queue drains,
  // so wait for the write rather than racing the reload. On a fast runner
  // the reload won that race and turned the main deploy red.
  await page.evaluate(() => __dreybird.flush());
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const kept = await page.evaluate(() => ({ bg: __dreybird.active().bg, live: __dreybird.G.bg }));
  check('the background choice survives a reload', kept.bg === 0 && kept.live === 0, JSON.stringify(kept));

  // A world with fewer skies than the held index must not render nothing.
  const fallback = await page.evaluate(() => {
    const d = __dreybird;
    d.active().coins = 2000;
    d.setBackground(3);                       // meadow has four; neon has three
    d.buy(d.WORLDS.find(w => w.id === 'neon'));
    d.equip('world', 'neon');
    return { bg: d.G.bg, phase: JSON.stringify(d.phaseNow()).slice(0, 24) };
  });
  check('holding a sky the new world lacks falls back to cycling',
    fallback.bg === 'cycle', JSON.stringify(fallback));
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
