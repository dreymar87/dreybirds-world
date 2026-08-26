// XP, levels, bird traits and feathers.
//
// The load-bearing check here is world isolation: a bird may change the
// bird, never the world. If a trait ever touches pipe generation, two
// players on one seed stop playing the same game, and the daily challenge
// and ghost replay are dead before they are built.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run with:  node test/progression.mjs
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

// --- the world-isolation guarantee --------------------------------------
{
  const { context, page } = await fresh();
  const worlds = await page.evaluate(() => {
    const d = __dreybird;
    d.active().coins = 999999;
    for (const s of d.SKINS) if (s.cost != null) d.buy(s);
    d.active().best = 999; d.G.best = 999;      // open the score-gated ones

    // Fly each bird through the same seed, recording only the WORLD.
    const survey = () => {
      d.resetWorld(); d.startPlay(31415); if (d.resumeRun) d.resumeRun();
      const seen = new Set(), out = [];
      for (let i = 0; i < 40000 && out.length < 80; i++) {
        d.G.state = d.states.PLAYING;
        d.G.slow = 0;
        d.bird.y = 200; d.bird.vy = 0;
        d.tick();
        for (const p of d.pipes) {
          if (seen.has(p)) continue;
          seen.add(p);
          out.push(p.base + ':' + p.h + ':' + p.amp);
        }
      }
      return out.join('|');
    };

    const byBird = {};
    for (const s of d.SKINS) {
      d.equip('bird', s.id);
      byBird[s.id] = survey();
    }
    return byBird;
  });
  const ids = Object.keys(worlds);
  const first = worlds[ids[0]];
  const differing = ids.filter(id => worlds[id] !== first);
  check('every bird sees an identical world on the same seed',
    differing.length === 0 && first.length > 40,
    differing.length ? 'these differ: ' + differing.join(', ') : ids.length + ' birds, ' + first.split('|').length + ' pipes each');
  await context.close();
}

// --- sidegrades are real, not a claim -----------------------------------
{
  const { context, page } = await fresh();
  const grades = await page.evaluate(() => {
    const d = __dreybird;
    const base = { gravity: 1, maxVy: 1, hit: 1, flap: 1, power: 1, coin: 1, xp: 1, shieldHits: 1 };
    const out = [];
    for (const s of d.SKINS) {
      const tr = s.traits || {};
      let better = 0, worse = 0;
      for (const k of Object.keys(tr)) {
        const delta = (tr[k] - base[k]) * d.TRAIT_DIRS[k];
        if (delta > 0) better++;
        if (delta < 0) worse++;
      }
      out.push({ id: s.id, better, worse, labelled: !!((s.up && s.down) || s.baseline) });
    }
    return out;
  });
  const baseline = grades.find(g => g.id === 'classic');
  const others = grades.filter(g => g.id !== 'classic');
  check('Classic is the baseline, with no modifiers at all',
    baseline.better === 0 && baseline.worse === 0, JSON.stringify(baseline));
  check('every other bird is better at something and worse at something',
    others.every(g => g.better >= 1 && g.worse >= 1),
    JSON.stringify(others.filter(g => g.better < 1 || g.worse < 1)) || 'all trade');
  check('and every bird states its trade on the card',
    grades.every(g => g.labelled));
  await context.close();
}

// --- traits reach the simulation ----------------------------------------
{
  const { context, page } = await fresh();
  const phys = await page.evaluate(() => {
    const d = __dreybird;
    d.active().coins = 999999;
    d.active().best = 999; d.G.best = 999;
    for (const s of d.SKINS) if (s.cost != null) d.buy(s);
    const read = id => {
      d.equip('bird', id);
      d.resetWorld(); d.startPlay(1); if (d.resumeRun) d.resumeRun();
      return d.physics();
    };
    return { classic: read('classic'), ember: read('ember'), ghost: read('ghost'),
             coal: read('coal'), plum: read('plum') };
  });
  check('a heavy bird really is heavier than a light one',
    phys.ember.gravity > phys.classic.gravity && phys.coal.gravity > phys.classic.gravity,
    `classic=${phys.classic.gravity.toFixed(3)} ember=${phys.ember.gravity.toFixed(3)} coal=${phys.coal.gravity.toFixed(3)}`);
  check('and the world stays put while they do',
    phys.ember.gap === phys.classic.gap && phys.ember.speed === phys.classic.speed &&
    phys.coal.gap === phys.classic.gap,
    `gap ${phys.classic.gap}/${phys.ember.gap}/${phys.coal.gap} speed ${phys.classic.speed}/${phys.ember.speed}`);
  check('a patient bird falls more slowly',
    phys.plum.maxVy < phys.classic.maxVy, `classic=${phys.classic.maxVy} plum=${phys.plum.maxVy}`);

  const graze = await page.evaluate(() => {
    const d = __dreybird;
    const hitH = id => {
      d.equip('bird', id);
      d.resetWorld(); d.startPlay(2); if (d.resumeRun) d.resumeRun();
      return d.physics().hitH;
    };
    // Place the gap edge exactly between the two birds' profiles, so the
    // hitbox is the only thing that decides the outcome.
    const slim = hitH('ghost'), broad = hitH('candy');
    const edge = (slim / 2 + broad / 2) / 2;

    const attempt = id => {
      d.equip('bird', id);
      d.resetWorld(); d.startPlay(2); if (d.resumeRun) d.resumeRun();
      const p = d.pipes[0];
      p.x = d.bird.x - 10;
      p.base = p.gap = d.bird.y - edge + d.G.gap / 2;
      d.tick();
      return d.G.state === d.states.PLAYING;
    };
    return { slim, broad, edge, ghost: attempt('ghost'), candy: attempt('candy') };
  });
  check('a slim bird survives a graze that clips a broad one',
    graze.ghost && !graze.candy, JSON.stringify(graze));

  const armour = await page.evaluate(() => {
    const d = __dreybird;
    const hits = id => {
      d.equip('bird', id);
      d.resetWorld(); d.startPlay(3); if (d.resumeRun) d.resumeRun();
      d.G.shield = d.G.shieldHits;
      let survived = 0;
      for (let n = 0; n < 3; n++) {
        d.G.invuln = 0;
        const p = d.pipes.find(q => q.x + d.PIPE_W > d.bird.x - 20) || d.pipes[0];
        p.x = d.bird.x - 10; p.base = p.gap = d.bird.y + 200;
        d.tick();
        if (d.G.state === d.states.PLAYING) survived++; else break;
      }
      return survived;
    };
    return { classic: hits('classic'), coal: hits('coal') };
  });
  check('Coal’s shield takes two hits where Classic’s takes one',
    armour.coal === armour.classic + 1, JSON.stringify(armour));
  await context.close();
}

// --- XP maths ------------------------------------------------------------
{
  const { context, page } = await fresh();
  const maths = await page.evaluate(() => {
    const d = __dreybird;
    const boundaries = [];
    for (let n = 1; n <= 40; n++) {
      const need = d.xpForLevel(n);
      boundaries.push({
        n,
        atExact: d.levelFor(need) === n,
        justBelow: n === 1 || d.levelFor(need - 1) === n - 1,
        monotonic: n === 1 || d.xpForLevel(n) > d.xpForLevel(n - 1)
      });
    }
    return {
      bad: boundaries.filter(b => !b.atExact || !b.justBelow || !b.monotonic),
      plain: d.runXp(20, 'silver', false),
      best: d.runXp(20, 'silver', true),
      none: d.runXp(0, null, false)
    };
  });
  check('levelFor and xpForLevel agree at every boundary, and the curve only climbs',
    maths.bad.length === 0, JSON.stringify(maths.bad.slice(0, 3)));
  check('a run pays score plus its medal, doubled on a personal best',
    maths.plain === 35 && maths.best === 70 && maths.none === 0, JSON.stringify(maths));

  const awarded = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.xp = 0; p.best = 100; d.G.best = 100;       // no personal best in play
    d.equip('bird', 'classic');
    d.resetWorld(); d.startPlay(9); if (d.resumeRun) d.resumeRun();
    d.G.score = 22; d.G.state = d.states.DYING; d.bird.y = 999;
    for (let i = 0; i < 500 && d.G.state !== d.states.OVER; i++) d.tick();
    return { xp: p.xp, expected: d.runXp(22, 'silver', false), runXp: d.G.runXp };
  });
  check('and that is what a real run actually banks',
    awarded.xp === awarded.expected && awarded.runXp === awarded.expected, JSON.stringify(awarded));
  await context.close();
}

// --- feather slots -------------------------------------------------------
{
  const { context, page } = await fresh();
  const slots = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.feathers = [];
    p.xp = 0;                                       // level 1
    const lowLevel = (() => { d.equip('feather', 'lift'); return p.feathers.slice(); })();

    p.xp = d.xpForLevel(5);                         // one slot
    d.equip('feather', 'thrift');
    const oneSlot = p.feathers.slice();
    d.equip('feather', 'study');                    // no free slot
    const stillOne = p.feathers.slice();

    p.xp = d.xpForLevel(13);                        // two slots
    d.equip('feather', 'study');
    const twoSlots = p.feathers.slice();

    d.equip('feather', 'thrift');                   // toggles off
    const removed = p.feathers.slice();

    p.xp = d.xpForLevel(13);
    const tooHigh = (() => { d.equip('feather', 'plate'); return p.feathers.indexOf('plate') >= 0; })();
    return { lowLevel, oneSlot, stillOne, twoSlots, removed, tooHigh,
             slotsAt1: d.slotsAt(1), slotsAt5: d.slotsAt(5), slotsAt30: d.slotsAt(30) };
  });
  check('no slots before level 4, then one, then all three by 22',
    slots.slotsAt1 === 0 && slots.slotsAt5 === 1 && slots.slotsAt30 === 3, JSON.stringify(slots));
  check('a perk cannot be equipped with no slot open', slots.lowLevel.length === 0);
  check('a second perk is refused while only one slot is open',
    slots.oneSlot.length === 1 && slots.stillOne.length === 1, JSON.stringify(slots.stillOne));
  check('a second slot accepts it', slots.twoSlots.length === 2, JSON.stringify(slots.twoSlots));
  check('tapping an equipped perk takes it off', slots.removed.length === 1, JSON.stringify(slots.removed));
  check('a perk above your level cannot be equipped at all', slots.tooHigh === false);

  // The invariant that would have caught Plating unlocking at 26 with the
  // slot that could pair it arriving at 30 — and that caught two more of
  // my own numbers when this ladder was retuned.
  const ladder = await page.evaluate(() => {
    const d = __dreybird;
    return d.FEATHERS.map(f => ({ id: f.id, lvl: f.lvl, slots: d.slotsAt(f.lvl) }));
  });
  check('every perk has somewhere to go the moment it unlocks',
    ladder.every(f => f.slots >= 1),
    JSON.stringify(ladder.filter(f => f.slots < 1)) || ladder.map(f => f.id + '@' + f.lvl).join(' '));

  const header = await page.evaluate(() => {
    const d = __dreybird;
    const read = lvl => {
      d.active().xp = d.xpForLevel(lvl);
      d.setTab('feather');
      return document.getElementById('wallet').textContent;
    };
    return { early: read(7), mid: read(13), capped: read(24) };
  });
  check('the header says where the next slot is, until there are none left',
    /NEXT AT 12/.test(header.early) && /NEXT AT 22/.test(header.mid) && !/NEXT AT/.test(header.capped),
    JSON.stringify(header));

  const cardCopy = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.xp = d.xpForLevel(7);                  // one slot, and fill it
    p.feathers = [];
    d.equip('feather', 'thrift');
    d.setTab('feather');
    const texts = [...document.querySelectorAll('#skin-list .card')].map(c => c.textContent);
    return {
      full: texts.find(t => /Study/.test(t)) || '',
      locked: texts.find(t => /Plating/.test(t)) || ''
    };
  });
  check('a card with no free slot says which level opens the next one',
    /Slot 2 opens at level 12/.test(cardCopy.full), cardCopy.full);
  check('and a still-locked perk keeps saying when it unlocks',
    /Unlocks at level 20/.test(cardCopy.locked), cardCopy.locked);

  // Thresholds only ever moved down, so nobody may lose a slot they had.
  const noDemotion = await page.evaluate(() => {
    const d = __dreybird;
    return { atOld15: d.slotsAt(15), atOld30: d.slotsAt(30), atOld5: d.slotsAt(5) };
  });
  check('nobody is demoted by the retune',
    noDemotion.atOld5 >= 1 && noDemotion.atOld15 >= 2 && noDemotion.atOld30 === 3,
    JSON.stringify(noDemotion));

  const stacked = await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.xp = d.xpForLevel(23);
    p.feathers = [];
    d.equip('bird', 'classic');
    const bare = d.traitsNow().coin;
    d.equip('feather', 'thrift');
    const withPerk = d.traitsNow().coin;
    return { bare, withPerk };
  });
  check('an equipped perk actually changes what the bird is',
    stacked.withPerk > stacked.bare, JSON.stringify(stacked));
  await context.close();
}

// --- persistence and back-pay -------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__dreybird);
  await page.evaluate(async () => {
    const d = __dreybird;
    const p = d.active();
    p.xp = d.xpForLevel(13);
    p.feathers = [];
    d.equip('feather', 'thrift');
    d.equip('feather', 'study');
    await d.flush();
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const kept = await page.evaluate(() => {
    const d = __dreybird;
    return { xp: d.xp(), level: d.level(), feathers: d.active().feathers.slice(),
             live: d.equippedFeathers().map(f => f.id) };
  });
  check('XP, level and equipped perks survive a reload',
    kept.level === 13 && kept.feathers.length === 2 && kept.live.length === 2, JSON.stringify(kept));
  await context.close();
}
{
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    // A profile in the shape the previous release wrote: no xp field.
    localStorage.setItem('dreybird.vault', JSON.stringify({
      activeId: 'old', profiles: [{
        id: 'old', name: 'Veteran', skin: 'ember', best: 31, created: 1, coins: 10, owned: [],
        stats: { games: 9, pipes: 140, longest: 900, powers: 6, bronze: 2, silver: 3, gold: 1, platinum: 0 }
      }]
    }));
    Object.defineProperty(window, 'indexedDB', { get() { return undefined; } });
  });
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__dreybird);
  const granted = await page.evaluate(() => ({ xp: __dreybird.xp(), level: __dreybird.level() }));
  const expected = 31 + (2 * 5 + 3 * 15 + 1 * 30);
  check('a profile from before levels is back-paid XP for play already done',
    granted.xp === expected, JSON.stringify({ ...granted, expected }));
  await page.evaluate(() => __dreybird.flush());
  await page.reload();
  await page.waitForFunction(() => !!window.__dreybird);
  const again = await page.evaluate(() => __dreybird.xp());
  check('and not paid again on the next load', again === expected, 'xp=' + again);
  await context.close();
}

// --- multipliers reach the wallet ---------------------------------------
// The old sidegrade check read the trait numbers and never watched a coin
// land. It passed while Gilded, Candy, Thrift and Mint all paid exactly
// what Classic paid, because earn() rounded every award on its own and a
// pipe pays 1. These checks look only at the wallet.
{
  const { context, page } = await fresh();
  const PIPES = 20;

  const payout = (bird, feathers) => page.evaluate(([bird, feathers, PIPES]) => {
    const d = __dreybird, p = d.active();
    p.xp = d.xpForLevel(60);                       // enough level for any perk
    p.feathers = [];
    d.equip('bird', bird);
    for (const f of feathers) d.equip('feather', f);
    p.coins = 0;
    d.resetWorld();
    d.startPlay(31337);                            // one seed for every bird
    let guard = 0;
    while (d.G.score < PIPES && guard++ < 20000) {
      // Power-ups pay a flat 2 and their pickup radius follows the hit
      // trait, so they would confound a comparison between birds. Clearing
      // them leaves pipe income alone — which is the thing that was broken.
      d.powers.length = 0;
      d.G.state = d.states.PLAYING;                // a parked bird is not an immortal one
      if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
      d.bird.vy = 0;
      d.tick();
    }
    return { coins: p.coins, runCoins: d.G.runCoins, score: d.G.score, mul: d.physics().coinMul };
  }, [bird, feathers, PIPES]);

  const classic = await payout('classic', []);
  const gilded  = await payout('gilded', []);
  const mint    = await payout('mint', []);
  const thrift  = await payout('classic', ['thrift']);
  const both    = await payout('gilded', ['thrift']);

  check('a plain bird earns one coin per pipe',
    classic.score === PIPES && classic.coins === PIPES, JSON.stringify(classic));
  check('the wallet agrees with the run total',
    [classic, gilded, mint, thrift, both].every(r => r.coins === r.runCoins),
    JSON.stringify([classic, gilded, mint, thrift, both].map(r => r.coins + '/' + r.runCoins)));
  check('Gilded really does earn more',
    gilded.coins > classic.coins, 'gilded ' + gilded.coins + ' vs classic ' + classic.coins);
  check('Mint really does earn less',
    mint.coins < classic.coins, 'mint ' + mint.coins + ' vs classic ' + classic.coins);
  check('Thrift really does pay a little more',
    thrift.coins > classic.coins, 'thrift ' + thrift.coins + ' vs classic ' + classic.coins);
  // The cliff itself: rounding each award turned 1.35 into 1 and 1.512
  // into 2, so stacking used to double the income in a single step.
  check('stacking multiplies, it does not jump a cliff',
    both.coins > gilded.coins && both.coins < classic.coins * 2,
    'both ' + both.coins + ', gilded ' + gilded.coins + ', double would be ' + classic.coins * 2);
  check('each payout tracks its multiplier',
    [classic, gilded, mint, thrift, both].every(r => Math.abs(r.coins - PIPES * r.mul) < 1),
    JSON.stringify([classic, gilded, mint, thrift, both].map(r => r.mul.toFixed(3) + '=>' + r.coins)));
  await context.close();
}

// --- perks gate on level, not on best score ------------------------------
// Perks borrowed `need` from the score-gated birds, so a perk card was
// gated on a best score it has nothing to do with. An assist player never
// sets a best score by design, so they could reach level 20 and find every
// perk locked while the label read "Equipped".
{
  const { context, page } = await fresh();
  const gate = await page.evaluate(() => {
    const d = __dreybird, p = d.active();
    p.assist = true;                     // the player the old gate locked out
    p.best = 0; d.G.best = 0;
    p.xp = d.xpForLevel(20);             // every perk unlocked by level
    p.feathers = [];
    d.setTab('feather');
    const cards = [...document.querySelectorAll('#skin-list button')];
    const disabled = cards.filter(b => b.disabled).map(b => b.dataset.item);
    d.equip('feather', 'plate');         // the level-20 perk
    return {
      level: d.level(), best: p.best, cards: cards.length,
      disabled, equipped: (p.feathers || []).slice()
    };
  });
  check('a level-20 player with no best score sees every perk unlocked',
    gate.cards === 6 && gate.disabled.length === 0,
    JSON.stringify({ level: gate.level, best: gate.best, disabled: gate.disabled }));
  check('and can actually equip one',
    gate.equipped.indexOf('plate') >= 0, JSON.stringify(gate.equipped));

  const low = await page.evaluate(() => {
    const d = __dreybird, p = d.active();
    p.xp = d.xpForLevel(5);              // above Thrift, below everything else
    p.feathers = [];
    d.equip('feather', 'plate');         // needs level 20
    const after = (p.feathers || []).slice();
    d.equip('feather', 'thrift');        // needs level 4
    d.setTab('feather');
    const dim = [...document.querySelectorAll('#skin-list button')]
      .filter(b => b.disabled).map(b => b.dataset.item);
    return { afterPlate: after, feathers: (p.feathers || []).slice(), dim };
  });
  check('a perk above your level is still refused',
    low.afterPlate.length === 0 && low.feathers.join() === 'thrift',
    JSON.stringify(low));
  check('and its card is dimmed while the ones you have reached are not',
    low.dim.indexOf('plate') >= 0 && low.dim.indexOf('thrift') < 0, JSON.stringify(low.dim));
  await context.close();
}

// --- screenshots ---------------------------------------------------------
{
  mkdirSync(HERE + 'shots', { recursive: true });
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const d = __dreybird;
    const p = d.active();
    p.coins = 3000; p.best = 60; d.G.best = 60;
    p.xp = d.xpForLevel(17);
    for (const s of d.SKINS) if (s.cost != null) d.buy(s);
    p.feathers = [];
    d.equip('feather', 'thrift');
    d.equip('bird', 'coal');
  });
  for (const [kind, name] of [['bird', 'traits'], ['feather', 'perks']]) {
    await page.evaluate(k => { __dreybird.setTab(k); document.getElementById('sheet').hidden = false; }, kind);
    await page.waitForTimeout(200);
    await page.screenshot({ path: HERE + 'shots/shot-' + name + '.png' });
  }
  await page.evaluate(() => { document.getElementById('sheet').hidden = true; __dreybird.resetWorld(); });
  await page.waitForTimeout(160);
  await page.screenshot({ path: HERE + 'shots/shot-level.png' });
  await context.close();
}

check('no page errors across every scenario', errors.length === 0, errors.join(' | ').slice(0, 240));

await browser.close();
const failed = results.filter(r => !r).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
