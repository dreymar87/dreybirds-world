// Headless checks for DreyBird. Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/smoke.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const PAGE = pathToFileURL(HERE + '../index.html').href;
const OUT = process.env.SHOT_DIR || HERE + 'shots';
const results = [];
const check = (name, ok, info = '') => { results.push([ok, name, info]); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (info ? '  [' + info + ']' : '')); };

mkdirSync(OUT, { recursive: true });

// --- every suite must actually run in CI --------------------------------
// run-all.mjs discovers suites from this directory, but the workflow
// hard-codes its matrix. A new suite therefore passes locally and never
// runs on a runner at all — which is precisely the hole the CI gate was
// added to close. This check is the only thing keeping the two in step.
{
  const root = HERE + '../';
  const yml = readFileSync(root + '.github/workflows/pages.yml', 'utf8');
  const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
  const matrix = ((yml.match(/^\s*suite:\s*\[(.*)\]\s*$/m) || [])[1] || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  const suites = readdirSync(HERE)                       // same exclusions as run-all.mjs
    .filter(f => f.endsWith('.mjs') && !['run-all.mjs', 'make-icons.mjs'].includes(f))
    .map(f => f.replace(/\.mjs$/, ''));
  const missing = suites.filter(x => !matrix.includes(x));
  const stale = matrix.filter(x => !suites.includes(x));
  const unscripted = suites.filter(x => !pkg.scripts || !pkg.scripts['test:' + x]);
  check('every suite in test/ is named in the CI matrix', missing.length === 0,
    missing.length ? 'never runs in CI: ' + missing.join(', ') : suites.length + ' suites');
  check('and the matrix names no suite that no longer exists', stale.length === 0, stale.join(', '));
  check('and every suite has the npm script the matrix calls', unscripted.length === 0, unscripted.join(', '));
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
const netFails = [];
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
page.on('requestfailed', r => netFails.push(r.url()));
await page.goto(PAGE);
await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 5000 });
await page.waitForTimeout(600);

check('loads with no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
check('only the Google Fonts request fails (offline sandbox)',
  netFails.every(u => /fonts\.(googleapis|gstatic)\.com/.test(u)), netFails.join(' | ').slice(0, 200));

// --- viewport fit: no page scroll, canvas inside the viewport --------
const fit = await page.evaluate(() => {
  const r = document.getElementById('game').getBoundingClientRect();
  return { hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
           vScroll: document.documentElement.scrollHeight > window.innerHeight + 1,
           w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
           bottom: Math.round(window.innerHeight - r.bottom) };
});
check('no page scrollbars at 390x844', !fit.hScroll && !fit.vScroll, JSON.stringify(fit));
check('canvas keeps 288:512 aspect', Math.abs(fit.w / fit.h - 288 / 512) < 0.01, `${fit.w}x${fit.h}`);

// --- this game does not share a cupboard with the other one -------------
// Both games are served from dreymar87.github.io, and IndexedDB and
// localStorage are scoped per ORIGIN, not per path. If these names ever
// agree with the classic game's, the two of them silently read and
// overwrite each other's profiles.
{
  const names = await page.evaluate(() => __dreybird.storage());
  const clash = [names.db, names.ls, names.vaultKey]
    .filter(n => n === 'dreybird' || n === 'dreybird.' || n === 'dreybird.vault');
  check('storage is named apart from the classic game', clash.length === 0,
    clash.length ? 'collides: ' + clash.join(', ')
                 : names.db + ' / ' + names.ls + ' / ' + names.vaultKey);
}

// --- the top bar: nothing sits on anything else ------------------------
// Adding a button and forgetting its position rule stacks it silently on a
// neighbour and eats that neighbour's taps. It looks fine in a screenshot of
// whatever the button opens, which is exactly how it got shipped once.
{
  const bar = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.iconbtn')]
      .filter(b => b.offsetParent !== null)
      .map(b => ({ id: b.id, r: b.getBoundingClientRect() }));
    const overlaps = [];
    for (let i = 0; i < btns.length; i++) {
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i].r, c = btns[j].r;
        if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) {
          overlaps.push(btns[i].id + ' over ' + btns[j].id);
        }
      }
    }
    // Present and correctly placed is not the same as reachable: whatever is
    // at a button's own centre has to be that button.
    const blocked = btns.filter(b => {
      const el = document.elementFromPoint(b.r.left + b.r.width / 2, b.r.top + b.r.height / 2);
      return !el || !(el.id === b.id || el.closest('.iconbtn') === document.getElementById(b.id));
    }).map(b => b.id);
    return { count: btns.length, overlaps, blocked };
  });
  check('no two controls in the top bar overlap', bar.overlaps.length === 0,
    bar.overlaps.join(', ') || bar.count + ' visible');
  check('and every one of them is reachable at its own centre',
    bar.blocked.length === 0, bar.blocked.join(', ') || 'all ' + bar.count);
}

// --- READY screen -----------------------------------------------------
check('starts in READY', await page.evaluate(() => __dreybird.G.state === 0));
await page.screenshot({ path: OUT + '/shot-ready.png' });

// A deterministic driver: feed the real frame() synthetic timestamps.
const drive = (ticks, hz = 60) => page.evaluate(([n, hz]) => {
  const step = 1000 / hz;
  let t = performance.now() + 1000;
  __dreybird.detach();
  __dreybird.frame(t);
  for (let i = 0; i < n; i++) { t += step; __dreybird.frame(t); }
}, [ticks, hz]);

// --- flap + play ------------------------------------------------------
await page.mouse.click(195, 500);
check('tap starts the game', await page.evaluate(() => __dreybird.G.state === 1));
const vyAfterFlap = await page.evaluate(() => __dreybird.bird.vy);
check('tap gives upward velocity', vyAfterFlap < 0, 'vy=' + vyAfterFlap.toFixed(2));

// --- refresh-rate independence: same sim after equal *time* ----------
const sample = async hz => page.evaluate(hz => {
  const d = __dreybird;
  d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun(); d.flap();
  const step = 1000 / hz;
  let t = performance.now() + 5000;
  d.detach(); d.frame(t);
  for (let i = 0; i < 3 * hz; i++) { t += step; d.frame(t); }   // 3 seconds
  return { y: d.bird.y, px: d.pipes[0].x };
}, hz);
const at60 = await sample(60);
const at120 = await sample(120);
check('physics identical at 60 vs 120 Hz',
  Math.abs(at60.y - at120.y) < 1.5 && Math.abs(at60.px - at120.px) < 1.5,
  `60Hz y=${at60.y.toFixed(1)} pipe=${at60.px.toFixed(1)} | 120Hz y=${at120.y.toFixed(1)} pipe=${at120.px.toFixed(1)}`);

// --- scoring & playability: 5 autopilot runs on fixed seeds ----------
// Seeded, so these are reproducible rather than statistical: the same seed
// must always produce the same score.
const runs = await page.evaluate(() => {
  const d = __dreybird;
  const out = [];
  const SEEDS = [101, 202, 303, 404, 505];
  for (let r = 0; r < 5; r++) {
    d.resetWorld(); d.startPlay(SEEDS[r]); if (d.resumeRun) d.resumeRun();
    const seen = [];
    for (let i = 0; i < 3000 && d.G.state === 1; i++) {
      // bang-bang autopilot: hold just under the gap centre of the pipe ahead
      const p = d.pipes.find(p => p.x + d.PIPE_W > d.bird.x) || d.pipes[0];
      if (d.bird.y > p.gap + 18 && d.bird.vy > -1) d.flap();
      d.tick();
      seen.push(d.G.score);
    }
    out.push({ seed: SEEDS[r], score: d.G.score, ok: seen.every((v, i) => i === 0 || v - seen[i - 1] === 0 || v - seen[i - 1] === 1) });
  }
  // Replay the same seeds: every score must come back identical.
  const replay = [];
  for (let r = 0; r < 5; r++) {
    d.resetWorld(); d.startPlay(SEEDS[r]); if (d.resumeRun) d.resumeRun();
    for (let i = 0; i < 3000 && d.G.state === 1; i++) {
      const p = d.pipes.find(p => p.x + d.PIPE_W > d.bird.x) || d.pipes[0];
      if (d.bird.y > p.gap + 18 && d.bird.vy > -1) d.flap();
      d.tick();
    }
    replay.push(d.G.score);
  }
  return { out, replay };
});
const scores = runs.out.map(r => r.score);
check('replaying the same seeds reproduces the same scores exactly',
  JSON.stringify(scores) === JSON.stringify(runs.replay),
  'first=' + JSON.stringify(scores) + ' replay=' + JSON.stringify(runs.replay));
check('a naive autopilot clears pipes on every seed',
  scores.every(v => v >= 3) && Math.max(...scores) >= 10, 'scores=' + JSON.stringify(scores));
check('score only ever increases by 1', runs.out.every(r => r.ok));

// --- collision ends the run -------------------------------------------
const crash = await page.evaluate(() => {
  const d = __dreybird;
  d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
  for (let i = 0; i < 600 && d.G.state === 1; i++) d.tick();   // no flapping: hit the ground
  const dying = d.G.state;
  for (let i = 0; i < 600 && d.G.state !== 3; i++) d.tick();
  return { dying, over: d.G.state === 3 };
});
check('falling ends the run and reaches GAME OVER', crash.dying === 2 && crash.over, JSON.stringify(crash));

// --- shield absorbs exactly one hit -----------------------------------
const shield = await page.evaluate(() => {
  const d = __dreybird;
  d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
  d.G.shield = 1;                        // a count now — Coal carries two
  const p = d.pipes[0];
  p.x = d.bird.x - 10;              // put the bird inside a pipe column
  p.gap = d.bird.y + 200;           // ...well above the gap
  d.tick();
  const survivedFirst = d.G.state === 1 && d.G.shield === 0;
  d.G.invuln = 0;
  const p2 = d.pipes.find(q => q.x + d.PIPE_W > d.bird.x - 20) || d.pipes[0];
  p2.x = d.bird.x - 10; p2.gap = d.bird.y + 200;
  d.tick();
  return { survivedFirst, diedSecond: d.G.state === 2 };
});
check('shield absorbs one hit, the next one kills', shield.survivedFirst && shield.diedSecond, JSON.stringify(shield));

// --- best score persists across a reload ------------------------------
await page.evaluate(() => { const d = __dreybird; d.resetWorld(); d.G.score = 23; d.G.state = 2; d.bird.y = 999; d.tick(); });
const bestBefore = await page.evaluate(() => __dreybird.G.best);
await page.reload();
await page.waitForFunction(() => !!window.__dreybird);
const bestAfter = await page.evaluate(() => __dreybird.G.best);
check('best score survives a reload', bestBefore === 23 && bestAfter === 23, `before=${bestBefore} after=${bestAfter}`);

// --- score-gated birds still follow the best score ---------------------
// The five original birds keep their thresholds; coin-priced birds are a
// separate axis and must not be counted here.
const unlocks = await page.evaluate(() => {
  const gated = __dreybird.SKINS.filter(s => s.need != null);
  const cards = [...document.querySelectorAll('#skin-list .card')];
  return {
    gated: gated.map(s => ({ name: s.name, need: s.need, open: __dreybird.available(s) })),
    rendered: cards.length
  };
});
check('score-gated birds unlock by best score (best=23 → 3 open, 2 locked)',
  unlocks.gated.filter(u => u.open).length === 3 &&
  unlocks.gated.filter(u => !u.open).length === 2, JSON.stringify(unlocks.gated));
check('the shop renders a card per bird', unlocks.rendered === 12, 'cards=' + unlocks.rendered);

// A renamed CSS class once left these cards completely unstyled in a
// shipped build, so assert they are actually wearing the stylesheet.
const styled = await page.evaluate(() => {
  const el = document.querySelector('#skin-list .card');
  const cs = getComputedStyle(el);
  return { display: cs.display, radius: cs.borderTopLeftRadius, colour: cs.color };
});
check('shop cards are styled, not default browser buttons',
  styled.display === 'flex' && styled.radius !== '0px', JSON.stringify(styled));

// --- screenshots of the real states -----------------------------------
await page.evaluate(() => {
  const d = __dreybird;
  d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
  d.G.score = 14; d.G.slow = d.PU_TICKS * 0.7; d.G.shield = 1;
  for (let i = 0; i < 40; i++) { if (d.bird.y > 240) d.flap(); d.tick(); }
});
await page.waitForTimeout(120);
await page.screenshot({ path: OUT + '/shot-playing.png' });

await page.evaluate(() => {
  const d = __dreybird;
  d.G.score = 23; d.G.state = 2; d.bird.y = 380;
  for (let i = 0; i < 200 && d.G.state !== 3; i++) d.tick();
  for (let i = 0; i < 40; i++) d.tick();
});
await page.waitForTimeout(120);
await page.screenshot({ path: OUT + '/shot-over.png' });

await page.click('#btn-skins');
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + '/shot-skins.png' });
await page.click('#sheet-close');

// night phase screenshot
await page.evaluate(() => {
  const d = __dreybird;
  d.resetWorld(); d.startPlay(); if (d.resumeRun) d.resumeRun();
  d.G.cycle = 1750 * 2.9; d.G.score = 31;
  for (let i = 0; i < 30; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
});
await page.waitForTimeout(120);
await page.screenshot({ path: OUT + '/shot-night.png' });

check('still no errors after the full run', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
const failed = results.filter(r => !r[0]).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
