// Checks that DreyBird is actually installable and actually works offline.
// A service worker needs a real origin, so this serves the repo on localhost.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/pwa.mjs
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

// Lets a test publish a new build mid-run, the way a deploy does.
const OVERRIDE = new Map();

const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = OVERRIDE.has(rel) ? OVERRIDE.get(rel) : await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + server.address().port + '/';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(ORIGIN);
await page.waitForFunction(() => !!window.__dreybird);

// --- service worker ---------------------------------------------------
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const sw = reg.active;
  // ready resolves as soon as there is an active worker; clients.claim()
  // may still be running, so wait for it to finish activating.
  if (sw && sw.state !== 'activated') {
    await new Promise(done => {
      const t = setTimeout(done, 5000);
      sw.addEventListener('statechange', () => {
        if (sw.state === 'activated') { clearTimeout(t); done(); }
      });
    });
  }
  return { scope: reg.scope, state: sw && sw.state, controlled: !!navigator.serviceWorker.controller };
});
check('service worker activates and controls the page',
  swState.state === 'activated' && swState.controlled, JSON.stringify(swState));

// --- a new build reaches the player on the next load --------------------
// Cache-first navigation hands back the previous build and only notices the
// new one afterwards, so every change lands a launch late. Nobody should
// have to open the game twice to see a fix.
{
  const shipped = (await readFile(join(ROOT, 'index.html'), 'utf8'))
    .replace('<title>', '<title data-build="second">');
  OVERRIDE.set('/index.html', Buffer.from(shipped));
  await page.reload({ waitUntil: 'load' });
  const got = await page.getAttribute('title', 'data-build');
  check('a freshly deployed build shows up on the very next load',
    got === 'second', 'data-build=' + got);
  OVERRIDE.delete('/index.html');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__dreybird);
}

// --- manifest ---------------------------------------------------------
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
check('manifest link is injected at runtime', manifestHref === 'manifest.webmanifest', String(manifestHref));

const mf = await (await context.request.get(ORIGIN + 'manifest.webmanifest')).json();
check('manifest declares an installable app',
  mf.name === 'DreyBird' && mf.start_url === '.' && mf.scope === '.' &&
  mf.display === 'standalone' && mf.orientation === 'portrait' && !!mf.theme_color,
  `${mf.name} · ${mf.display} · start_url=${mf.start_url}`);

const purposes = mf.icons.map(i => i.purpose);
check('manifest ships any + maskable icons',
  purposes.includes('any') && purposes.includes('maskable') &&
  mf.icons.some(i => i.sizes === '512x512'), JSON.stringify(purposes));

// every declared icon exists and really is the size it claims
const iconChecks = [];
for (const icon of mf.icons) {
  const res = await context.request.get(ORIGIN + icon.src);
  const dims = res.ok() ? await page.evaluate(src => new Promise(done => {
    const im = new Image();
    im.onload = () => done(im.naturalWidth + 'x' + im.naturalHeight);
    im.onerror = () => done('load-failed');
    im.src = src;
  }), icon.src) : 'http-' + res.status();
  iconChecks.push({ src: icon.src, want: icon.sizes, got: dims });
}
check('declared icons exist at their declared sizes',
  iconChecks.every(i => i.got === i.want), JSON.stringify(iconChecks));

const apple = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
const appleRes = await context.request.get(ORIGIN + apple);
check('iOS home-screen icon is served', appleRes.ok(), apple + ' → ' + appleRes.status());

check('theme-color is declared for both themes',
  (await page.locator('meta[name="theme-color"]').count()) === 2);

// --- the install affordance -------------------------------------------
check('install button stays hidden until the browser offers a prompt',
  await page.isHidden('#install'));

// --- an optional font must never be able to hang the game --------------
{
  // The service worker intercepts the font host. If that handler never
  // settles, the stylesheet request stays pending, the parser refuses to
  // run the scripts after it, and the page sits at readyState "loading"
  // forever — a hang on any captive portal or blackholed network. This
  // simulates exactly that: a font host that accepts and never answers.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', () => { /* never fulfilled */ });
  await page.route('https://fonts.gstatic.com/**', () => { /* never fulfilled */ });

  let booted = false;
  try {
    await page.goto(ORIGIN, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 12000 });
    booted = true;
  } catch (e) { /* left hanging */ }
  check('a font host that never answers cannot stop the game booting',
    booted, booted ? 'booted without waiting for the typeface' : 'stuck at readyState loading');

  if (booted) {
    const playable = await page.evaluate(() => {
      const d = __dreybird;
      d.resetWorld(); d.startPlay(5); if (d.resumeRun) d.resumeRun();
      for (let i = 0; i < 60; i++) { if (d.bird.y > 235) d.flap(); d.tick(); }
      return d.G.ticks;
    });
    check('and it is playable on the fallback typeface', playable === 60, 'ticks=' + playable);
  } else {
    check('and it is playable on the fallback typeface', false, 'never booted');
  }
  await context.close();
}

// --- the point of all this: it plays with the network off -------------
await page.evaluate(() => navigator.serviceWorker.ready);
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
// Boot is async — it opens the vault before publishing the hook — so
// DOMContentLoaded is not the same moment as "the game is ready".
await page.waitForFunction(() => !!window.__dreybird, null, { timeout: 10000 });
const offline = await page.evaluate(async () => {
  if (!window.__dreybird) return { booted: false };
  const d = window.__dreybird;
  d.resetWorld();
  d.press();                                   // same path a tap takes
  const started = d.G.state === d.states.PLAYING;
  for (let i = 0; i < 3000 && d.G.state === d.states.PLAYING; i++) {
    const p = d.pipes.find(p => p.x + d.PIPE_W > d.bird.x) || d.pipes[0];
    if (d.bird.y > p.gap + 18 && d.bird.vy > -1) d.flap();
    d.tick();
  }
  return { booted: true, started, score: d.G.score };
});
check('offline: the game boots, starts on a tap and scores',
  offline.booted && offline.started && offline.score > 0, JSON.stringify(offline));
mkdirSync(HERE + 'shots', { recursive: true });
await page.screenshot({ path: HERE + 'shots/shot-offline.png' }).catch(() => {});
await context.setOffline(false);

check('no page errors anywhere in the run', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
server.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
