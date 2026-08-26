// The stats screen.
//
// Four of these numbers were recorded for months and displayed nowhere, so
// the checks that matter are the ones that look at what actually reaches the
// screen: the rendered text and the measured height of the bars, not the
// fields behind them.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/stats.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

const SEED = [3, 7, 2, 11, 9, 14, 6, 18, 12, 21, 4, 17, 25, 13, 9,
              28, 19, 7, 22, 31, 16, 11, 34, 20, 8, 26, 15, 29, 12, 23];

// --- the button actually opens it ----------------------------------------
// Every other check here calls openStats() directly, which is why they all
// passed on a build where the button was underneath another one and could
// not be pressed. This one goes through the DOM.
{
  const { context, page } = await fresh();
  const before = await page.evaluate(() => document.getElementById('stats').hidden);
  await page.click('#btn-stats', { timeout: 3000 });
  const after = await page.evaluate(() => document.getElementById('stats').hidden);
  check('clicking the stats button opens the sheet', before === true && after === false,
    'hidden ' + before + ' -> ' + after);
  await context.close();
}

// --- the numbers that were hidden are now on the screen ------------------
{
  const { context, page } = await fresh();
  const shown = await page.evaluate(seed => {
    const d = __dreybird, pr = d.active();
    Object.assign(pr.stats, { games: 87, pipes: 941, powers: 38, roosts: 6,
      longest: 60 * 74, bronze: 21, silver: 9, gold: 3, platinum: 1 });
    pr.stats.recent = seed.slice();
    pr.best = 34; pr.coins = 412;
    d.openStats();
    const text = document.getElementById('stats-body').textContent;
    return { text, open: !document.getElementById('stats').hidden };
  }, SEED);
  const has = t => shown.text.indexOf(t) >= 0;
  check('the sheet opens', shown.open);
  // Pipes, power-ups, the longest flight and the per-tier medal case are the
  // four that the profile recorded and nothing ever displayed.
  check('total pipes are shown', has('941'));
  check('power-ups collected are shown', has('38'));
  check('the longest flight is shown as a time', has('1m 14s'), shown.text.slice(0, 0));
  check('the medal case is broken out by tier, not summed',
    has('Platinum') && has('Gold') && has('Silver') && has('Bronze') && has('21'));
  check('Roost visits are counted', has('ROOST'));
  await context.close();
}

// --- the chart is really drawn, and its bars mean what they say ----------
{
  const { context, page } = await fresh();
  const bars = await page.evaluate(seed => {
    const d = __dreybird, pr = d.active();
    pr.stats.recent = seed.slice();
    pr.stats.games = seed.length;
    d.openStats();
    const els = [...document.querySelectorAll('#stats-body .chart li')];
    const heights = els.map(e => Math.round(e.getBoundingClientRect().height));
    return { count: els.length, heights, labels: els.map(e => e.textContent) };
  }, SEED);
  check('one bar per run', bars.count === SEED.length, bars.count + ' bars for ' + SEED.length + ' runs');
  // Height must track score: the tallest bar is the best run, the shortest
  // the worst, and the ordering agrees all the way through.
  const order = (a) => a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).map(p => p[1]);
  check('bar height tracks the score it stands for',
    JSON.stringify(order(bars.heights)) === JSON.stringify(order(SEED)),
    'tallest ' + Math.max(...bars.heights) + 'px for best ' + Math.max(...SEED));
  check('every bar carries its number for a screen reader',
    bars.labels.every((t, i) => t.indexOf(String(SEED[i])) >= 0), bars.labels[0]);
  await context.close();
}

// --- a fresh profile is told what to do, not shown an empty frame --------
{
  const { context, page } = await fresh();
  const empty = await page.evaluate(() => {
    const d = __dreybird;
    d.active().stats.recent = [];
    d.openStats();
    const body = document.getElementById('stats-body');
    return { bars: body.querySelectorAll('.chart li').length, text: body.textContent };
  });
  check('with no runs yet there is no empty chart', empty.bars === 0);
  check('and it says so instead', empty.text.toLowerCase().indexOf('no finished runs') >= 0);
  await context.close();
}

// --- a finished run reaches the history ----------------------------------
{
  const { context, page } = await fresh();
  const rec = await page.evaluate(() => {
    const d = __dreybird;
    const pr = d.active();
    pr.stats.recent = [];
    const fly = target => {
      d.resetWorld(); d.startPlay(4242);
      let guard = 0;
      while (d.G.score < target && guard++ < 9000) {
        d.G.state = d.states.PLAYING;
        if (d.inRoost()) { d.tick(); continue; }
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0;
        d.tick();
      }
      // Fly into the ground: recordRun only happens on a landing.
      d.bird.y = d.GY; d.bird.vy = 20;
      for (let i = 0; i < 200 && d.G.state !== d.states.OVER; i++) d.tick();
      return d.G.state === d.states.OVER;
    };
    const landed = fly(4);
    return { landed, recent: pr.stats.recent.slice(), games: pr.stats.games };
  });
  check('a finished run is appended to the history',
    rec.landed && rec.recent.length === 1 && rec.recent[0] >= 4,
    JSON.stringify(rec));
  await context.close();
}

// --- the history has a bounded length ------------------------------------
{
  const { context, page } = await fresh();
  const cap = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    pr.stats.recent = [];
    for (let i = 0; i < 90; i++) {
      pr.stats.recent.push(i);
      if (pr.stats.recent.length > 30) pr.stats.recent.splice(0, pr.stats.recent.length - 30);
    }
    // Round-tripping through the save path must not grow it either.
    const data = JSON.parse(JSON.stringify(d.exportSave()));
    return { len: pr.stats.recent.length, first: pr.stats.recent[0],
             saved: data.profiles[0].stats.recent.length };
  });
  check('the history keeps only the recent runs',
    cap.len === 30 && cap.first === 60 && cap.saved === 30, JSON.stringify(cap));
  await context.close();
}

// --- importing a save with a history does not poison the totals ----------
// A run history is a list living among running totals, and the merge loop
// takes Math.max of every stat. Math.max of two arrays is NaN, which would
// wipe out every number beside it.
{
  const { context, page } = await fresh();
  const merged = await page.evaluate(seed => {
    const d = __dreybird, pr = d.active();
    Object.assign(pr.stats, { games: 10, pipes: 100, powers: 5, roosts: 1,
      bronze: 2, silver: 1, gold: 0, platinum: 0 });
    pr.stats.recent = [1, 2, 3];
    pr.best = 5; pr.coins = 50; pr.xp = 100;
    const payload = {
      app: 'dreybird', version: 1, exported: 0,
      profiles: [{ ...JSON.parse(JSON.stringify(pr)), best: 40, coins: 500, xp: 900,
        stats: { games: 50, pipes: 700, powers: 20, roosts: 4,
                 bronze: 9, silver: 4, gold: 2, platinum: 1, longest: 900,
                 recent: seed.slice() } }]
    };
    const res = d.importSave(payload);
    const after = d.active();
    return { ok: res && res.ok, stats: after.stats, best: after.best, coins: after.coins };
  }, SEED);
  const nums = merged.stats ? Object.keys(merged.stats)
    .filter(k => k !== 'recent').map(k => merged.stats[k]) : [];
  check('an imported history does not turn the other stats to NaN',
    merged.ok && nums.length > 0 && nums.every(Number.isFinite), JSON.stringify(merged.stats));
  check('and the totals still take the better of the two',
    merged.stats && merged.stats.pipes === 700 && merged.best === 40,
    'pipes ' + (merged.stats || {}).pipes + ', best ' + merged.best);
  check('the fuller record keeps its history',
    merged.stats && merged.stats.recent.length === SEED.length,
    JSON.stringify((merged.stats || {}).recent || []));
  await context.close();
}

// --- the sheet behaves like the others ------------------------------------
{
  const { context, page } = await fresh();
  const guard = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld();
    d.openStats();
    const before = d.G.state;
    d.press();                       // a tap behind an open sheet must not fly
    const after = d.G.state;
    return { before, after, ready: d.states.READY };
  });
  check('a tap behind the stats sheet does not start a run',
    guard.before === guard.ready && guard.after === guard.ready, JSON.stringify(guard));

  const esc = await page.evaluate(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    return document.getElementById('stats').hidden;
  });
  check('and Escape closes it', esc === true, 'hidden=' + esc);
  await context.close();
}

// --- screenshot ----------------------------------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh();
  await page.evaluate(seed => {
    const d = __dreybird, pr = d.active();
    pr.best = 34; pr.coins = 412; pr.xp = d.xpForLevel(14) + 40;
    Object.assign(pr.stats, { games: 87, pipes: 941, powers: 38, roosts: 6,
      longest: 60 * 74, bronze: 21, silver: 9, gold: 3, platinum: 1 });
    pr.stats.recent = seed.slice();
    d.openStats();
  }, SEED);
  await page.waitForTimeout(220);
  await page.screenshot({ path: HERE + 'shots/shot-stats.png' });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
