// A frozen canvas is the worst failure mode: it looks like a hang and tells
// nobody anything. These checks prove the game survives one bad frame,
// admits to a persistent one, and never loses your progress on the way out.
// Needs Playwright:  npm i && npx playwright install chromium
// Run with:  npm run test:crash
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(ORIGIN);
  await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 8000 });
  return { context, page };
}

// --- one bad frame is survivable ---------------------------------------
{
  const { context, page } = await fresh();
  const survived = await page.evaluate(async () => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(11); d.resumeRun();
    for (let i = 0; i < 20; i++) { if (d.bird.y > 230) d.flap(); d.tick(); }
    const before = d.G.ticks;
    d.breakFrame(1);                                  // exactly one throw
    await new Promise(r => setTimeout(r, 300));       // let rAF run through it
    return { before, after: d.G.ticks, crashed: d.crashInfo().crashed, state: d.G.state };
  });
  check('a single bad frame does not kill the game',
    survived.crashed === null && survived.after >= survived.before,
    JSON.stringify(survived));
  await context.close();
}

// --- a persistent fault stops, and says so ------------------------------
{
  const { context, page } = await fresh();
  const healthy = (await page.locator('#game').screenshot()).toString('base64');

  const stopped = await page.evaluate(async () => {
    const d = __dreybird;
    d.resetWorld(); d.startPlay(11); d.resumeRun();
    d.breakFrame(50);                                 // keeps throwing
    await new Promise(r => setTimeout(r, 900));
    return { crashed: d.crashInfo().crashed, count: d.crashInfo().count };
  });
  check('a persistent fault stops the loop rather than spinning',
    typeof stopped.crashed === 'string' && stopped.crashed.length > 0,
    JSON.stringify(stopped));

  const broken = (await page.locator('#game').screenshot()).toString('base64');
  check('and paints something different from a healthy frame',
    broken !== healthy, 'identical=' + (broken === healthy));

  // The player is the only one who can report what happened, so the
  // actual error has to be on screen — not a generic apology.
  const shown = await page.evaluate(() => __dreybird.crashInfo().crashed);
  check('the message carries the real error text',
    /injected frame fault/.test(shown), shown);

  // Nothing in the chrome works after a crash, so none of it should be
  // offered — and the tap needs somewhere to go on a phone.
  const chrome = await page.evaluate(() => {
    const btn = document.getElementById('btn-player');
    return {
      marked: document.getElementById('stage').dataset.crashed === '1',
      hidden: getComputedStyle(btn).display === 'none'
    };
  });
  check('the corner buttons are withdrawn once it has crashed',
    chrome.marked && chrome.hidden, JSON.stringify(chrome));

  // location.reload is unforgeable, so it cannot be stubbed. Assert the
  // real navigation instead — the stronger claim anyway: the tap has to
  // actually bring the game back. It must be a real click, too; calling
  // press() from inside evaluate leaves the reload wedged mid-parse.
  await page.locator('#game').click();
  let recovered = false;
  try {
    await page.waitForFunction(
      () => window.__dreybird && window.__dreybird.crashInfo().crashed === null,
      null, { timeout: 8000 });
    recovered = true;
  } catch (e) { /* stayed crashed */ }
  check('and a tap reloads into a working game',
    recovered, recovered ? 'back at the title screen' : 'still on the crash screen');
  await context.close();
}

// --- progress survives a crash ------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(ORIGIN);
  await page.waitForFunction(() => !!window.__dreybird);

  await page.evaluate(async () => {
    const d = __dreybird;
    // Finish a real run, then crash immediately — before any debounce or
    // idle write would have had a chance to save it on its own.
    d.resetWorld(); d.startPlay(3); d.resumeRun();
    d.G.score = 27; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 500 && d.G.state !== d.states.OVER; i++) d.tick();
    window.dispatchEvent(new ErrorEvent('error', {
      error: new Error('thrown outside the loop'), message: 'thrown outside the loop'
    }));
    await new Promise(r => setTimeout(r, 250));
  });
  const caught = await page.evaluate(() => __dreybird.crashInfo().crashed);
  check('an error thrown outside the loop is caught too',
    /thrown outside the loop/.test(String(caught)), String(caught));

  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const kept = await page.evaluate(() => ({ best: __dreybird.active().best, games: __dreybird.active().stats.games }));
  check('and the run that led to it survives a reload',
    kept.best === 27 && kept.games >= 1, JSON.stringify(kept));
  await context.close();
}

// --- an unhandled rejection counts as a crash ---------------------------
{
  const { context, page } = await fresh();
  const rejected = await page.evaluate(async () => {
    Promise.reject(new Error('a promise nobody caught'));
    await new Promise(r => setTimeout(r, 300));
    return __dreybird.crashInfo().crashed;
  });
  check('an unhandled rejection is caught as well',
    /a promise nobody caught/.test(String(rejected)), String(rejected));
  await context.close();
}

await browser.close();
server.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
