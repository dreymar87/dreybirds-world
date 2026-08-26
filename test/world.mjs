// DreyBird's World — the lands.
//
// Two things here can only be judged by measuring: whether a line of speech
// actually fits the box it is drawn in, and what the steering actually does
// to the bird's velocity. Both are asserted against measurement rather than
// against the flags that are supposed to cause them.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/world.mjs
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
async function fresh(blockFont) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  if (blockFont) await context.route('**fonts.g**', r => r.abort());
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

// --- every line of speech fits the box it is drawn in --------------------
// Canvas does not wrap. Before this, a 52-character line ran off both edges
// of a 288px screen, because the text is centred and fillText simply draws.
for (const blockFont of [false, true]) {
  const { context, page } = await fresh(blockFont);
  const fit = await page.evaluate(() => {
    const d = __dreybird;
    const g = document.getElementById('game').getContext('2d');
    const max = d.speechWidth();

    /* The sandbox cannot reach the font host, so measureText here reports the
       fallback's metrics — about 40% narrower than Press Start 2P, which
       advances a full em per glyph. Measuring against whatever happens to be
       loaded made this check pass with wrapping switched off entirely, which
       is how a vacuous test looks from the inside.

       So: scale the width down by however much narrower the loaded font is,
       wrap against that, and the result is what the pixel font would do. On a
       machine that does have the font the scale is 1 and nothing changes. */
    g.font = '6px "Press Start 2P", ui-monospace, monospace';
    const scale = g.measureText('M').width / 6;      // 1.0 with the real font
    const asPixelFont = max * Math.min(1, scale);

    const over = [];
    let longest = 0, count = 0;
    for (const speech of Object.values(d.THISTLE)) {
      for (const line of speech) {
        for (const w of d.wrapLines(g, line, asPixelFont, 6)) {
          // Press Start 2P advances one em a glyph, so this is the width the
          // line would actually paint at, whatever is loaded right now.
          const width = w.length * 6;
          longest = Math.max(longest, width);
          count++;
          if (width > max) over.push(w);
        }
      }
    }
    return { over, longest, max: Math.round(max), count, scale: +scale.toFixed(2) };
  });
  const how = blockFont ? 'on the fallback typeface' : 'with the pixel font';
  check('no line of Thistle\'s runs past its box ' + how,
    fit.over.length === 0 && fit.count > 0,
    fit.over.length ? 'over: ' + JSON.stringify(fit.over)
                    : fit.count + ' lines, widest ' + fit.longest + ' of ' + fit.max +
                      ' (font scale ' + fit.scale + ')');
  await context.close();
}

// --- a word too long to break does not hang or overflow -------------------
{
  const { context, page } = await fresh();
  const brute = await page.evaluate(() => {
    const d = __dreybird;
    const g = document.getElementById('game').getContext('2d');
    const max = d.speechWidth();
    const started = Date.now();
    const lines = d.wrapLines(g, 'x'.repeat(400) + ' and then some words', max, 6);
    return { ms: Date.now() - started, lines: lines.length,
             widest: Math.round(Math.max(...lines.map(l => g.measureText(l).width))),
             max: Math.round(max) };
  });
  check('an unbreakable word is cut rather than looped over',
    brute.ms < 2000 && brute.widest <= brute.max && brute.lines > 1, JSON.stringify(brute));
  await context.close();
}

// --- nothing in a land can end the run ------------------------------------
{
  const { context, page } = await fresh();
  const safe = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.enterLand('glade');
    let died = false;
    // Driven hard into all four edges and held there.
    for (const [tx, ty] of [[0, 0], [d.W, 0], [d.W, d.GY], [0, d.GY], [144, d.GY]]) {
      d.holdAt(tx, ty);
      for (let i = 0; i < 200; i++) {
        d.tick();
        if (d.G.state === d.states.DYING || d.G.state === d.states.OVER) died = true;
      }
    }
    d.letGo();
    return { died, mode: d.G.mode, state: d.G.state,
             x: Math.round(d.bird.x), y: Math.round(d.bird.y) };
  });
  check('a land cannot kill you, however hard you fly at it',
    !safe.died && safe.mode === 'explore', JSON.stringify(safe));
  check('and the edges hold him inside the screen',
    safe.x >= 0 && safe.x <= 288 && safe.y >= 0 && safe.y <= 400, JSON.stringify(safe));
  await context.close();
}

// --- the steering does what the thumb says --------------------------------
{
  const { context, page } = await fresh();
  const steer = await page.evaluate(() => {
    const d = __dreybird;
    const at = (tx, ty, ticks) => {
      d.resetWorld(); d.enterLand('glade');
      d.bird.x = 144; d.bird.y = 240; d.bird.vx = 0; d.bird.vy = 0;
      if (tx === null) d.letGo(); else d.holdAt(tx, ty);
      for (let i = 0; i < ticks; i++) d.tick();
      const r = { x: +d.bird.x.toFixed(1), y: +d.bird.y.toFixed(1), vy: +d.bird.vy.toFixed(2) };
      d.letGo();
      return r;
    };
    return { released: at(null, 0, 50), above: at(144, 60, 50),
             below: at(144, 380, 50), right: at(270, 240, 50) };
  });
  check('released, he sinks', steer.released.y > 240 && steer.released.vy > 0,
    JSON.stringify(steer.released));
  check('held above, he climbs', steer.above.y < 240, JSON.stringify(steer.above));
  check('held below, he descends further and faster than a coast',
    steer.below.y > steer.released.y, JSON.stringify(steer.below));
  check('held aside, he crosses toward it', steer.right.x > 200, JSON.stringify(steer.right));
  await context.close();
}

// --- free mode is not disturbed by any of this ----------------------------
{
  const { context, page } = await fresh();
  const free = await page.evaluate(() => {
    const d = __dreybird;
    // Into a land and out again, then a plain run.
    d.resetWorld(); d.enterLand('glade');
    for (let i = 0; i < 60; i++) d.tick();
    d.resetWorld();
    const afterX = d.bird.x, mode = d.G.mode;
    d.startPlay(90210);
    const seq = [];
    let guard = 0;
    while (d.G.pipeIndex < 24 && guard++ < 24000) {
      d.G.state = d.states.PLAYING;
      if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
      d.bird.vy = 0;
      const before = d.G.pipeIndex;
      d.tick();
      if (d.G.pipeIndex > before) {
        const q = d.pipes[d.pipes.length - 1];
        seq.push([q.gap, q.h, q.amp]);
      }
    }
    return { afterX, mode, seq: JSON.stringify(seq), birdX: d.bird.x };
  });
  check('leaving a land restores the fixed-x bird the rest of the game assumes',
    free.afterX === 64 && free.mode === 'free' && free.birdX === 64,
    'x=' + free.afterX + ' mode=' + free.mode);
  // The same seed, generated after a visit to a land, must be the same world.
  const again = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(90210);
    const seq = [];
    let guard = 0;
    while (d.G.pipeIndex < 24 && guard++ < 24000) {
      d.G.state = d.states.PLAYING;
      if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
      d.bird.vy = 0;
      const before = d.G.pipeIndex;
      d.tick();
      if (d.G.pipeIndex > before) {
        const q = d.pipes[d.pipes.length - 1];
        seq.push([q.gap, q.h, q.amp]);
      }
    }
    return JSON.stringify(seq);
  });
  check('and a seed still builds the same world after a visit to one',
    free.seq === again && free.seq.length > 10, free.seq.slice(0, 60) + '…');
  await context.close();
}

// --- the errand, end to end ------------------------------------------------
{
  const { context, page } = await fresh();
  const errand = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.enterLand('glade');
    const L = () => d.land();
    const talk = () => { d.tapLand(0, 0); while (L().saying) d.tapLand(0, 0); };

    // Standing far away, a tap does nothing at all.
    d.bird.x = 250; d.bird.y = 100;
    d.tapLand(0, 0);
    const farAway = !!L().saying;

    // Beside him, a tap starts him talking.
    d.bird.x = d.GLADE.thistle.x; d.bird.y = d.GLADE.thistle.y - 20;
    d.tapLand(0, 0);
    const opened = !!L().saying;
    while (L().saying) d.tapLand(0, 0);
    const beforeSeeds = L().opened;

    // Fetch the three seeds by flying into them.
    for (const sd of d.GLADE.seeds) {
      d.bird.x = sd.x; d.bird.y = sd.y; d.bird.vx = 0; d.bird.vy = 0;
      d.tick();
    }
    const got = L().got.filter(Boolean).length;

    // And tell him.
    d.bird.x = d.GLADE.thistle.x; d.bird.y = d.GLADE.thistle.y - 20;
    talk();
    return { farAway, opened, beforeSeeds, got, afterSeeds: L().opened };
  });
  check('a tap out of earshot does not start a conversation', errand.farAway === false);
  check('a tap beside him does', errand.opened === true);
  check('all three seeds are found by flying into them', errand.got === 3, 'got ' + errand.got);
  check('the brambles are shut until the errand is done, and open after',
    errand.beforeSeeds === false && errand.afterSeeds === true,
    'before ' + errand.beforeSeeds + ' after ' + errand.afterSeeds);
  await context.close();
}

// --- screenshot: the longest line he has ----------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const d = __dreybird;
    d.active().taught = true;
    d.resetWorld(); d.enterLand('glade');
    // Inside the talk radius, or the taps below do nothing at all.
    d.bird.x = d.GLADE.thistle.x + 10; d.bird.y = d.GLADE.thistle.y - 20;
    // Straight to the longest thing he says.
    d.land().got = [true, true, true];
    d.tapLand(0, 0);
    d.tapLand(0, 0);
    for (let i = 0; i < 3; i++) d.tick();
  });
  await page.waitForTimeout(220);
  await page.screenshot({ path: HERE + 'shots/shot-glade-speech.png' });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
