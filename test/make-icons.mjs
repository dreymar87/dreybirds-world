// Regenerates the app icons from the game's own bird art, so the icon and
// the bird can never drift apart. Needs Playwright:
//   npm i -D playwright && npx playwright install chromium
// Run with:  node test/make-icons.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = HERE + '../';
const PAGE = pathToFileURL(ROOT + 'index.html').href;
const ICONS = ROOT + 'icons';

mkdirSync(ICONS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(PAGE);
await page.waitForFunction(() => !!window.__dreybird);

// size: the icon's edge in px.  safe: fraction of the edge the art may fill
// (maskable icons get cropped to a circle/squircle, so the bird shrinks).
const render = (size, safe) => page.evaluate(([size, safe]) => {
  const d = window.__dreybird;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  /* The Kiln's sky, full bleed, so a mask of any shape still lands on sky --
     and read from the game's own land table, so the icon cannot drift from
     the place it shows. Warm where the classic game's icon is blue: on a home
     screen holding both, colour is what tells them apart at a glance. */
  const phase = d.LANDS.kiln.phase;
  const sky = g.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0, phase.sky0);
  sky.addColorStop(1, phase.sky1);
  g.fillStyle = sky;
  g.fillRect(0, 0, size, size);

  const u = size / 512;   // work in the game's own 512 units

  // A pipe pair at the right edge, well back, to say "flappy" at a glance.
  const pipe = (y, h) => {
    g.fillStyle = '#63c53c'; g.fillRect(size - 74 * u, y, 54 * u, h);
    g.fillStyle = '#9de86f'; g.fillRect(size - 69 * u, y, 9 * u, h);
    g.fillStyle = '#2f7a24'; g.fillRect(size - 32 * u, y, 10 * u, h);
  };
  const lip = y => {
    g.fillStyle = '#63c53c'; g.fillRect(size - 82 * u, y, 70 * u, 20 * u);
    g.fillStyle = '#9de86f'; g.fillRect(size - 77 * u, y, 9 * u, 20 * u);
    g.fillStyle = '#2f7a24'; g.fillRect(size - 32 * u, y, 10 * u, 20 * u);
  };
  pipe(0, 150 * u); lip(150 * u);
  pipe(310 * u, size); lip(290 * u);

  // Ground, from the same land.
  g.fillStyle = phase.grass; g.fillRect(0, size - 78 * u, size, 20 * u);
  g.fillStyle = phase.dirt;  g.fillRect(0, size - 58 * u, size, 58 * u);
  g.fillStyle = 'rgba(0,0,0,.10)';
  for (let x = 0; x < size; x += 46 * u) g.fillRect(x, size - 44 * u, 22 * u, 8 * u);

  /* Two birds, drawn by the game itself, scaled to the safe area. The
     classic game's icon is one bird; this one is a flock, which is the whole
     premise. Bluebird is placed relative to the safe area rather than the
     edge, so the maskable crop pulls him in with DreyBird instead of
     clipping him off. */
  const scale = (size * safe) / 34;      // the sprite is 34 px wide
  const flier = (x, y, rot, s, skin) => {
    g.save();
    g.translate(x, y);
    g.scale(scale * s, scale * s);
    g.rotate(rot);
    d.drawBird(g, 0, 0, 0, skin, 0, 1);
    g.restore();
  };
  const sky_ = d.SKINS.find(b => b.id === 'sky') || d.G.skin;
  flier(size * 0.40 - size * safe * 0.44, size * 0.43 - size * safe * 0.40, -0.30, 0.62, sky_);
  flier(size * 0.40, size * 0.43, -0.24, 1, d.G.skin);

  return c.toDataURL('image/png');
}, [size, safe]);

const write = (name, dataUrl) => {
  writeFileSync(ICONS + '/' + name, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote icons/' + name);
};

write('icon-192.png', await render(192, 0.50));
write('icon-512.png', await render(512, 0.50));
write('icon-maskable-512.png', await render(512, 0.38));   // 80% safe zone
write('apple-touch-icon-180.png', await render(180, 0.50));

await browser.close();
