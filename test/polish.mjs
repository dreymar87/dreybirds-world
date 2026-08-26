// The polish pass: hit-stop, parallax depth, first-run guidance, and music.
// Most of this is felt rather than asserted, so these checks cover the
// parts that can go quietly wrong — a tutorial that never leaves, music
// that plays when you asked for silence, a hit-stop that never ends.
// Run with:  npm run test:polish
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
async function fresh(opts) {
  const context = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 } }, opts));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

// --- hit-stop -----------------------------------------------------------
{
  const { context, page } = await fresh();
  const stop = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(11); d.resumeRun();
    for (let i = 0; i < 20; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
    d.bird.y = 999;                          // hit the ground
    d.tick();
    const armed = d.G.hitStop;
    const frozenY = d.bird.y, frozenTicks = d.G.ticks;
    d.tick(); d.tick();
    const during = { y: d.bird.y, ticks: d.G.ticks };
    for (let i = 0; i < 20; i++) d.tick();
    return { armed, frozenY, frozenTicks, during, after: d.G.hitStop, state: d.G.state };
  });
  check('a collision freezes the world for a beat',
    stop.armed > 0 && stop.during.y === stop.frozenY && stop.during.ticks === stop.frozenTicks,
    JSON.stringify(stop));
  check('and the freeze always ends', stop.after === 0, 'hitStop=' + stop.after);
  await context.close();
}

// --- hit-stop must not exist under reduced motion -----------------------
{
  const { context, page } = await fresh({ reducedMotion: 'reduce' });
  const none = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(11); d.resumeRun();
    for (let i = 0; i < 10; i++) d.tick();
    d.bird.y = 999; d.tick();
    return d.G.hitStop;
  });
  check('reduced motion gets no freeze at all', none === 0, 'hitStop=' + none);
  await context.close();
}

// --- first-run guidance -------------------------------------------------
{
  const { context, page } = await fresh();
  const taught = await page.evaluate(async () => {
    const d = __dreybird;
    const before = d.active().taught;
    d.resetWorld(); d.startPlay(3); d.resumeRun();
    d.G.score = 4; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 600 && d.G.state !== d.states.OVER; i++) d.tick();
    await d.flush();
    return { before, after: d.active().taught };
  });
  check('the tutorial shows for a new player and never again after one run',
    taught.before === false && taught.after === true, JSON.stringify(taught));

  // It has to actually be drawn, not merely flagged.
  const drawn = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;
    const band = () => {
      d.frame(performance.now() + 1);
      return Array.from(g.getImageData(0, Math.round(336 * scale), cv.width, 1).data).join(',');
    };
    d.active().taught = false; d.resetWorld();
    const withHint = band();
    d.active().taught = true; d.resetWorld();
    const without = band();
    return { withHint, without };
  });
  // Compare full rows, but never print them — a passing check should be
  // one readable line, not a screenful of pixels.
  check('and it is really on the canvas, not just a flag',
    drawn.withHint !== drawn.without,
    'row differs: ' + (drawn.withHint.length !== drawn.without.length ? 'length' : 'content'));
  await context.close();
}

// --- music --------------------------------------------------------------
{
  const { context, page } = await fresh();
  const m = await page.evaluate(() => {
    const d = __dreybird;
    return { def: d.active().music, running: !!d.music.timer, on: d.music.on };
  });
  check('music is off unless asked for', m.def === false && !m.running && !m.on, JSON.stringify(m));

  const toggled = await page.evaluate(() => {
    const d = __dreybird;
    d.active().music = true;
    d.music.set(true);
    const started = !!d.music.timer;
    d.music.set(false);
    return { started, stopped: !d.music.timer };
  });
  check('turning it on starts a loop, and off stops it',
    toggled.started && toggled.stopped, JSON.stringify(toggled));

  const muted = await page.evaluate(() => {
    const d = __dreybird;
    d.active().music = true;
    d.music.set(true);
    const before = !!d.music.timer;
    // Muting the game must silence the music too, not just the effects.
    document.getElementById('btn-sound').click();
    const after = !!d.music.timer;
    document.getElementById('btn-sound').click();
    return { before, after };
  });
  check('muting the game silences the music too',
    muted.before && !muted.after, JSON.stringify(muted));
  await context.close();
}

// --- parallax: layers must move at different rates ----------------------
{
  const { context, page } = await fresh();
  const layers = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;
    const px = (x, y) => g.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
    const rowAt = y => g.getImageData(0, Math.round(y * scale), cv.width, 1).data;
    // READY scrolls the world with no pipes in it, so anything that changes
    // in these rows changed because a background layer moved.
    d.resetWorld();
    // Pin the phase. Left cycling, the palette drifts as the world ticks and
    // *every* row differs on colour alone — which is how the first version of
    // this check passed while a layer sat completely still.
    d.G.bg = 0;
    d.frame(performance.now() + 1);

    // Each probe has to sit where its layer actually varies. An earlier
    // version read y=404, inside the flat grass band — one colour edge to
    // edge, which can never differ however fast the ground scrolls.
    const FAR = 340;      // ridge silhouette and skyline, 0.11x and 0.25x
    const GROUND = 417;   // dirt notches, below GY so nothing else draws there
    const TUFT = 394;     // foreground tufts at 1.15x

    // The tufts are drawn over the skyline, so a raw row there moves even
    // when the tufts are frozen. Mask to the grass colour — read off the
    // solid band below the ground line, so it tracks whatever world is on —
    // and only tuft pixels remain.
    const tuftMask = () => {
      const grass = px(4, d.GY + 4);
      const r = rowAt(TUFT);
      let m = '';
      for (let i = 0; i < r.length; i += 4) {
        m += (r[i] === grass[0] && r[i + 1] === grass[1] && r[i + 2] === grass[2]) ? '1' : '0';
      }
      return m;
    };
    const raw = y => Array.from(rowAt(y)).join(',');

    const far1 = raw(FAR), ground1 = raw(GROUND), tuft1 = tuftMask();
    for (let i = 0; i < 40; i++) d.tick();
    d.frame(performance.now() + 2);
    return {
      farMoved: far1 !== raw(FAR),
      groundMoved: ground1 !== raw(GROUND),
      tuftsMoved: tuft1 !== tuftMask(),
    };
  });
  check('the ridge, the ground and the tufts each move as you fly',
    layers.farMoved && layers.groundMoved && layers.tuftsMoved, JSON.stringify(layers));
  await context.close();
}

// --- screenshots --------------------------------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh();
  await page.evaluate(() => { __dreybird.active().taught = false; __dreybird.resetWorld(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: HERE + 'shots/shot-tutorial.png' });

  await page.evaluate(() => {
    const d = __dreybird;
    d.active().taught = true;
    d.resetWorld(); d.startPlay(4242); d.resumeRun(); d.G.score = 12;
    for (let i = 0; i < 70; i++) { if (d.bird.y > 235) d.flap(); d.tick(); }
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: HERE + 'shots/shot-depth.png' });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
