// Portal pipes and the Roost.
//
// The load-bearing checks are the two promises the mechanic makes: the pull
// can never be the thing that kills you, and going through is a choice you
// can decline. Both are asserted against behaviour — what the bird's
// velocity actually does, what the canvas actually shows — rather than
// against the flags that are supposed to cause them.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/portal.mjs
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

// --- a portal disturbs nothing about how the world is generated ----------
// The whole point of the second RNG stream. If this fails, every saved seed
// and every future daily challenge quietly comes to mean something else.
{
  const { context, page } = await fresh();
  const same = await page.evaluate(() => {
    const d = __dreybird;
    const run = force => {
      d.forcePortal(force);
      d.resetWorld(); d.startPlay(90210);
      const seq = [];
      let guard = 0;
      while (d.G.pipeIndex < 40 && guard++ < 40000) {
        d.G.state = d.states.PLAYING;
        if (d.inRoost()) { d.tick(); continue; }
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0;
        const before = d.G.pipeIndex;
        d.tick();
        if (d.G.pipeIndex > before) {
          const q = d.pipes[d.pipes.length - 1];
          seq.push([q.gap, q.h, q.amp]);
        }
      }
      return { seq, lastGap: d.G.lastGap, powers: d.powers.length };
    };
    const off = run(-1);
    const on = run(6);
    return { equal: JSON.stringify(off) === JSON.stringify(on), n: off.seq.length };
  });
  check('a portal does not disturb one pipe of the world around it',
    same.equal, same.n + ' pipes compared');
  await context.close();
}

// --- the pull can never be what kills you --------------------------------
{
  const { context, page } = await fresh();
  const pull = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    // The lightest the game can be made: assist, Bluebird, Updraft. If the
    // pull cannot hold this bird up, it cannot hold any of them up.
    pr.assist = true; pr.xp = d.xpForLevel(30); pr.feathers = ['lift'];
    d.equip('bird', 'sky');
    d.forcePortal(3); d.resetWorld(); d.startPlay(4242);
    let samples = 0, stalled = 0, minGain = 1e9, wrongWay = 0, both = 0;
    // Sampled from below the door on one pass and above it on the next, so
    // the pull is measured pushing each way.
    for (const side of [1, -1]) {
      d.forcePortal(3); d.resetWorld(); d.startPlay(4242);
      let sawSide = 0;
      for (let i = 0; i < 900 && !d.inRoost(); i++) {
        d.G.state = d.states.PLAYING;
        const pp = d.pipes.find(q => q.portal && !q.used);
        const pulling = pp && pp.x <= d.bird.x + d.PULL_RANGE && pp.x + d.PIPE_W > d.bird.x;
        // Inside the opening, as far from the door as the pipe allows.
        d.bird.y = pulling ? pp.gap + side * (pp.open / 2 - 12) : 200;
        d.bird.vy = 0;
        d.tick();
        // Skip ticks where the world froze or a neighbouring gust blew.
        if (pulling && d.G.hitStop === 0 && !d.G.gust) {
          samples++; sawSide++;
          /* Gravity runs before the pull in the same tick and the bird
             starts each sample at rest, so whatever is left after taking
             gravity out is the pull and nothing else. Below the door it
             must pull up; above it, down. */
          const contribution = d.bird.vy - d.physics().gravity;
          if (contribution * side > 1e-9) wrongWay++;
          if (side === 1) {
            // The refusability side: does the bird still sink regardless?
            minGain = Math.min(minGain, d.bird.vy);
            if (d.bird.vy <= 0) stalled++;
          }
        }
      }
      if (sawSide > 0) both++;
    }
    return { samples, stalled, wrongWay, both, minGain: +minGain.toFixed(4),
             gravity: +d.physics().gravity.toFixed(4), ceiling: +d.G.pullMax.toFixed(4) };
  });
  check('the pull is sampled where it is strongest', pull.samples > 20, pull.samples + ' ticks');
  check('doing nothing still sinks, at full pull on the lightest bird there is',
    pull.stalled === 0 && pull.minGain > 0,
    'worst gain ' + pull.minGain + ' = gravity ' + pull.gravity + ' - ceiling ' + pull.ceiling);
  check('and what the pull itself adds always points at the door',
    pull.both === 2 && pull.wrongWay === 0,
    pull.wrongWay + ' ticks pushed the wrong way, sides sampled ' + pull.both);
  await context.close();
}

// --- one flap beats everything the pull has gathered ----------------------
{
  const { context, page } = await fresh();
  const flap = await page.evaluate(() => {
    const d = __dreybird;
    d.forcePortal(3); d.resetWorld(); d.startPlay(4242);
    for (let i = 0; i < 900; i++) {
      d.G.state = d.states.PLAYING;
      const pp = d.pipes.find(q => q.portal && !q.used);
      if (pp && pp.x <= d.bird.x + 30 && pp.x + d.PIPE_W > d.bird.x) {
        d.bird.y = pp.gap + pp.open / 2 - 12;
        d.flap();
        return { vy: d.bird.vy, flapV: d.physics().flapV };
      }
      d.bird.y = 200; d.bird.vy = 0;
      d.tick();
    }
    return null;
  });
  check('a flap during the pull sets velocity outright, as it always does',
    !!flap && Math.abs(flap.vy - flap.flapV) < 1e-9, JSON.stringify(flap));
  await context.close();
}

// --- the portal is refusable ---------------------------------------------
{
  const { context, page } = await fresh();
  const refuse = await page.evaluate(() => {
    const d = __dreybird;
    d.forcePortal(3); d.resetWorld(); d.startPlay(4242);
    let passed = false;
    for (let i = 0; i < 1500; i++) {
      d.G.state = d.states.PLAYING;
      const pp = d.pipes.find(q => q.portal && !q.used);
      // Inside the opening but clear of the ring: the refusing line.
      if (pp) { d.bird.y = pp.gap + d.RING_R + 22; d.bird.vy = 0; }
      else if (d.pipes[0]) { d.bird.y = d.pipes[0].gap; d.bird.vy = 0; }
      d.tick();
      if (d.inRoost()) break;
      if (d.G.score >= 6) { passed = true; break; }
    }
    return { entered: d.inRoost(), passed, score: d.G.score };
  });
  check('flying clear of the door passes the pipe instead of entering',
    !refuse.entered && refuse.passed, JSON.stringify(refuse));
  await context.close();
}

// --- entering suspends the world rather than destroying it ---------------
{
  const { context, page } = await fresh();
  const visit = await page.evaluate(() => {
    const d = __dreybird;
    d.forcePortal(3); d.resetWorld(); d.startPlay(4242);
    d.active().coins = 0;
    let snap = null, ticks = 0, died = false;
    const shot = () => ({ pipes: d.pipes.map(q => [Math.round(q.x), q.gap, q.h, q.open]),
                          idx: d.G.pipeIndex, lastGap: d.G.lastGap, powers: d.powers.length,
                          score: d.G.score });
    for (let i = 0; i < 4000; i++) {
      d.G.state = d.states.PLAYING;
      if (!d.inRoost()) {
        const pp = d.pipes.find(q => q.portal && !q.used);
        if (pp) { d.bird.y += (pp.gap - d.bird.y) * 0.3; d.bird.vy = 0; }
        else if (d.pipes[0]) { d.bird.y = d.pipes[0].gap; d.bird.vy = 0; }
      } else {
        if (!snap) snap = shot();
        ticks++;
        d.bird.y = 4;          // parked against the ceiling: nothing may end the run
      }
      const wasIn = d.inRoost();
      d.tick();
      // Only the Roost is on trial here; the flight in is ordinary play and
      // is allowed to clip a pipe while steering for the door.
      if (wasIn && (d.G.state === d.states.DYING || d.G.state === d.states.OVER)) died = true;
      if (snap && !d.inRoost()) break;
    }
    return { snap, after: shot(), ticks, died, coins: d.active().coins, cap: d.ROOST_TICKS };
  });
  check('the world outside is exactly where it was left',
    JSON.stringify(visit.snap) === JSON.stringify(visit.after),
    'before ' + JSON.stringify(visit.snap) + ' / after ' + JSON.stringify(visit.after));
  check('nothing in the Roost can end the run', !visit.died, 'ticks ' + visit.ticks);
  check('and the visit always ends', visit.ticks > 0 && visit.ticks <= visit.cap + 2,
    visit.ticks + ' / cap ' + visit.cap);
  await context.close();
}

// --- Roost coins are real coins ------------------------------------------
{
  const { context, page } = await fresh();
  const pay = await page.evaluate(() => {
    const d = __dreybird;
    const run = bird => {
      const pr = d.active();
      pr.xp = d.xpForLevel(60); pr.feathers = [];
      d.equip('bird', bird);
      d.forcePortal(3); d.resetWorld(); d.startPlay(4242);
      pr.coins = 0;
      let entered = false, scoreIn = 0, scoreOut = 0;
      for (let i = 0; i < 4000; i++) {
        d.G.state = d.states.PLAYING;
        if (!d.inRoost()) {
          const pp = d.pipes.find(q => q.portal && !q.used);
          if (pp) { d.bird.y += (pp.gap - d.bird.y) * 0.3; d.bird.vy = 0; }
          else if (d.pipes[0]) { d.bird.y = d.pipes[0].gap; d.bird.vy = 0; }
        } else {
          if (!entered) { entered = true; scoreIn = d.G.score; }
          const next = d.roostCoins().find(c => !c.got);
          if (next) { d.bird.y = next.y; d.bird.vy = 0; }
        }
        d.tick();
        if (entered && !d.inRoost()) { scoreOut = d.G.score; break; }
      }
      return { coins: pr.coins, entered, scoreIn, scoreOut };
    };
    return { classic: run('classic'), gilded: run('gilded') };
  });
  check('the Roost pays out', pay.classic.entered && pay.classic.coins > 0,
    JSON.stringify(pay.classic));
  check('score does not move while you are in there',
    pay.classic.scoreIn === pay.classic.scoreOut,
    pay.classic.scoreIn + ' -> ' + pay.classic.scoreOut);
  check('and it pays through the coin multiplier like everything else',
    pay.gilded.coins > pay.classic.coins,
    'gilded ' + pay.gilded.coins + ' vs classic ' + pay.classic.coins);
  await context.close();
}

// --- the door is announced, and the announcement is really drawn ---------
{
  const { context, page } = await fresh();
  const seen = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;
    const fly = force => {
      d.forcePortal(force); d.resetWorld(); d.startPlay(4242);
      d.G.bg = 0;                       // pin the palette; it drifts otherwise
      for (let i = 0; i < 260; i++) {
        d.G.state = d.states.PLAYING;
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0;
        d.tick();
      }
      d.frame(performance.now() + 1);
      return Array.from(g.getImageData(0, Math.round(126 * scale), cv.width, 1).data).join(',');
    };
    const without = fly(-1);
    const with_ = fly(3);
    return { differs: without !== with_ };
  });
  check('the telegraph is on the canvas, not just in a variable', seen.differs);
  await context.close();
}

// --- rarity and gating ----------------------------------------------------
{
  const { context, page } = await fresh();
  const rate = await page.evaluate(() => {
    const d = __dreybird;
    let earliest = 1e9, multi = 0, runs = 0, withPortal = 0;
    for (let seed = 1; seed <= 60; seed++) {
      d.forcePortal(-1); d.resetWorld(); d.startPlay(seed);
      let guard = 0, count = 0;
      const seenPipes = new Set();
      while (d.G.pipeIndex < 60 && guard++ < 12000) {
        d.G.state = d.states.PLAYING;
        if (d.inRoost()) { d.tick(); continue; }
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0;
        for (const q of d.pipes) if (q.portal && !seenPipes.has(q)) { seenPipes.add(q); count++; }
        d.tick();
      }
      runs++;
      if (count > 0) withPortal++;
      if (count > 1) multi++;
      if (d.G.portalAt != null) earliest = Math.min(earliest, d.G.portalAt);
    }
    return { runs, withPortal, multi, earliest, gate: d.PORTAL_START };
  });
  check('never more than one portal in a run', rate.multi === 0, rate.multi + ' runs had two');
  check('and never before the gate', rate.earliest >= rate.gate,
    'earliest pipe ' + rate.earliest + ', gate ' + rate.gate);
  check('a portal stays an event rather than a fixture',
    rate.withPortal > 0 && rate.withPortal < rate.runs,
    rate.withPortal + ' of ' + rate.runs + ' runs reaching pipe 60');
  await context.close();
}

// --- the opening always fits on the screen -------------------------------
{
  const { context, page } = await fresh();
  const fit = await page.evaluate(() => {
    const d = __dreybird;
    let worstTop = 1e9, worstBot = 1e9, seen = 0, narrower = 0;
    for (let seed = 1; seed <= 40; seed++) {
      d.forcePortal(-1); d.resetWorld(); d.startPlay(seed);
      let guard = 0;
      while (d.G.pipeIndex < 60 && guard++ < 12000) {
        d.G.state = d.states.PLAYING;
        if (d.inRoost()) { d.tick(); continue; }
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0;
        for (const q of d.pipes) if (q.portal) {
          seen++;
          if (q.open < q.h) narrower++;
          worstTop = Math.min(worstTop, q.base - q.amp - q.open / 2);
          worstBot = Math.min(worstBot, d.GY - (q.base + q.amp + q.open / 2));
        }
        d.tick();
      }
    }
    return { seen, narrower, worstTop: Math.round(worstTop), worstBot: Math.round(worstBot) };
  });
  check('a portal opening never runs off the top or the bottom',
    fit.seen > 0 && fit.worstTop >= 2 && fit.worstBot >= 2, JSON.stringify(fit));
  check('and is never narrower than the pipe would have been',
    fit.narrower === 0, fit.narrower + ' were narrower');
  await context.close();
}

// --- screenshots ---------------------------------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const d = __dreybird;
    d.active().taught = true;
    d.forcePortal(3); d.resetWorld(); d.startPlay(4242);
    for (let i = 0; i < 400; i++) {
      d.G.state = d.states.PLAYING;
      const pp = d.pipes.find(q => q.portal && !q.used);
      if (pp && pp.x < 200) break;
      if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
      d.bird.vy = 0;
      d.tick();
    }
  });
  await page.waitForTimeout(160);
  await page.screenshot({ path: HERE + 'shots/shot-portal.png' });

  await page.evaluate(() => {
    const d = __dreybird;
    for (let i = 0; i < 2000 && !d.inRoost(); i++) {
      d.G.state = d.states.PLAYING;
      const pp = d.pipes.find(q => q.portal && !q.used);
      if (pp) { d.bird.y += (pp.gap - d.bird.y) * 0.3; d.bird.vy = 0; }
      d.tick();
    }
    for (let i = 0; i < 110; i++) {
      const next = d.roostCoins().find(c => !c.got);
      if (next) { d.bird.y = next.y; d.bird.vy = 0; }
      d.tick();
    }
  });
  await page.waitForTimeout(160);
  await page.screenshot({ path: HERE + 'shots/shot-roost.png' });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
