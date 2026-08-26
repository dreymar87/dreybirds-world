// Pipe formations and hazards. The check that matters most here is the
// unreachable-pipe sweep: a formation that generates a gap you cannot fly
// through would be invisible until a player hit one.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/dynamics.mjs
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
async function fresh(phone) {
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } : {});
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

// Flies an immortal bird so pipes keep spawning regardless of skill, and
// reports every pipe that ever existed plus the hazards that fired.
const SURVEY = `(seed, pipes) => {
  const d = window.__dreybird;
  d.resetWorld(); d.startPlay(seed); if (d.resumeRun) d.resumeRun();
  const seen = new Set(), out = [];
  const hazards = { mover: 0, gust: 0, fog: 0 };
  const patterns = [];
  let lastPattern = null, lastGust = null, lastFog = null;
  for (let i = 0; i < 400000 && out.length < pipes; i++) {
    // Truly immortal: parking the bird is not enough, a pipe can still
    // hit it, and once the state leaves PLAYING nothing spawns any more.
    d.G.state = d.states.PLAYING;
    d.G.slow = 0;                                  // slow-mo would skew distance per tick
    d.bird.y = 200; d.bird.vy = 0;
    d.tick();
    const r = d.run();
    if (r.pattern !== lastPattern) { patterns.push(r.pattern); lastPattern = r.pattern; }
    if (r.gust && r.gust.at !== lastGust) { hazards.gust++; lastGust = r.gust.at; }
    if (r.fog && r.fog.until !== lastFog) { hazards.fog++; lastFog = r.fog.until; }
    for (const p of d.pipes) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (p.amp) hazards.mover++;
      out.push({ base: p.base, h: p.h, amp: p.amp, idx: out.length });
    }
  }
  return { pipes: out, hazards, patterns, GY: d.GY, floor: d.GAP_FLOOR };
}`;

// --- catalogue integrity ------------------------------------------------
{
  const { context, page } = await fresh();
  const cat = await page.evaluate(() => {
    const d = __dreybird;
    const bad = [];
    const ids = [];
    for (const p of d.PATTERNS) {
      ids.push(p.id);
      if (!p.name) bad.push(p.id + ' has no name');
      if (!(p.weight > 0)) bad.push(p.id + ' has a non-positive weight');
      if (!Array.isArray(p.steps) || !p.steps.length) bad.push(p.id + ' has no steps');
      if (p.gapMul != null && !(p.gapMul > 0.7 && p.gapMul <= 1)) bad.push(p.id + ' gapMul out of range');
      for (const st of p.steps) {
        if (st !== null && Math.abs(st) > 60) bad.push(p.id + ' step ' + st + ' is too large to fly');
      }
    }
    return { bad, dupes: ids.filter((v, i) => ids.indexOf(v) !== i), count: ids.length };
  });
  check('every formation is well formed', cat.bad.length === 0, cat.bad.join(' | '));
  check('formation ids are unique', cat.dupes.length === 0, JSON.stringify(cat.dupes));
  check('there are several formations to draw from', cat.count >= 5, 'count=' + cat.count);
  await context.close();
}

// --- nothing unreachable, across many seeds -----------------------------
{
  const { context, page } = await fresh();
  const sweep = await page.evaluate(async survey => {
    const run = eval('(' + survey + ')');
    const problems = [];
    let total = 0, minTop = 1e9, minBot = 1e9, minH = 1e9, maxJump = 0;
    for (const seed of [1, 2, 3, 7, 11, 42, 1337, 90210, 555555, 8675309]) {
      const r = run(seed, 400);
      total += r.pipes.length;
      let prev = null;
      for (const p of r.pipes) {
        // Worst case: the mover at the top and bottom of its swing.
        const top = p.base - p.amp - p.h / 2;
        const bot = r.GY - (p.base + p.amp + p.h / 2);
        minTop = Math.min(minTop, top);
        minBot = Math.min(minBot, bot);
        minH = Math.min(minH, p.h);
        if (top < 2) problems.push('seed ' + seed + ' pipe ' + p.idx + ' ceiling ' + Math.round(top));
        if (bot < 2) problems.push('seed ' + seed + ' pipe ' + p.idx + ' floor ' + Math.round(bot));
        if (p.h < r.floor) problems.push('seed ' + seed + ' pipe ' + p.idx + ' gap ' + p.h);
        if (prev !== null) maxJump = Math.max(maxJump, Math.abs(p.base - prev));
        prev = p.base;
      }
    }
    return { total, problems: problems.slice(0, 5), minTop, minBot, minH, maxJump };
  }, SURVEY);
  check('no pipe is ever unreachable, across 4000 pipes on 10 seeds',
    sweep.problems.length === 0,
    `pipes=${sweep.total} minTop=${Math.round(sweep.minTop)} minFloor=${Math.round(sweep.minBot)} minGap=${sweep.minH}` +
    (sweep.problems.length ? ' | ' + sweep.problems.join(' ; ') : ''));
  check('and no gap centre jumps further than a bird can climb',
    sweep.maxJump <= 92, 'maxJump=' + Math.round(sweep.maxJump));
  await context.close();
}

// --- still deterministic -------------------------------------------------
{
  const a = await fresh();
  const b = await fresh();
  const runA = await a.page.evaluate(s => eval('(' + s + ')')(24680, 120), SURVEY);
  const runB = await b.page.evaluate(s => eval('(' + s + ')')(24680, 120), SURVEY);
  check('the same seed produces the identical formations and hazards',
    JSON.stringify(runA.pipes) === JSON.stringify(runB.pipes) &&
    JSON.stringify(runA.patterns) === JSON.stringify(runB.patterns),
    `patterns=${runA.patterns.slice(0, 5).join(',')} hazards=${JSON.stringify(runA.hazards)}`);

  const other = await a.page.evaluate(s => eval('(' + s + ')')(13579, 120), SURVEY);
  check('a different seed produces different formations',
    JSON.stringify(other.pipes) !== JSON.stringify(runA.pipes));

  // The whole point: skill must not change the world.
  const byPlay = `(seed, flapEvery) => {
    const d = window.__dreybird;
    d.resetWorld(); d.startPlay(seed); if (d.resumeRun) d.resumeRun();
    const seen = new Set(), out = [];
    // Run until a fixed number of PIPES, not a fixed number of ticks: a
    // player who grabs a slow-mo covers less ground per tick, so a tick
    // budget would compare different stretches of the same world.
    for (let i = 0; i < 60000 && out.length < 60; i++) {
      if (i % flapEvery === 0) d.flap();
      if (d.G.state !== d.states.PLAYING) { d.G.state = d.states.PLAYING; d.bird.y = 200; d.bird.vy = 0; }
      d.tick();
      for (const p of d.pipes) { if (!seen.has(p)) { seen.add(p); out.push(p.base + ':' + p.h + ':' + p.amp); } }
    }
    return out;
  }`;
  const skilled = await a.page.evaluate(s => eval('(' + s + ')')(4242, 11), byPlay);
  const clumsy = await b.page.evaluate(s => eval('(' + s + ')')(4242, 45), byPlay);
  check('formations do not depend on how well the player is doing',
    skilled.length === 60 && clumsy.length === 60 &&
    JSON.stringify(skilled) === JSON.stringify(clumsy),
    `skilled(${skilled.length})=${skilled.slice(0, 2)} clumsy(${clumsy.length})=${clumsy.slice(0, 2)}`);
  await a.context.close();
  await b.context.close();
}

// --- a gentle opening ----------------------------------------------------
{
  const { context, page } = await fresh();
  const opening = await page.evaluate(async survey => {
    const run = eval('(' + survey + ')');
    const d = __dreybird;
    let earliest = 1e9, allDrift = true;
    for (const seed of [5, 50, 500, 5000, 50000, 123, 999, 31337]) {
      const r = run(seed, 40);
      r.pipes.forEach((p, i) => { if (p.amp && i < earliest) earliest = i; });
      // The opening pipes must be plain drift at the full gap.
      if (r.pipes.length < d.CALM_PIPES) { allDrift = false; continue; }
      for (let i = 0; i < d.CALM_PIPES; i++) {
        if (r.pipes[i].h !== r.pipes[0].h) allDrift = false;
      }
    }
    return { earliest, allDrift, start: d.HAZARD_START };
  }, SURVEY);
  check('no hazard appears before the opening stretch is over',
    opening.earliest >= opening.start, `earliest mover at pipe ${opening.earliest}, gate ${opening.start}`);
  check('and the opening pipes are plain, full-width drift', opening.allDrift);
  await context.close();
}

// --- gusts push only while they blow ------------------------------------
{
  const { context, page } = await fresh();
  const gust = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(1); if (d.resumeRun) d.resumeRun();
    const g = d.G;
    const sample = () => { const before = d.bird.vy; d.bird.y = 200; d.tick(); return d.bird.vy - before; };
    g.gust = null;
    const plain = sample();                            // gravity alone
    g.gust = { at: g.ticks + 5, until: g.ticks + 40, force: 0.17 };
    const telegraphed = sample();                      // announced, not yet biting
    for (let i = 0; i < 6; i++) sample();
    const blowing = sample();                          // now it bites
    return { plain, telegraphed, blowing, gravity: g.gravity };
  });
  check('a gust does not push during its telegraph',
    Math.abs(gust.telegraphed - gust.plain) < 1e-9, JSON.stringify(gust));
  check('and does push once it arrives',
    gust.blowing > gust.plain + 0.1, JSON.stringify(gust));

  // The chevrons must point where the wind will take you. They pointed the
  // wrong way once, which is worse than showing nothing.
  const arrows = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;
    const col = Math.round(16 * scale);
    const mid = Math.round(136 * scale);
    const span = Math.round(9 * scale);

    // Compare the same column with and without a gust: whatever changed is
    // the chevron. Sampling absolute colours would just measure the sky.
    const column = () => {
      d.frame(performance.now() + 1);
      return g.getImageData(col, mid - span, 1, span * 2).data.slice();
    };
    const read = force => {
      d.resetWorld(); d.startPlay(1); if (d.resumeRun) d.resumeRun();
      d.G.gust = null;
      const base = column();
      d.G.gust = { at: d.G.ticks + 400, until: d.G.ticks + 500, force: force };
      const withGust = column();
      let above = 0, below = 0;
      for (let i = 0; i < span * 2; i++) {
        const o = i * 4;
        const changed = Math.abs(base[o] - withGust[o]) + Math.abs(base[o + 1] - withGust[o + 1]) +
                        Math.abs(base[o + 2] - withGust[o + 2]) > 24;
        if (changed) { if (i < span) above++; else below++; }
      }
      return { above, below };
    };
    return { up: read(-0.17), down: read(0.17) };
  });
  check('the chevrons point the way the wind will push',
    arrows.up.above > arrows.up.below && arrows.down.below > arrows.down.above,
    JSON.stringify(arrows));

  await context.close();
}

// --- assist takes the edge off ------------------------------------------
{
  const { context, page } = await fresh();
  const counts = await page.evaluate(async survey => {
    const run = eval('(' + survey + ')');
    const d = __dreybird;
    const tally = () => {
      let n = 0;
      for (const seed of [3, 33, 333, 3333, 33333, 7, 77, 777]) {
        const r = run(seed, 260);
        n += r.hazards.mover + r.hazards.gust + r.hazards.fog;
      }
      return n;
    };
    d.active().assist = false;
    const normal = tally();
    d.active().assist = true;
    const assisted = tally();
    d.active().assist = false;
    return { normal, assisted };
  }, SURVEY);
  check('assist mode roughly halves how often hazards fire',
    counts.assisted < counts.normal * 0.75 && counts.assisted > 0,
    `normal=${counts.normal} assisted=${counts.assisted}`);
  await context.close();
}

// --- still winnable ------------------------------------------------------
{
  const { context, page } = await fresh();
  const scores = await page.evaluate(() => {
    const d = __dreybird;
    const out = [];
    for (const seed of [101, 202, 303, 404, 505, 606]) {
      d.resetWorld(); d.startPlay(seed); if (d.resumeRun) d.resumeRun();
      for (let i = 0; i < 4000 && d.G.state === d.states.PLAYING; i++) {
        const p = d.pipes.find(p => p.x + d.PIPE_W > d.bird.x) || d.pipes[0];
        if (d.bird.y > p.gap + 18 && d.bird.vy > -1) d.flap();
        d.tick();
      }
      out.push(d.G.score);
    }
    return out;
  });
  check('a naive autopilot still clears pipes with hazards on',
    scores.filter(v => v >= 5).length >= 4 && Math.max(...scores) >= 12,
    'scores=' + JSON.stringify(scores));
  await context.close();
}

// --- screenshots ---------------------------------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh(true);
  const shot = async (name, setup) => {
    await page.evaluate(setup);
    await page.waitForTimeout(140);
    await page.screenshot({ path: HERE + 'shots/shot-' + name + '.png' });
  };
  await shot('gust', () => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(4242); d.resumeRun(); d.G.score = 21;
    for (let i = 0; i < 60; i++) { if (d.bird.y > 235) d.flap(); d.tick(); }
    d.G.gust = { at: d.G.ticks + 30, until: d.G.ticks + 120, force: -0.17 };
    for (let i = 0; i < 6; i++) { if (d.bird.y > 235) d.flap(); d.tick(); }
  });
  await shot('fog', () => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(90210); d.resumeRun(); d.G.score = 17;
    for (let i = 0; i < 70; i++) { if (d.bird.y > 235) d.flap(); d.tick(); }
    d.G.gust = null;
    d.G.fog = { until: d.G.ticks + 150, y: 150 };
    for (let i = 0; i < 4; i++) d.tick();
  });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
