// Haptics, pause and assist mode — the things you feel rather than see.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/comfort.mjs
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
async function fresh(init) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  if (init) await page.addInitScript(init);
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

// --- assist changes the physics, and only when it is on -----------------
{
  const { context, page } = await fresh();
  const phys = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(1); d.resumeRun();
    const normal = d.physics();
    d.active().assist = true;
    d.resetWorld(); d.startPlay(1); d.resumeRun();
    const assisted = d.physics();
    d.active().assist = false;
    d.resetWorld(); d.startPlay(1); d.resumeRun();
    return { normal, assisted, back: d.physics() };
  });
  check('assist mode softens gravity, flap, gap and speed',
    phys.assisted.gravity < phys.normal.gravity &&
    phys.assisted.gap > phys.normal.gap &&
    phys.assisted.speed < phys.normal.speed &&
    Math.abs(phys.assisted.flapV) < Math.abs(phys.normal.flapV),
    JSON.stringify(phys.assisted));
  check('and turning it off restores the original feel exactly',
    JSON.stringify(phys.back) === JSON.stringify(phys.normal), JSON.stringify(phys.back));
  await context.close();
}

// --- assist earns coins but sets no record -----------------------------
{
  const { context, page } = await fresh();
  const honesty = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    const finish = score => {
      d.resetWorld(); d.startPlay(7); d.resumeRun();
      d.G.score = score; d.G.state = d.states.DYING; d.bird.y = 999;
      for (let i = 0; i < 500 && d.G.state !== d.states.OVER; i++) d.tick();
    };

    p.assist = true;
    const coinsBefore = d.coins();
    finish(40);
    const afterAssist = { best: p.best, coins: d.coins() - coinsBefore, flagged: d.physics().assist };

    p.assist = false;
    finish(31);
    return { afterAssist, normalBest: p.best };
  });
  check('an assist run pays coins but does not set a best score',
    honesty.afterAssist.best === 0 && honesty.afterAssist.coins > 0 && honesty.afterAssist.flagged,
    JSON.stringify(honesty.afterAssist));
  check('the same player without assist does set one',
    honesty.normalBest === 31, 'best=' + honesty.normalBest);

  // Physics are fixed at startPlay, so a mid-run toggle changes nothing.
  const midRun = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.assist = false;
    d.resetWorld(); d.startPlay(7); d.resumeRun();
    const started = d.physics().gap;
    p.assist = true;                       // flipped after the run began
    const during = d.physics().gap;
    d.G.score = 55; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 500 && d.G.state !== d.states.OVER; i++) d.tick();
    p.assist = false;
    return { started, during, best: p.best };
  });
  check('toggling assist mid-run cannot change that run or launder its score',
    midRun.started === midRun.during && midRun.best === 55, JSON.stringify(midRun));
  await context.close();
}

// --- the refactor did not disturb determinism --------------------------
{
  const { context, page } = await fresh();
  const seeded = await page.evaluate(() => {
    const d = __dreybird;
    const run = () => {
      d.resetWorld(); d.startPlay(31337); d.resumeRun();
      for (let i = 0; i < 600 && d.G.state === d.states.PLAYING; i++) {
        const p = d.pipes.find(p => p.x + d.PIPE_W > d.bird.x) || d.pipes[0];
        if (d.bird.y > p.gap + 18 && d.bird.vy > -1) d.flap();
        d.tick();
      }
      return d.G.score + ':' + Math.round(d.bird.y * 100);
    };
    return [run(), run()];
  });
  check('a seeded run still reproduces exactly after the physics refactor',
    seeded[0] === seeded[1], seeded.join(' vs '));
  await context.close();
}

// --- pause -------------------------------------------------------------
{
  const { context, page } = await fresh();
  const paused = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(99); d.resumeRun();
    // Fly, don't fall: pauseRun only applies to a run still in progress.
    for (let i = 0; i < 30; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
    const before = { ticks: d.G.ticks, y: d.bird.y, x: d.pipes[0].x, alive: d.G.state === d.states.PLAYING };
    d.pauseRun();
    for (let i = 0; i < 120; i++) d.tick();          // the world must not move
    const during = { ticks: d.G.ticks, y: d.bird.y, x: d.pipes[0].x, isPaused: d.paused() };
    d.resumeRun();
    for (let i = 0; i < 10; i++) d.tick();
    return { before, during, after: d.G.ticks, resumed: !d.paused() };
  });
  check('pausing freezes the world completely',
    paused.before.alive &&
    paused.before.ticks === paused.during.ticks &&
    paused.before.y === paused.during.y &&
    paused.before.x === paused.during.x &&
    paused.during.isPaused, JSON.stringify({ before: paused.before, during: paused.during }));
  check('and resuming carries the run on', paused.resumed && paused.after > paused.before.ticks,
    'ticks ' + paused.before.ticks + ' → ' + paused.after);

  const noFlap = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(99); d.resumeRun();
    for (let i = 0; i < 20; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
    d.pauseRun();
    const wasPaused = d.paused();                     // or the check proves nothing
    const vy = d.bird.vy;
    d.press();                                        // a tap on a paused screen
    const after = d.bird.vy;
    d.resumeRun();
    return { wasPaused, vy, after };
  });
  check('a tap while paused does not flap',
    noFlap.wasPaused && noFlap.vy === noFlap.after, JSON.stringify(noFlap));

  const ended = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(99); d.resumeRun();
    for (let i = 0; i < 20; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
    d.pauseRun();
    d.endRun();
    return { state: d.G.state, isPaused: d.paused() };
  });
  check('End run returns to the title screen and clears the pause',
    ended.state === 0 && !ended.isPaused, JSON.stringify(ended));
  await context.close();
}

// --- leaving the tab must not cost the run ------------------------------
{
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(5); d.resumeRun();
    for (let i = 0; i < 20; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
  });
  // Drive the real handler the way a backgrounded tab would.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    // visibilitychange is listened for on window, and a plain Event does
    // not bubble there by default.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  const hidden = await page.evaluate(() => __dreybird.paused());
  check('hiding the tab pauses the run instead of letting it die', hidden === true, 'paused=' + hidden);
  await context.close();
}

// --- haptics ------------------------------------------------------------
{
  const { context, page } = await fresh(() => {
    window.__buzzes = [];
    navigator.vibrate = p => { window.__buzzes.push(p); return true; };
  });
  const off = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(3); d.resumeRun();
    for (let i = 0; i < 5; i++) d.flap();
    return window.__buzzes.length;
  });
  check('haptics stay silent while the setting is off', off === 0, 'buzzes=' + off);

  const on = await page.evaluate(() => {
    const d = __dreybird;
    d.active().haptics = true;
    window.__buzzes = [];
    for (let i = 0; i < 5; i++) d.flap();
    return window.__buzzes.slice();
  });
  check('and buzz on every flap once enabled', on.length === 5, JSON.stringify(on));
  await context.close();
}
{
  // A vibrate that throws, and a browser with none at all, must both play.
  const { context, page } = await fresh(() => {
    navigator.vibrate = () => { throw new Error('blocked outside a gesture'); };
  });
  const survived = await page.evaluate(() => {
    const d = __dreybird;
    d.active().haptics = true;
    d.resetWorld(); d.startPlay(3); d.resumeRun();
    for (let i = 0; i < 40; i++) { if (i % 9 === 0) d.flap(); d.tick(); }
    return d.G.ticks;
  });
  check('a vibrate that throws cannot break a run', survived === 40, 'ticks=' + survived);
  await context.close();
}
{
  const { context, page } = await fresh(() => {
    try { delete navigator.vibrate; } catch (e) { /* ignore */ }
    Object.defineProperty(navigator, 'vibrate', { get: () => undefined, configurable: true });
  });
  const noSupport = await page.evaluate(() => {
    const d = __dreybird;
    d.active().haptics = true;
    d.resetWorld(); d.startPlay(3); d.resumeRun();
    for (let i = 0; i < 30; i++) { if (i % 9 === 0) d.flap(); d.tick(); }
    return d.G.ticks;
  });
  check('a browser without vibration still plays', noSupport === 30, 'ticks=' + noSupport);
  await context.close();
}

// --- screenshots --------------------------------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(4242); d.resumeRun(); d.G.score = 14;
    for (let i = 0; i < 60; i++) { if (d.bird.y > 235) d.flap(); d.tick(); }
    d.pauseRun();
  });
  await page.waitForTimeout(180);
  await page.screenshot({ path: HERE + 'shots/shot-paused.png' });

  await page.evaluate(() => {
    const d = __dreybird;
    d.resumeRun(); d.endRun();
    d.active().assist = true;
    d.resetWorld(); d.startPlay(7); d.resumeRun();
    d.G.score = 26; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 500 && d.G.state !== d.states.OVER; i++) d.tick();
    for (let i = 0; i < 30; i++) d.tick();
  });
  await page.waitForTimeout(180);
  await page.screenshot({ path: HERE + 'shots/shot-assist-over.png' });

  await page.evaluate(() => __dreybird.openSettings());
  await page.waitForTimeout(200);
  await page.screenshot({ path: HERE + 'shots/shot-settings-full.png' });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
