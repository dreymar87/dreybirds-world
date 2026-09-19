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

/* The table checks run first on purpose. A row naming a land that does not
   exist crashes the game the moment anyone flies into it, so left further
   down the file it is reported as a stack trace inside some unrelated check
   rather than as the broken row it is. */
// --- the map is one graph, however many times it is written down ---------
/* Every one of these walks the tables. Adding a land adds its checks by
   itself, and a row that names something that does not exist fails here
   rather than by throwing on the screen a player is standing in.
   Deliberately not a list of land names: a check that has to be edited to
   let new content through is a check that will be edited to let it through. */
{
  const { context, page } = await fresh();
  const graph = await page.evaluate(() => {
    const d = __dreybird;
    const L = d.LANDS, S = d.STAGES;
    const bad = [];
    const ids = Object.keys(L), stages = Object.keys(S);

    for (const id of ids) {
      const land = L[id];
      if (land.id !== id) bad.push(id + ': its row is filed under another name');
      if (!land.name) bad.push(id + ': has no name to announce');
      if (land.ends && land.east) bad.push(id + ': ends the world and still has a way on');

      if (land.east) {
        const st = S[land.east];
        if (!st) bad.push(id + ': east leads to no such passage (' + land.east + ')');
        else {
          if (st.from !== id) bad.push(id + ' → ' + st.id + ': the passage thinks it starts elsewhere');
          const far = L[st.to];
          if (!far) bad.push(st.id + ': arrives in no such land (' + st.to + ')');
          else if (far.west !== id) bad.push(st.id + ': the far side does not point back');
        }
      }
      if (land.west) {
        const back = L[land.west];
        if (!back) bad.push(id + ': west leads to no such land (' + land.west + ')');
        else if (!back.east || S[back.east].to !== id) bad.push(id + ': the way back is not the way there');
      }
      /* A door that nothing in the land can open is a dead end that does
         not look like one. Which door is which is the land's own answer, so
         a new way of opening one is checked here the day it is added. */
      const opens = d.opensOn(land);
      if (land.gate && !opens) bad.push(id + ': has a door that nothing opens');
      if (opens === 'thanks' && !land.npc) bad.push(id + ': its door waits on a thanks nobody gives');
      if (opens === 'errand' && !land.pickups) bad.push(id + ': its door waits on an errand it does not set');
      if (opens && ['thanks', 'errand', 'always'].indexOf(opens) < 0) bad.push(id + ': opens on ' + opens + ', which is nothing');

      if (land.npc && !d.NPCS[land.npc.who]) bad.push(id + ': nobody called ' + land.npc.who);
      for (const perch of (land.perches || [])) {
        if (!d.SKINS.some(b => b.id === perch.who)) bad.push(id + ': no bird called ' + perch.who);
        if (!(perch.x > 0) || !(perch.y > 0)) bad.push(id + ': a perch with nowhere to sit');
      }
      if (land.pickups) {
        if (!land.pickups.at.length) bad.push(id + ': an errand with nothing to find');
        if (!d.PICKUPS[land.pickups.kind]) bad.push(id + ': nothing is known about a ' + land.pickups.kind);
      }
      for (const k of ['sky0', 'sky1', 'grass', 'dirt']) {
        if (!land.phase || !land.phase[k]) bad.push(id + ': its sky has no ' + k);
      }
    }

    for (const sid of stages) {
      const st = S[sid];
      if (st.id !== sid) bad.push(sid + ': its row is filed under another name');
      if (!L[st.from]) bad.push(sid + ': comes from nowhere (' + st.from + ')');
      if (!L[st.to]) bad.push(sid + ': goes nowhere (' + st.to + ')');
      if (!(st.pipes > 0)) bad.push(sid + ': no pipes to fly');
      if (st.finds && !d.SKINS.some(b => b.id === st.finds)) bad.push(sid + ': finds no bird called ' + st.finds);
    }

    // One start, and it is where a new player is put down.
    const starts = ids.filter(id => !L[id].west);
    const ends = ids.filter(id => L[id].ends);

    // Walk it here, and require the game's own running order to agree.
    const walk = [];
    let at = starts[0], guard = 0;
    while (at && guard++ < 50) {
      walk.push(at);
      const east = L[at].east;
      if (!east) break;
      walk.push(east);
      at = S[east].to;
    }

    const reached = new Set(walk);
    const orphans = ids.filter(id => !reached.has(id))
      .concat(stages.filter(id => !reached.has(id)));

    return { bad, starts, ends, walk, chain: d.chain(), start: d.startLand(), orphans,
             lands: ids.length, stages: stages.length };
  });

  check('every land and passage names only things that exist',
    graph.bad.length === 0, graph.bad.join(' | ').slice(0, 300));
  check('and the ways there and back are the same way',
    graph.bad.filter(b => /point back|way back|starts elsewhere/.test(b)).length === 0,
    graph.bad.join(' | ').slice(0, 200));
  check('there is exactly one place to begin and at least one to end',
    graph.starts.length === 1 && graph.ends.length >= 1,
    JSON.stringify({ starts: graph.starts, ends: graph.ends }));
  check('nothing is written down that cannot be walked to',
    graph.orphans.length === 0, graph.orphans.join(', '));
  check('and the map’s running order matches the world it describes',
    graph.chain.join('>') === graph.walk.join('>') && graph.start === graph.starts[0],
    graph.chain.join('>') + '  vs  ' + graph.walk.join('>'));
  await context.close();
}

// --- each errand is called by its own name -------------------------------
/* The counter said RINGS or SEEDS from a branch on the kind string, in the
   same breath as two other branches elsewhere on the same string. A land
   that asks for something else has to say so. */
{
  const { context, page } = await fresh();
  const named = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;
    /* One frame, with the world clock standing still. frame() advances by
       however long has really passed since the last call, so two captures
       taken the ordinary way run a different number of ticks and differ in
       every bobbing sprite -- which made a probe pass one run in three
       whether or not the thing it was looking for was drawn. */
    const paint = () => { d.detach(); d.frame(1000); };
    const counter = id => {
      const p = d.active();
      p.story.lands = {};
      d.resetWorld(); d.enterLand(id, true);
      paint();
      return Array.from(g.getImageData(0, Math.round(56 * scale), cv.width,
        Math.round(14 * scale)).data).join(',');
    };
    const rows = {};
    const kinds = {};
    for (const [id, land] of Object.entries(d.LANDS)) {
      if (!land.pickups) continue;
      rows[id] = counter(id);
      kinds[id] = land.pickups.kind;
    }
    const ids = Object.keys(rows);
    const clashes = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (kinds[ids[i]] !== kinds[ids[j]] && rows[ids[i]] === rows[ids[j]]) {
        clashes.push(ids[i] + ' and ' + ids[j] + ' both say the same thing');
      }
    }
    return { clashes, counted: ids.length, labels: Object.keys(d.PICKUPS).map(k => d.PICKUPS[k].label) };
  });
  check('two lands asking for different things do not say the same word',
    named.clashes.length === 0 && named.counted >= 2, named.clashes.join(' | '));
  check('and every kind of thing to find has a name for itself',
    named.labels.length > 0 && named.labels.every(l => typeof l === 'string' && l.trim()),
    JSON.stringify(named.labels));
  await context.close();
}

// --- a door waits for whatever the land says it waits for ----------------
/* A finished errand is not an open door where somebody has to be told. The
   Glade's brambles come apart at the end of Thistle's thanks and not a tick
   before, which is the beat the whole land is built around -- and with one
   opening rule for every land, nothing proved it. */
{
  const { context, page } = await fresh();
  const waits = await page.evaluate(() => {
    const d = __dreybird;
    const out = {};
    for (const [id, land] of Object.entries(d.LANDS)) {
      if (d.opensOn(land) !== 'thanks') continue;
      const p = d.active();
      p.story.lands = {};
      d.resetWorld(); d.enterLand(id, true);
      const E = d.land();

      // Everything the land asks for, taken.
      (land.pickups ? land.pickups.at : []).forEach(sd => {
        d.bird.x = sd.x; d.bird.y = sd.y; d.bird.vx = 0; d.bird.vy = 0;
        d.tick();
      });
      const afterErrand = E.opened;

      // Then said to, all the way through.
      d.bird.x = land.npc.x; d.bird.y = land.npc.y - 20; d.bird.vx = 0; d.bird.vy = 0;
      let guard = 0;
      while (!d.land().opened && guard++ < 40) d.tapLand(0, 0);
      out[id] = { got: E.got.every(Boolean), afterErrand, afterTalk: d.land().opened, taps: guard };
    }
    return out;
  });
  const ids = Object.keys(waits);
  check('a door that waits on a thanks stays shut while the errand is merely done',
    ids.length > 0 && ids.every(id => waits[id].got && waits[id].afterErrand === false),
    JSON.stringify(waits));
  check('and comes apart when the thanks is finished',
    ids.every(id => waits[id].afterTalk === true), JSON.stringify(waits));
  await context.close();
}

// --- each kind of thing to find is drawn as itself ------------------------
/* Three branches on the same kind string became one table row. The counter
   and the puff are checked elsewhere; this is the sprite. Proved by lending
   one kind another's drawing and requiring the screen to notice. */
{
  const { context, page } = await fresh();
  const sprites = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;
    /* One frame, with the world clock standing still. frame() advances by
       however long has really passed since the last call, so two captures
       taken the ordinary way run a different number of ticks and differ in
       every bobbing sprite -- which made a probe pass one run in three
       whether or not the thing it was looking for was drawn. */
    const paint = () => { d.detach(); d.frame(1000); };
    const kinds = Object.keys(d.PICKUPS);
    const bad = [];
    let probed = 0;

    for (const [id, land] of Object.entries(d.LANDS)) {
      if (!land.pickups) continue;
      const mine = land.pickups.kind;
      const other = kinds.find(k => k !== mine);
      if (!other) continue;
      const at = land.pickups.at[0];
      const ink = () => {
        d.active().story.lands = {};
        d.resetWorld(); d.enterLand(id, true);
        paint();
        return Array.from(g.getImageData(Math.round((at.x - 14) * scale), Math.round((at.y - 14) * scale),
          Math.round(28 * scale), Math.round(28 * scale)).data).join(',');
      };
      const own = ink();
      const was = d.PICKUPS[mine].draw;
      d.PICKUPS[mine].draw = d.PICKUPS[other].draw;
      const lent = ink();
      d.PICKUPS[mine].draw = was;
      probed++;
      if (own === lent) bad.push(id + ": a " + mine + " drawn as a " + other + " looks no different");
    }
    return { bad, probed };
  });
  check('a land draws the thing it asks for, and not some other kind',
    sprites.bad.length === 0 && sprites.probed > 0,
    sprites.bad.join(' | ') || (sprites.probed + ' probed'));
  await context.close();
}

// --- a land nobody wrote any code for ------------------------------------
/* The whole point of the milestone, asserted rather than asserted about:
   a land is built here out of nothing but table rows -- a kind of thing to
   find that did not exist a second ago, a door with nobody to open it, and
   two perched birds instead of one -- and then played. Every one of those
   was a branch in a drawing function or an impossibility a commit ago.
   If authoring a land ever needs code again, this goes red. */
{
  const { context, page } = await fresh();
  const made = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;

    /* One frame, with the world clock standing still. frame() advances by
       however long has really passed since the last call, so two captures
       taken the ordinary way run a different number of ticks and differ in
       every bobbing sprite -- which made a probe pass one run in three
       whether or not the thing it was looking for was drawn. */
    const paint = () => { d.detach(); d.frame(1000); };
    const wasKiln = { east: d.LANDS.kiln.east, ends: d.LANDS.kiln.ends };
    d.PICKUPS.crumb = {
      label: 'CRUMBS', puff: '#ffd7a0',
      draw: (sd) => { g.fillStyle = '#ffd7a0'; g.fillRect(sd.x - 4, sd.y - 4, 8, 8); }
    };
    d.STAGES.drift = { id: 'drift', name: 'THE DRIFT', seed: 0x51f7, pipes: 4,
                       gap: 130, hazards: 0, bg: 0, from: 'kiln', to: 'hollow', finds: 'ghost' };
    d.LANDS.hollow = {
      id: 'hollow', name: 'THE HOLLOW', west: 'kiln', ends: true,
      gate: { opens: 'errand' },                       // a door, and nobody to ask
      pickups: { kind: 'crumb', ordered: false,
                 at: [{ x: 120, y: 140 }, { x: 200, y: 220 }] },
      perches: [{ who: 'sky', x: 90, y: 300 }, { who: 'ember', x: 214, y: 356 }],
      phase: d.LANDS.kiln.phase
    };
    d.LANDS.kiln.east = 'drift';
    delete d.LANDS.kiln.ends;

    const p = d.active();
    p.story.flock = ['sky', 'ember'];
    p.story.lands = {};

    // The game's own running order, asked for after the rows were written.
    const chainNow = d.chain();

    const ink = at => {
      paint();
      const x = Math.round(Math.max(0, at.x - 14) * scale), y = Math.round(Math.max(0, at.y - 14) * scale);
      return Array.from(g.getImageData(x, y, Math.round(28 * scale), Math.round(28 * scale)).data).join(',');
    };

    d.resetWorld();
    d.enterLand('hollow');
    const E = d.land();
    const shut = E.opened;
    const emptyDoor = ink({ x: d.GATE_X, y: 300 });
    /* Each perch proved by taking it away: two positions with different
       scenery behind them differ whether or not a bird was ever drawn. */
    const perches = d.LANDS.hollow.perches;
    const perchDrawn = perches.map((q, i) => {
      const there = ink(q);
      const was = perches.slice();
      perches.splice(i, 1);
      d.resetWorld(); d.enterLand('hollow', true);
      const gone = ink(q);
      perches.length = 0; for (const r of was) perches.push(r);
      d.resetWorld(); d.enterLand('hollow', true);
      return there !== gone;
    });

    // Read the counter off the canvas, by the row it is painted in.
    const label = Array.from(g.getImageData(0, Math.round(56 * scale), cv.width,
      Math.round(14 * scale)).data).join(',');
    const blankLabel = (() => {
      const was = d.PICKUPS.crumb.label;
      d.PICKUPS.crumb.label = '';
      paint();
      const row = Array.from(g.getImageData(0, Math.round(56 * scale), cv.width,
        Math.round(14 * scale)).data).join(',');
      d.PICKUPS.crumb.label = was;
      return row;
    })();

    // Fly to each crumb and take it. No NPC, so nothing else can open the way.
    for (const sd of d.LANDS.hollow.pickups.at) {
      d.bird.x = sd.x; d.bird.y = sd.y; d.bird.vx = 0; d.bird.vy = 0;
      d.tick();
    }
    const opened = d.land().opened;
    const openDoor = ink({ x: d.GATE_X, y: 300 });

    // And the way on from the Kiln is a real passage now.
    d.resetWorld(); d.enterLand('kiln');
    d.land().opened = true;
    d.bird.x = d.W; d.bird.vx = 4;
    d.tick();
    const flew = { mode: d.G.mode, stage: d.stage() && d.stage().id };

    // Put the world back exactly as it was.
    delete d.LANDS.hollow; delete d.STAGES.drift; delete d.PICKUPS.crumb;
    d.LANDS.kiln.east = wasKiln.east; d.LANDS.kiln.ends = wasKiln.ends;
    d.resetWorld();

    return { chainNow, shut, opened, doorChanged: emptyDoor !== openDoor,
             perchDrawn, labelShows: label !== blankLabel, flew };
  });

  check('a land added as rows alone joins the running order by itself',
    made.chainNow.join('>') === 'glade>reeds>bank>narrows>kiln>drift>hollow',
    made.chainNow.join('>'));
  check('its door opens on the errand, with nobody there to open it',
    made.shut === false && made.opened === true && made.doorChanged,
    JSON.stringify({ shut: made.shut, opened: made.opened, drawn: made.doorChanged }));
  check('a kind of thing to find that did not exist reaches the counter',
    made.labelShows);
  check('and it holds two perched birds, each one really drawn where it sits',
    made.perchDrawn.length === 2 && made.perchDrawn.every(Boolean), JSON.stringify(made.perchDrawn));
  check('and the way on from the land before it is a real passage',
    made.flew.mode === 'stage' && made.flew.stage === 'drift', JSON.stringify(made.flew));
  await context.close();
}

// --- everyone who speaks has all four things to say ----------------------
{
  const { context, page } = await fresh();
  const said = await page.evaluate(() => {
    const d = __dreybird;
    const bad = [];
    const spoken = new Set(Object.values(d.LANDS).filter(l => l.npc).map(l => l.npc.who));
    for (const [who, npc] of Object.entries(d.NPCS)) {
      if (!npc.name) bad.push(who + ': has no name to put to the voice');
      /* All four, because the land walks them in order and an absent one is
         a silent tap: first asks, again reminds, thanks opens the door,
         after is what he says forever afterwards. */
      for (const k of ['first', 'again', 'thanks', 'after']) {
        const lines = npc[k];
        if (!Array.isArray(lines) || !lines.length) { bad.push(who + ': no ' + k); continue; }
        if (lines.some(l => typeof l !== 'string' || !l.trim())) bad.push(who + ': an empty line in ' + k);
      }
      if (!spoken.has(who)) bad.push(who + ': speaks in no land');
    }
    return { bad, count: Object.keys(d.NPCS).length };
  });
  check('everyone who speaks has all four things to say, and somewhere to say them',
    said.bad.length === 0, said.bad.join(' | ').slice(0, 300));
  await context.close();
}

// --- and all of it actually reaches the screen ---------------------------
/* The suite drives the simulation and almost never renders. A land whose
   row is perfect can still draw nothing at all -- which is the failure a
   player meets first. Each feature is proved by removing it from the table
   and requiring the pixels where it stood to change. */
{
  const { context, page } = await fresh();
  const drawn = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;
    const R = 16;

    // Re-entering a land resets its clock, so two captures of the same
    // land are the same picture. Asserted below rather than assumed.
    /* One frame, with the world clock standing still. frame() advances by
       however long has really passed since the last call, so two captures
       taken the ordinary way run a different number of ticks and differ in
       every bobbing sprite -- which made a probe pass one run in three
       whether or not the thing it was looking for was drawn. */
    const paint = () => { d.detach(); d.frame(1000); };
    const shot = (id, at, prep) => {
      const p = d.active();
      p.story.flock = d.SKINS.map(b => b.id);            // perches draw only birds that are home
      p.story.lands = {};
      d.resetWorld();
      d.enterLand(id, true);
      if (prep) prep(d.land());
      paint();
      const x = Math.round(Math.max(0, (at.x - R)) * scale);
      const y = Math.round(Math.max(0, (at.y - R)) * scale);
      const w = Math.round(Math.min(d.W - 1, R * 2) * scale);
      const h = Math.round(Math.min(d.H - 1, R * 2) * scale);
      return Array.from(g.getImageData(x, y, w, h).data).join(',');
    };

    const bad = [], tested = [];
    const stable = shot('glade', { x: 144, y: 256 }) === shot('glade', { x: 144, y: 256 });

    for (const [id, land] of Object.entries(d.LANDS)) {
      const probe = (what, at, hide, prep) => {
        const there = shot(id, at, prep);
        const undo = hide();
        const gone = shot(id, at, prep);
        undo();
        tested.push(id + '/' + what);
        if (there === gone) bad.push(id + ': nothing is drawn at its ' + what);
      };

      if (land.npc) probe('npc', land.npc, () => {
        const was = land.npc; land.npc = null; return () => { land.npc = was; };
      });

      if (land.pickups) land.pickups.at.forEach((at, i) => probe('pickup ' + i, at, () => {
        const was = land.pickups.at.slice();
        land.pickups.at.splice(i, 1);
        return () => { land.pickups.at.length = 0; for (const a of was) land.pickups.at.push(a); };
      }, E => { E.got = E.got.map(() => false); }));

      if (land.gate) probe('door', { x: d.GATE_X, y: 300 }, () => {
        const was = land.gate; land.gate = false; return () => { land.gate = was; };
      }, E => { E.opened = false; });

      (land.perches || []).forEach((perch, i) => probe('perch ' + i, perch, () => {
        const was = land.perches.slice();
        land.perches.splice(i, 1);
        return () => { land.perches.length = 0; for (const q of was) land.perches.push(q); };
      }));
    }
    return { bad, tested: tested.length, stable };
  });
  check('the same land drawn twice is the same picture', drawn.stable);
  check('every NPC, pickup, door and perch in the tables reaches the canvas',
    drawn.bad.length === 0 && drawn.tested > 0,
    drawn.bad.join(' | ').slice(0, 300) || (drawn.tested + ' probed'));
  await context.close();
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
    const SIZE = 7;                                   // what the speech box paints at
    g.font = SIZE + 'px "Press Start 2P", ui-monospace, monospace';
    const scale = g.measureText('M').width / SIZE;   // 1.0 with the real font
    const asPixelFont = max * Math.min(1, scale);

    const over = [];
    let longest = 0, count = 0;
    for (const npc of Object.values(d.NPCS)) for (const speech of Object.values(npc).filter(Array.isArray)) {
      for (const line of speech) {
        for (const w of d.wrapLines(g, line, asPixelFont, SIZE)) {
          // Press Start 2P advances one em a glyph, so this is the width the
          // line would actually paint at, whatever is loaded right now.
          const width = w.length * SIZE;
          longest = Math.max(longest, width);
          count++;
          if (width > max) over.push(w);
        }
      }
    }
    return { over, longest, max: Math.round(max), count, scale: +scale.toFixed(2) };
  });
  const how = blockFont ? 'on the fallback typeface' : 'with the pixel font';
  check('no line of anyone\'s runs past its box ' + how,
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
    d.bird.x = d.LANDS.glade.npc.x; d.bird.y = d.LANDS.glade.npc.y - 20;
    d.tapLand(0, 0);
    const opened = !!L().saying;
    while (L().saying) d.tapLand(0, 0);
    const beforeSeeds = L().opened;

    // Fetch the three seeds by flying into them.
    for (const sd of d.LANDS.glade.pickups.at) {
      d.bird.x = sd.x; d.bird.y = sd.y; d.bird.vx = 0; d.bird.vy = 0;
      d.tick();
    }
    const got = L().got.filter(Boolean).length;

    // And tell him.
    d.bird.x = d.LANDS.glade.npc.x; d.bird.y = d.LANDS.glade.npc.y - 20;
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

// --- through the brambles, and the whole loop -----------------------------
{
  const { context, page } = await fresh();
  const loop = await page.evaluate(() => {
    const d = __dreybird;
    const pr = d.active();
    pr.owned = []; pr.story.lands = {}; pr.story.flock = []; pr.story.flags = [];
    d.resetWorld(); d.enterLand('glade');

    // Shut, the east edge is a wall.
    d.land().opened = false;
    d.holdAt(d.W, 240);
    for (let i = 0; i < 200; i++) d.tick();
    const shutMode = d.G.mode, shutX = Math.round(d.bird.x);

    // Open, it is a door.
    d.land().opened = true;
    for (let i = 0; i < 200 && d.G.mode === 'explore'; i++) d.tick();
    d.letGo();
    const opened = d.G.mode;
    // Through the door the level waits for a tap, as a player would give one.
    d.press();

    // Fly the level. Held at the gap centre it can be flown honestly.
    const flyStage = () => {
      let guard = 0;
      while (!d.stage().won && guard++ < 20000) {
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0;
        d.tick();
      }
      return d.stage().won;
    };
    const won = flyStage();
    const scoreAtWin = d.G.score, target = d.stage().target;

    // Arriving is safe: driven into the ground, he survives.
    for (let i = 0; i < 200; i++) { d.bird.y = d.GY; d.bird.vy = 20; d.tick(); }
    const stillAlive = d.G.state !== d.states.OVER && d.G.state !== d.states.DYING;
    const done = d.stage().done;

    // Home again, into the glade that was waiting.
    d.press();
    const home = { mode: d.G.mode, at: d.land().id, saved: pr.story.at };

    return { shutMode, shutX, opened, won, scoreAtWin, target, stillAlive, done, home,
             owned: pr.owned.slice(), flock: pr.story.flock.slice() };
  });
  check('shut brambles keep him in the glade',
    loop.shutMode === 'explore' && loop.shutX < 288, JSON.stringify({ m: loop.shutMode, x: loop.shutX }));
  check('open brambles let him through to the pipe-land', loop.opened === 'stage', loop.opened);
  check('the level is won by arriving at its far end',
    loop.won && loop.scoreAtWin >= loop.target, loop.scoreAtWin + ' / ' + loop.target);
  check('and arriving is safe — the ground cannot take it back',
    loop.stillAlive && loop.done, JSON.stringify({ alive: loop.stillAlive, done: loop.done }));
  check('Bluebird joins the flock', loop.flock.join() === 'sky' && loop.owned.join() === 'bird:sky',
    JSON.stringify({ owned: loop.owned, flock: loop.flock }));
  check('and a tap carries him ONWARD, not back where he started',
    loop.home.mode === 'explore' && loop.home.at === 'bank',
    JSON.stringify(loop.home));
  await context.close();
}

// --- a passage goes somewhere; giving up goes back ------------------------
{
  const { context, page } = await fresh();
  const both = await page.evaluate(() => {
    const d = __dreybird;
    const pr = d.active();
    pr.story.lands = { glade: { got: [true, true, true], talked: 1, opened: true } };

    // Cleared: onward to the far side.
    d.resetWorld(); d.enterLand('glade');
    d.enterStage(d.STAGES.reeds); d.press();
    let g = 0;
    while (!d.stage().won && g++ < 20000) { if (d.pipes[0]) d.bird.y = d.pipes[0].gap; d.bird.vy = 0; d.tick(); }
    for (let i = 0; i < 200; i++) d.tick();
    d.press();
    const won = { at: d.land().id, saved: pr.story.at };

    // Given up on: back to the side he came from.
    d.resetWorld(); d.enterLand('glade');
    d.enterStage(d.STAGES.reeds); d.press();
    d.endRun();
    const quit = { at: d.land().id, saved: pr.story.at };

    // And the map lists where he actually is.
    pr.story.at = 'bank';
    d.resetWorld(); d.enterLand(pr.story.at);
    d.openMap();
    const rows = [...document.querySelectorAll('#map-body .land-row')];
    const hereRow = rows.find(r => r.querySelector('.here'));
    const resumed = hereRow ? hereRow.querySelector('.name').textContent : null;
    d.closeMap(false);
    return { won, quit, resumed };
  });
  check('clearing a passage puts him on the far side', both.won.at === 'bank',
    JSON.stringify(both.won));
  check('and the world remembers where he got to', both.won.saved === 'bank',
    both.won.saved);
  check('giving up returns him to the side he came from', both.quit.at === 'glade',
    JSON.stringify(both.quit));
  check('the map marks where he is, not always the start',
    both.resumed === 'THE FAR BANK', String(both.resumed));
  await context.close();
}

// --- dying in a level costs the attempt and nothing else ------------------
{
  const { context, page } = await fresh();
  const retry = await page.evaluate(() => {
    const d = __dreybird;
    const pr = d.active();
    pr.coins = 500; pr.xp = 1234; pr.story.lands = { glade: { got: [true, true, true], talked: 1, opened: true } };
    d.resetWorld(); d.enterLand('glade');
    const gladeBefore = JSON.stringify(d.land().got) + d.land().opened;
    d.enterStage(d.STAGES.reeds); d.press();
    const before = { coins: pr.coins, xp: pr.xp, games: pr.stats.games };

    // Fly a few pipes, then into the ground.
    for (let i = 0; i < 600 && d.G.score < 3; i++) {
      if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
      d.bird.vy = 0; d.tick();
    }
    d.bird.y = d.GY; d.bird.vy = 25;
    for (let i = 0; i < 300 && d.G.score > 0; i++) d.tick();

    const after = { coins: pr.coins, xp: pr.xp, games: pr.stats.games };

    /* Fallen, and WAITING. It used to restart here silently, which made a
       death and a retry indistinguishable and turned the level into a loop
       with no way out. Ticking on must leave it exactly where it is. */
    const fellAt = { failed: d.stage().failed, reached: d.stage().reached,
                     at: d.stage().failedAt };
    for (let i = 0; i < 300; i++) d.tick();
    /* The score not moving is too weak: it stayed put while the bird was
       still being ticked in DYING and the fall re-registered every frame.
       A frozen level means the moment it was lost stops moving too. */
    const stillWaiting = d.stage().failed && d.G.score === fellAt.reached &&
                         d.stage().failedAt === fellAt.at;

    // And a tap is what starts it again, from the first pipe.
    d.press();
    const retried = d.G.mode === 'stage' && !d.stage().failed && d.G.score === 0;

    d.resetWorld(); d.enterLand('glade');
    const gladeAfter = JSON.stringify(d.land().got) + d.land().opened;
    return { before, after, fellAt, stillWaiting, retried, gladeBefore, gladeAfter };
  });
  check('dying in a level says so and waits, rather than looping in silence',
    retry.fellAt.failed && retry.stillWaiting,
    JSON.stringify({ ...retry.fellAt, stillWaiting: retry.stillWaiting }));
  check('and a tap starts it again from the first pipe', retry.retried, String(retry.retried));
  check('and costs nothing — coins, XP and games are untouched',
    retry.before.coins === retry.after.coins && retry.before.xp === retry.after.xp &&
    retry.before.games === retry.after.games, JSON.stringify(retry));
  check('the glade is exactly where it was left',
    retry.gladeBefore === retry.gladeAfter, retry.gladeBefore + ' vs ' + retry.gladeAfter);
  await context.close();
}

// --- there is always a way out of a level ---------------------------------
// The failure this replaces was "you cannot stop", so these checks try to
// leave rather than trusting that leaving is possible.
{
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const d = __dreybird;
    d.active().story.lands = { glade: { got: [true, true, true], talked: 1, opened: true } };
    d.resetWorld(); d.enterLand('glade');
    d.enterStage(d.STAGES.reeds); d.press();
    // Fall.
    d.bird.y = d.GY; d.bird.vy = 25;
    for (let i = 0; i < 200 && !d.stage().failed; i++) d.tick();
  });
  const fallen = await page.evaluate(() => !!__dreybird.stage().failed);
  check('the level can be failed on purpose', fallen === true);

  // Every control has to be reachable, or the exit is theoretical.
  const bar = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.iconbtn')]
      .filter(b => b.offsetParent !== null)
      .map(b => ({ id: b.id, r: b.getBoundingClientRect() }));
    const blocked = btns.filter(b => {
      const el = document.elementFromPoint(b.r.left + b.r.width / 2, b.r.top + b.r.height / 2);
      return !el || !(el.id === b.id || el.closest('.iconbtn') === document.getElementById(b.id));
    }).map(b => b.id);
    const faded = btns.filter(b => parseFloat(getComputedStyle(
      document.getElementById(b.id)).opacity) < 0.9).map(b => b.id);
    return { count: btns.length, blocked, faded };
  });
  check('the controls are live and reachable while fallen',
    bar.blocked.length === 0 && bar.faded.length === 0 && bar.count >= 5,
    JSON.stringify(bar));

  // The map button is the way home, clicked for real -- and it opens a map,
  // so the way home is two taps: the button, then the land.
  await page.click('#btn-world', { timeout: 3000 });
  const held = await page.evaluate(() => {
    const d = __dreybird;
    const t0 = d.G.ticks, f0 = d.stage().failedAt;
    for (let i = 0; i < 30; i++) d.tick();
    return { open: !document.getElementById('map').hidden, paused: d.G.paused,
             ticksMoved: d.G.ticks - t0, fallMoved: d.stage().failedAt - f0 };
  });
  check('the map opens over a fallen level and holds it still',
    held.open && held.paused && held.ticksMoved === 0 && held.fallMoved === 0,
    JSON.stringify(held));
  await page.click('#map-close', { timeout: 3000 });
  const resumed = await page.evaluate(() => ({ paused: __dreybird.G.paused, mode: __dreybird.G.mode }));
  check('and Back resumes it', resumed.paused === false && resumed.mode === 'stage',
    JSON.stringify(resumed));
  await page.click('#btn-world', { timeout: 3000 });
  await page.click('#map-body .land-row:not(.unknown)', { timeout: 3000 });
  const home = await page.evaluate(() => {
    const d = __dreybird;
    // Arriving is not enough: the land has to be ALIVE. The map paused the
    // level behind it, and a travel that forgot to lift that left the glade
    // frozen with Pause refusing to open -- while this very check was green,
    // because it only asked where he was.
    const t0 = d.G.ticks, y0 = d.bird.y;
    d.holdAt(200, 100); for (let i = 0; i < 30; i++) d.tick(); d.letGo();
    return { mode: d.G.mode, id: d.land() ? d.land().id : null,
             opened: d.land() ? d.land().opened : null,
             got: d.land() ? d.land().got.filter(Boolean).length : -1,
             paused: d.G.paused, ticksMoved: d.G.ticks - t0, moved: Math.abs(d.bird.y - y0) > 1 };
  });
  check('choosing a land on the map leaves the level for it, exactly as it was',
    home.mode === 'explore' && home.id === 'glade' && home.opened === true && home.got === 3,
    JSON.stringify(home));
  check('and the land he arrives in is alive, not paused behind the closed map',
    home.paused === false && home.ticksMoved > 0 && home.moved === true,
    JSON.stringify({ paused: home.paused, ticksMoved: home.ticksMoved, moved: home.moved }));

  // The other way out of a held level is Free flight; it must not hand over
  // a frozen title screen either.
  await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.enterStage(d.STAGES.reeds); d.press();
    for (let i = 0; i < 400 && !d.stage().failed; i++) d.tick();
  });
  await page.click('#btn-world', { timeout: 3000 });
  await page.click('#map-free', { timeout: 3000 });
  const free = await page.evaluate(() => {
    const d = __dreybird;
    const t0 = d.G.ticks; for (let i = 0; i < 30; i++) d.tick();
    return { paused: d.G.paused, ready: d.G.state === d.states.READY, ticksMoved: d.G.ticks - t0 };
  });
  check('Free flight from a held level hands over a live title screen',
    free.paused === false && free.ready && free.ticksMoved > 0, JSON.stringify(free));
  await context.close();
}

// --- pausing offers to leave, and leaving lands in the glade -------------
{
  const { context, page } = await fresh();
  const quit = await page.evaluate(() => {
    const d = __dreybird;
    d.active().story.lands = { glade: { got: [true, true, true], talked: 1, opened: true } };
    d.resetWorld(); d.enterLand('glade');
    d.enterStage(d.STAGES.reeds); d.press();
    d.pauseRun();
    const label = document.getElementById('paused-quit').textContent;
    d.endRun();
    return { label, mode: d.G.mode, opened: d.land() ? d.land().opened : null };
  });
  check('pause offers to leave the level, not to end a run',
    /glade/i.test(quit.label), quit.label);
  check('and leaving lands in the glade rather than the endless title',
    quit.mode === 'explore' && quit.opened === true, JSON.stringify(quit));
  await context.close();
}

// --- a level announces itself -------------------------------------------
{
  const { context, page } = await fresh();
  const titled = await page.evaluate(() => {
    const d = __dreybird;
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const scale = cv.width / d.W;
    const row = () => {
      d.frame(performance.now() + 1);
      return Array.from(g.getImageData(0, Math.round(150 * scale), cv.width, 1).data).join(',');
    };
    d.resetWorld(); d.enterStage(d.STAGES.reeds); d.press();
    const announced = row();
    // Long enough for the card to have gone.
    for (let i = 0; i < 200; i++) { if (d.pipes[0]) d.bird.y = d.pipes[0].gap; d.bird.vy = 0; d.tick(); }
    const after = row();
    return { differs: announced !== after };
  });
  check('the level names itself on arrival, on the canvas', titled.differs);
  await context.close();
}

// --- rescuing twice does not hand out two birds --------------------------
{
  const { context, page } = await fresh();
  const twice = await page.evaluate(() => {
    const d = __dreybird;
    const pr = d.active();
    pr.owned = []; pr.story.flock = []; pr.story.flags = [];
    const clear = () => {
      d.resetWorld(); d.enterStage(d.STAGES.reeds); d.press();
      let guard = 0;
      while (!d.stage().won && guard++ < 20000) {
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0; d.tick();
      }
    };
    clear(); const first = pr.owned.slice();
    clear(); const second = pr.owned.slice();
    return { first, second, flock: pr.story.flock.slice(),
             flags: pr.story.flags.slice() };
  });
  check('clearing a level twice adds exactly one bird',
    twice.first.length === 1 && twice.second.length === 1 &&
    twice.flock.length === 1 && twice.flags.length === 1, JSON.stringify(twice));
  await context.close();
}

// --- a level does not disturb how the world is generated -----------------
{
  const { context, page } = await fresh();
  const seedSafe = await page.evaluate(() => {
    const d = __dreybird;
    const run = () => {
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
    };
    const clean = run();
    // A whole level in between, hazard knob and all.
    d.resetWorld(); d.enterStage(d.STAGES.reeds); d.press();
    for (let i = 0; i < 400; i++) { if (d.pipes[0]) d.bird.y = d.pipes[0].gap; d.bird.vy = 0; d.tick(); }
    d.resetWorld();
    const after = run();
    return { same: clean === after, hazardMul: d.G.hazardMul, n: clean.length };
  });
  check('free mode still builds the same world after a level',
    seedSafe.same && seedSafe.n > 10, 'hazardMul back to ' + seedSafe.hazardMul);
  await context.close();
}

// --- west is a door where a land declares one --------------------------
{
  const { context, page } = await fresh();
  const back = await page.evaluate(() => {
    const d = __dreybird;
    const pr = d.active();
    pr.story.lands = { glade: { got: [true, false, true], talked: 1, opened: false } };
    d.resetWorld(); d.enterLand('bank');
    d.holdAt(0, 240);
    for (let i = 0; i < 300 && d.G.mode === 'explore' && d.land().id === 'bank'; i++) d.tick();
    d.letGo();
    const arrived = { id: d.land().id, got: d.land().got.slice(), x: Math.round(d.bird.x) };
    // And from the glade, west is still the edge of the world.
    d.holdAt(0, 240);
    for (let i = 0; i < 300; i++) d.tick();
    d.letGo();
    return { arrived, still: d.land().id, x: Math.round(d.bird.x) };
  });
  check('flying west from the Bank puts him in the Glade, exactly as he left it',
    back.arrived.id === 'glade' && back.arrived.got.join() === 'true,false,true' && back.arrived.x > 200,
    JSON.stringify(back.arrived));
  check('and west of the Glade is still the edge', back.still === 'glade' && back.x < 30,
    JSON.stringify({ still: back.still, x: back.x }));
  await context.close();
}

// --- the map tells the truth --------------------------------------------
{
  const { context, page } = await fresh();
  const truth = await page.evaluate(() => {
    const d = __dreybird;
    const pr = d.active();
    pr.story.at = 'bank'; pr.story.flock = ['sky'];
    pr.story.flags = ['cleared:reeds'];
    pr.story.lands = { glade: { got: [true, true, true], talked: 1, opened: true } };
    d.resetWorld(); d.enterLand('bank');
    d.openMap();
    const rows = [...document.querySelectorAll('#map-body .land-row')].map(r => ({
      name: r.querySelector('.name').textContent, note: r.querySelector('.req').textContent,
      here: !!r.querySelector('.here'), disabled: r.disabled }));
    const passages = [...document.querySelectorAll('#map-body .passage')].map(p => p.textContent);
    const flock = document.querySelector('#map-body .sheet-section').textContent;
    const previews = [...document.querySelectorAll('#map-body .flock canvas')].map(c => {
      const g = c.getContext('2d');
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
      return lit;
    });
    d.closeMap(false);
    return { rows, passages, flock, previews };
  });
  const byName = n => truth.rows.find(r => r.name === n);
  check('the land he is in reads here', byName('THE FAR BANK') && byName('THE FAR BANK').here);
  check('a land not yet reached is hidden and cannot be tapped',
    truth.rows.some(r => r.name === '?????' && r.disabled && r.note === 'not yet'),
    JSON.stringify(truth.rows));
  check('a cleared passage says so, and an uncleared one does not',
    /Reeds.*cleared/i.test(truth.passages[0]) && /Narrows.*not yet/i.test(truth.passages[1]),
    JSON.stringify(truth.passages));
  check('the flock count is the flock, Classic included', /2 OF 12/.test(truth.flock), truth.flock);
  check('and the found birds are real pixels, not empty canvases',
    truth.previews.length === 2 && truth.previews.every(n => n > 50),
    JSON.stringify(truth.previews));
  await context.close();
}

// --- the map is opened by its button, and goes places -------------------
{
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const d = __dreybird;
    d.active().story.at = 'kiln';
    d.active().story.lands = { glade: { got: [true, true, true], talked: 1, opened: true },
                               bank: { got: [true, true, true], talked: 1, opened: true } };
    d.resetWorld(); d.enterLand('kiln');
  });
  await page.click('#btn-world', { timeout: 3000 });
  const open = await page.evaluate(() => !document.getElementById('map').hidden);
  check('clicking the map button opens the map', open === true);
  // Tap the Glade: three lands back, no level to re-fly.
  await page.click('#map-body .land-row:not(.unknown)', { timeout: 3000 });
  const went = await page.evaluate(() => ({ mode: __dreybird.G.mode, id: __dreybird.land().id }));
  check('tapping a visited land goes there directly',
    went.mode === 'explore' && went.id === 'glade', JSON.stringify(went));
  await page.click('#btn-world', { timeout: 3000 });
  await page.click('#map-free', { timeout: 3000 });
  const free = await page.evaluate(() => ({ mode: __dreybird.G.mode, x: __dreybird.bird.x }));
  check('and Free flight reaches the endless game with the fixed-x bird',
    free.mode === 'free' && free.x === 64, JSON.stringify(free));
  await context.close();
}

// --- the README sends people to this game, not the other one ------------
{
  const { readFile } = await import('node:fs/promises');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  check('the README does not point at the classic game\'s address',
    readme.indexOf('github.io/DreyBird') < 0 && readme.indexOf('github.io/dreybirds-world') >= 0);
}

// --- a level waits for the first tap, like the title screen does --------
// The door used to drop him from rest with no flap: the ground had him at
// tick 44, before the first pipe or the end of the title, and the retry tap
// did the same. These do what a player does and check what a player sees.
{
  const { context, page } = await fresh();
  const r = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.enterLand('glade'); d.enterStage(d.STAGES.reeds);
    const y0 = d.bird.y, px0 = d.pipes[0].x;
    for (let i = 0; i < 300; i++) d.tick();
    const waited = { failed: d.stage().failed, drift: Math.round(Math.abs(d.bird.y - y0)),
                     pipeMoved: d.pipes[0].x !== px0, runTicks: d.G.runTicks };
    d.press();
    const vy = d.bird.vy;
    for (let i = 0; i < 10; i++) d.tick();
    const flying = { vy, runTicks: d.G.runTicks, pipeMoved: d.pipes[0].x !== px0 };
    for (let i = 0; i < 400 && !d.stage().failed; i++) d.tick();
    const fell = d.stage().failed;
    d.press();                               // the retry tap
    for (let i = 0; i < 300; i++) d.tick();  // ...and then nothing, for five seconds
    const retry = { failed: d.stage().failed, waiting: d.stage().ready === true };
    return { waited, flying, fell, retry };
  });
  check('a level waits for the first tap: nothing moves and nothing can kill him',
    !r.waited.failed && r.waited.drift < 8 && !r.waited.pipeMoved && r.waited.runTicks === 0,
    JSON.stringify(r.waited));
  check('the first tap starts it with a flap',
    r.flying.vy < 0 && r.flying.runTicks === 10 && r.flying.pipeMoved, JSON.stringify(r.flying));
  check('after a fall the retry tap brings the wait back, not another fall',
    r.fell && !r.retry.failed && r.retry.waiting, JSON.stringify(r.retry));

  const words = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.enterLand('glade'); d.enterStage(d.STAGES.reeds);
    const seen = new Set(), orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s) { seen.add(String(s)); return orig.apply(this, arguments); };
    d.frame(performance.now());
    const waiting = [...seen].filter(x => /FLY|REEDS/.test(x));
    seen.clear();
    d.press(); for (let i = 0; i < 130; i++) d.tick();
    d.frame(performance.now() + 2200);
    CanvasRenderingContext2D.prototype.fillText = orig;
    return { waiting, after: [...seen].filter(x => /FLY|REEDS/.test(x)) };
  });
  check('and the screen says TAP TO FLY until the tap, then the card is gone',
    words.waiting.some(x => /TAP TO FLY/.test(x)) && words.waiting.some(x => /THE REEDS/.test(x)) &&
    !words.after.some(x => /TAP TO FLY|THE REEDS/.test(x)),
    JSON.stringify(words));
  await context.close();
}

// --- every pipe in a level is the level's width -------------------------
// The first three pipes of every level were the endless game's 104, because
// the level's gap was applied after they had been spawned.
{
  const { context, page } = await fresh();
  const gaps = await page.evaluate(() => {
    const d = __dreybird, out = {};
    for (const id of Object.keys(d.STAGES)) {
      const st = d.STAGES[id];
      d.resetWorld(); d.enterLand(st.from); d.enterStage(st); d.press();
      const hs = new Set(d.pipes.map(p => p.h));
      let g = 0;
      while (!d.stage().won && g++ < 20000) {
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0; d.tick();
        for (const q of d.pipes) hs.add(q.h);
      }
      out[id] = { want: st.gap, seen: [...hs] };
    }
    d.active().assist = true;
    d.resetWorld(); d.enterLand('glade'); d.enterStage(d.STAGES.reeds); d.press();
    out.assist = { want: d.STAGES.reeds.gap, seen: [...new Set(d.pipes.map(p => p.h))] };
    d.active().assist = false;
    return out;
  });
  const exact = k => gaps[k].seen.length === 1 && gaps[k].seen[0] === gaps[k].want;
  check("every pipe in a level is the level's width, the first three included",
    Object.keys(gaps).filter(k => k !== 'assist').every(exact), JSON.stringify(gaps));
  check('and assist does not widen a level: it is as wide as it was designed',
    exact('assist'), JSON.stringify(gaps.assist));
  await context.close();
}

// --- the rescue is real: a found bird can be flown ------------------------
// The arrival card said "you can fly as Bluebird from now on" while the shop
// kept him behind "Reach a best of 5". A story-only player has a best of 0
// forever, so the campaign's one reward was inert.
{
  const { context, page } = await fresh();
  const r = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    pr.best = 0; d.G.best = 0;
    const sky = d.SKINS.find(b => b.id === 'sky');
    const before = d.available(sky);
    d.resetWorld(); d.enterLand('glade'); d.enterStage(d.STAGES.reeds); d.press();
    let g = 0;
    while (!d.stage().won && g++ < 20000) { if (d.pipes[0]) d.bird.y = d.pipes[0].gap; d.bird.vy = 0; d.tick(); }
    for (let i = 0; i < 200; i++) d.tick();
    d.press();                                   // onward, to the bank
    const after = d.available(sky);
    d.setTab('bird');
    const card = document.querySelector('.card[data-item="sky"]');
    const shop = { disabled: card ? card.disabled : null, text: card ? card.textContent : null };
    if (card) card.click();
    return { best: pr.best, before, after, shop, skin: pr.skin };
  });
  check('a rescued bird can be flown at a best of 0',
    r.best === 0 && r.before === false && r.after === true, JSON.stringify({ best: r.best, before: r.before, after: r.after }));
  check('and the shop says so: the card is live and reads Tap to equip',
    r.shop.disabled === false && /Tap to equip/.test(r.shop.text || ''), JSON.stringify(r.shop));
  check('and tapping it equips him', r.skin === 'sky', String(r.skin));
  await context.close();
}

// --- the map counts what the shop lets you fly ----------------------------
// It counted story.flock.length over a row that also lit Classic, so a new
// player read "0 OF 12" above one lit bird, a bought bird never counted, and
// a full flock would have read "11 OF 12".
{
  const { context, page } = await fresh();
  const m = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    const count = () => {
      d.openMap();
      const t = document.querySelector('#map-body .sheet-section').textContent;
      const lit = document.querySelectorAll('#map-body .flock canvas').length;
      d.closeMap(false);
      return { t, lit };
    };
    const start = count();
    pr.owned.push('bird:mint');                  // bought in the shop
    const bought = count();
    pr.best = 5; d.G.best = 5;                   // Bluebird by score, in free flight
    const scored = count();
    return { start, bought, scored };
  });
  check('a new map counts the one bird it lights', /1 OF 12/.test(m.start.t) && m.start.lit === 1, JSON.stringify(m.start));
  check('a bought bird counts, and lights', /2 OF 12/.test(m.bought.t) && m.bought.lit === 2, JSON.stringify(m.bought));
  check('a score-unlocked bird counts, and lights', /3 OF 12/.test(m.scored.t) && m.scored.lit === 3, JSON.stringify(m.scored));
  await context.close();
}

// --- a flock of strangers reveals nothing ---------------------------------
// A hand-edited save could put any string in the flock: it padded the count,
// and a bird that named a land's roost revealed that land on the map with
// the passage to it never flown.
{
  const { context, page } = await fresh();
  const s = await page.evaluate(() => {
    const d = __dreybird;
    const payload = JSON.parse(JSON.stringify(d.exportSave()));
    payload.profiles[0].story.flock = ['ember', 'nonsense'];
    const res = d.importSave(payload);
    const flock = d.active().story.flock.slice();
    d.openMap();
    const rows = [...document.querySelectorAll('#map-body .land-row')].map(r => r.querySelector('.name').textContent);
    const count = document.querySelector('#map-body .sheet-section').textContent;
    d.closeMap(false);
    return { ok: !!(res && res.ok), flock, rows, count };
  });
  check('an imported flock keeps only birds the game has', s.ok && s.flock.indexOf('nonsense') < 0 && s.flock.indexOf('ember') >= 0, JSON.stringify(s.flock));
  check('and a bird in the flock does not open the map to its land', s.rows.indexOf('THE KILN') < 0 && s.rows.some(n => n === '?????'), JSON.stringify(s.rows));
  await context.close();
}

// --- a land names itself on arrival -----------------------------------------
// The title block lived in the tap handler and drew for one frame, if at all.
{
  const { context, page } = await fresh();
  const named = await page.evaluate(() => {
    const d = __dreybird;
    const seen = new Set(), orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s) { seen.add(String(s)); return orig.apply(this, arguments); };
    d.resetWorld(); d.enterLand('bank');
    d.frame(performance.now());
    const arriving = [...seen];
    seen.clear();
    for (let i = 0; i < 200; i++) d.tick();
    d.frame(performance.now() + 3400);
    const later = [...seen];
    CanvasRenderingContext2D.prototype.fillText = orig;
    return { arriving, later };
  });
  check('a land shows its name on arrival', named.arriving.indexOf('THE FAR BANK') >= 0, JSON.stringify(named.arriving));
  check('and the card is gone a few seconds later', named.later.indexOf('THE FAR BANK') < 0, JSON.stringify(named.later));
  await context.close();
}

// --- the level's copy names the right places -------------------------------
// "the reeds" and "the glade" were literals, so the Narrows told the player
// Ember was found in the reeds and that the glade was behind him, and the
// pause button said "Back to the glade" while delivering him to the Bank.
{
  const { context, page } = await fresh();
  const words = await page.evaluate(() => {
    const d = __dreybird;
    const hook = () => { const seen = new Set(), orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (s) { seen.add(String(s)); return orig.apply(this, arguments); };
      return () => { CanvasRenderingContext2D.prototype.fillText = orig; return [...seen].join(' | '); }; };
    d.resetWorld(); d.enterLand('bank'); d.enterStage(d.STAGES.narrows); d.press();
    for (let i = 0; i < 400 && !d.stage().failed; i++) d.tick();
    for (let i = 0; i < 30; i++) d.tick();
    let done = hook(); d.frame(performance.now() + 5000); const fallen = done();
    d.pauseRun();
    const quit = document.getElementById('paused-quit').textContent;
    const note = document.getElementById('paused-note').textContent;
    d.endRun();
    const where = d.land().id;
    d.resetWorld(); d.startPlay(); d.pauseRun();
    const freeQuit = document.getElementById('paused-quit').textContent;
    const freeNote = document.getElementById('paused-note').textContent;
    d.resumeRun(); d.resetWorld();
    // and the arrival card, after the Narrows are flown
    d.enterLand('bank'); d.enterStage(d.STAGES.narrows); d.press();
    let g = 0;
    while (!d.stage().won && g++ < 20000) { if (d.pipes[0]) d.bird.y = d.pipes[0].gap; d.bird.vy = 0; d.tick(); }
    for (let i = 0; i < 200; i++) d.tick();
    done = hook(); d.frame(performance.now() + 9000); const arrived = done();
    return { fallen, quit, note, where, freeQuit, freeNote, arrived };
  });
  check('fallen in the Narrows, the panel names the Far Bank, not the glade',
    /far bank/i.test(words.fallen) && !/glade/i.test(words.fallen), words.fallen.slice(0, 200));
  check('and the pause sheet offers the Far Bank and delivers it',
    words.quit === 'Back to the far bank' && /far bank/i.test(words.note) && words.where === 'bank',
    JSON.stringify({ quit: words.quit, where: words.where }));
  check('and a free-flight pause afterwards reads End run again',
    words.freeQuit === 'End run' && /exactly where you left it/.test(words.freeNote),
    JSON.stringify({ quit: words.freeQuit, note: words.freeNote }));
  check('arriving through the Narrows, the card says where Ember was found',
    /THE NARROWS/.test(words.arrived) && /the narrows\./i.test(words.arrived) && !/reeds/i.test(words.arrived),
    words.arrived.slice(0, 240));
  await context.close();
}

// --- a level pins its own sky, and gives the player's back --------------
// enterStage wrote the level's phase into G.bg, the player's setting, and
// nothing restored it: after any level the endless game's sky stayed frozen
// at that phase and the shop highlighted the wrong swatch.
{
  const { context, page } = await fresh();
  const sky = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    const st = d.STAGES.narrows;
    d.G.bg = st.bg; const ref = d.phaseNow().sky0;
    pr.bg = 'cycle'; d.G.bg = 'cycle';
    d.resetWorld(); d.enterLand('bank'); d.enterStage(st); d.press();
    const a = d.phaseNow().sky0;
    for (let i = 0; i < 600; i++) d.tick();
    const b = d.phaseNow().sky0;
    d.leaveStage(); d.resetWorld();
    return { pinned: a === ref && b === ref, bg: d.G.bg, saved: pr.bg };
  });
  check('a level pins its own sky for the whole flight', sky.pinned, JSON.stringify(sky));
  check('and leaving it hands the player back their own sky', sky.bg === 'cycle' && sky.saved === 'cycle', JSON.stringify(sky));
  await context.close();
}

// --- the title says where the story is, until the glade has been seen -----
// Nothing on the title screen said where the campaign was. The map button
// is unlabelled, top left, and a new player had no reason to press it.
{
  const { context, page } = await fresh();
  const hint = await page.evaluate(() => {
    const d = __dreybird;
    const words = () => {
      const seen = new Set(), orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (s) { seen.add(String(s)); return orig.apply(this, arguments); };
      d.frame(performance.now() + 100);
      CanvasRenderingContext2D.prototype.fillText = orig;
      return [...seen].join(' | ');
    };
    const stage = document.getElementById('stage');
    d.resetWorld();
    const before = words(), pulse = stage.dataset.hint;
    d.enterLand('glade'); d.resetWorld();
    const after = words(), pulseAfter = stage.dataset.hint;
    return { before, pulse, after, pulseAfter, flags: d.active().story.flags.slice() };
  });
  check('a new player is told where the story is, and the map button beckons',
    /TAP THE MAP/.test(hint.before) && hint.pulse === '1', JSON.stringify({ text: hint.before.slice(0, 160), pulse: hint.pulse }));
  check('and once the glade has been seen the line retires and the button rests',
    !/TAP THE MAP/.test(hint.after) && hint.pulseAfter === '0' && hint.flags.indexOf('seen:glade') >= 0,
    JSON.stringify({ text: hint.after.slice(0, 160), pulse: hint.pulseAfter, flags: hint.flags }));

  const taught = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    pr.taught = false;
    d.resetWorld(); d.enterLand('glade'); d.enterStage(d.STAGES.reeds); d.press();
    let g = 0;
    while (!d.stage().won && g++ < 20000) { if (d.pipes[0]) d.bird.y = d.pipes[0].gap; d.bird.vy = 0; d.tick(); }
    return pr.taught;
  });
  check('clearing a level retires the flap lesson for a story-only player', taught === true, String(taught));
  await context.close();
}

// --- the map names only what he has heard of, and says what a row does -----
{
  const { context, page } = await fresh();
  const map = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    pr.story = { at: 'glade', flags: ['seen:glade'], flock: [], lands: {} };
    d.resetWorld(); d.openMap();
    const passages = [...document.querySelectorAll('#map-body .passage')].map(p => p.textContent);
    d.closeMap(false);
    pr.story = { at: 'bank', flags: ['seen:glade', 'seen:bank', 'cleared:reeds'], flock: ['sky'],
                 lands: { glade: { got: [true, true, true], talked: 1, opened: true } } };
    d.resetWorld(); d.enterLand('bank'); d.openMap();
    const rows = [...document.querySelectorAll('#map-body .land-row')].map(r => r.textContent);
    d.closeMap(false);
    return { passages, rows };
  });
  check('a passage is named once its near side has been reached, and not before',
    /THE REEDS/.test(map.passages[0]) && /\?\?\?\?\?/.test(map.passages[1]) && !/NARROWS/.test(map.passages[1]),
    JSON.stringify(map.passages));
  check('a row he can tap says so, and the row he is on does not',
    map.rows.some(r => /THE GLADE.*tap to go/.test(r)) && map.rows.some(r => /THE FAR BANK/.test(r) && /here/.test(r) && !/tap to go/.test(r)),
    JSON.stringify(map.rows));
  await context.close();
}

// --- the end of the world is a card that counts the flock ------------------
// The Kiln ended the world with a 7px notice and one perched bird.
{
  const { context, page } = await fresh();
  const kiln = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    const cv = document.getElementById('game'), g = cv.getContext('2d'), scale = cv.width / d.W;
    const look = () => {
      const seen = new Set(), orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (s) { seen.add(String(s)); return orig.apply(this, arguments); };
      d.frame(performance.now() + 200);
      CanvasRenderingContext2D.prototype.fillText = orig;
      // The strip the found birds are drawn in. Wide enough that nudging
      // the card a few pixels does not need this number edited.
      const band = g.getImageData(0, Math.round(196 * scale), cv.width, Math.round(40 * scale)).data;
      return { text: [...seen].join(' | '), band };
    };
    const at = flock => { pr.story.flock = flock; d.resetWorld(); d.enterLand('kiln'); for (let i = 0; i < 120; i++) d.tick(); return look(); };
    const one = at([]), three = at(['sky', 'ember']);
    let diff = 0;
    for (let i = 0; i < one.band.length; i += 4) if (one.band[i] !== three.band[i] || one.band[i + 1] !== three.band[i + 1] || one.band[i + 2] !== three.band[i + 2]) diff++;
    return { one: one.text, three: three.text, diff };
  });
  check('the Kiln counts the flock that is home',
    /1 OF 12 ARE HOME/.test(kiln.one) && /3 OF 12 ARE HOME/.test(kiln.three) && !/WORLD ENDS HERE/.test(kiln.three),
    JSON.stringify({ one: kiln.one.slice(0, 120), three: kiln.three.slice(0, 120) }));
  check('and draws the birds that are home, in pixels', kiln.diff > 100, String(kiln.diff));
  await context.close();
}

// --- the thumb is taught, the tap answers, and the text can be read -------
{
  const { context, page } = await fresh();
  const r = await page.evaluate(() => {
    const d = __dreybird, pr = d.active();
    const drawn = () => {
      const out = [], orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (s, x, y) { out.push({ t: String(s), y, font: this.font }); return orig.apply(this, arguments); };
      d.frame(performance.now() + 100);
      CanvasRenderingContext2D.prototype.fillText = orig;
      return out;
    };
    const has = (list, re) => list.some(e => re.test(e.t));
    pr.story.flags = pr.story.flags.filter(f => f !== 'seen:hold');
    d.resetWorld(); d.enterLand('glade');
    const arriving = drawn();
    // Standing beside Thistle: the lesson must survive the talk prompt.
    const n = d.NPCS.thistle; const spot = d.LANDS.glade.npc;
    d.bird.x = spot.x; d.bird.y = spot.y - 20;
    const beside = drawn();
    // A second and a half of holding, and it is learned for good.
    d.holdAt(200, 120); for (let i = 0; i < 100; i++) d.tick(); d.letGo();
    const after = drawn();
    d.resetWorld(); d.enterLand('bank');
    const elsewhere = drawn();
    // A tap in open air answers.
    d.bird.x = 200; d.bird.y = 120; d.bird.wing = 0;
    d.tapLand(200, 120);
    const wing = d.bird.wing;
    // The HUD sits below the button row (which ends near y 38).
    const hud = elsewhere.find(e => /RINGS/.test(e.t));
    // Speech paints at 7px, its prompt at 6.
    d.resetWorld(); d.enterLand('glade');
    d.bird.x = spot.x; d.bird.y = spot.y - 20; d.tapLand(0, 0);
    const talking = drawn();
    const speech = talking.filter(e => /roots/.test(e.t))[0];
    const prompt = talking.find(e => /TAP TO GO ON|TAP TO CLOSE/.test(e.t));
    return { arriving: has(arriving, /HOLD TO FLY/), beside: has(beside, /HOLD TO FLY/) && has(beside, /TAP TO TALK/),
             after: has(after, /HOLD TO FLY/), flag: pr.story.flags.indexOf('seen:hold') >= 0,
             elsewhere: has(elsewhere, /HOLD TO FLY/), wing, hudY: hud ? hud.y : null,
             speechFont: speech ? speech.font : null, promptFont: prompt ? prompt.font : null };
  });
  check('HOLD TO FLY shows on arrival and survives standing beside Thistle',
    r.arriving && r.beside, JSON.stringify({ arriving: r.arriving, beside: r.beside }));
  check('and a second and a half of holding retires it, everywhere, for good',
    !r.after && r.flag && !r.elsewhere, JSON.stringify({ after: r.after, flag: r.flag, elsewhere: r.elsewhere }));
  check('a tap in open air flicks the wing', r.wing === 9, String(r.wing));
  check('the land HUD sits below the button row', r.hudY != null && r.hudY >= 56, String(r.hudY));
  check('speech paints at 7px and its prompt at 6px',
    /^7px/.test(r.speechFont || '') && /^6px/.test(r.promptFont || ''), JSON.stringify({ speech: r.speechFont, prompt: r.promptFont }));
  await context.close();
}

// --- a door asks for a fresh press ------------------------------------------
// A thumb resting near the bezel chained Kiln to Bank to Glade in under two
// seconds, with no arrival beat in between.
{
  const { context, page } = await fresh();
  const r = await page.evaluate(() => {
    const d = __dreybird;
    d.resetWorld(); d.enterLand('kiln');
    d.holdAt(2, 240);
    const path = [];
    for (let i = 0; i < 300; i++) { d.tick(); const id = d.land().id; if (path[path.length - 1] !== id) path.push(id); }
    const xs = Math.round(d.bird.x);
    // A fresh press carries on.
    d.holdAt(2, 240);
    for (let i = 0; i < 300; i++) d.tick();
    return { path, xs, then: d.land().id };
  });
  check('a held thumb takes him through one door and then waits',
    r.path.join() === 'kiln,bank' && r.xs > 200, JSON.stringify({ path: r.path, x: r.xs }));
  check('and a fresh press carries on west', r.then === 'glade', r.then);
  await context.close();
}

// --- the keyboard is a thumb too, and Space is a tap in a land -------------
{
  const { context, page } = await fresh();
  const k = await page.evaluate(() => {
    const d = __dreybird;
    const key = (type, code) => document.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    d.resetWorld(); d.enterLand('glade');
    const x0 = d.bird.x;
    key('keydown', 'ArrowRight'); for (let i = 0; i < 60; i++) d.tick(); key('keyup', 'ArrowRight');
    const right = d.bird.x - x0, heldAfter = d.G.paused === false && d.land() ? (d.bird.vx !== 0) : null;
    const y0 = d.bird.y;
    key('keydown', 'KeyW'); for (let i = 0; i < 60; i++) d.tick(); key('keyup', 'KeyW');
    const up = y0 - d.bird.y;
    // Space is not a flap here...
    d.bird.vy = 0; key('keydown', 'Space'); const vy = d.bird.vy;
    // ...it is a tap: beside Thistle it starts the talk.
    const spot = d.LANDS.glade.npc; d.bird.x = spot.x; d.bird.y = spot.y - 20;
    key('keydown', 'Space');
    return { right, up, vy, talking: !!d.land().saying };
  });
  check('arrows and WASD steer him in a land', k.right > 20 && k.up > 20, JSON.stringify({ right: Math.round(k.right), up: Math.round(k.up) }));
  check('Space in a land is a tap, not a flap: no impulse, and it talks to Thistle',
    k.vy === 0 && k.talking, JSON.stringify({ vy: k.vy, talking: k.talking }));
  await context.close();
}

// --- sound starts on the story path ------------------------------------------
// Only press() woke the audio, and a land's tap handler skipped press().
{
  const { context, page } = await fresh();
  const before = await page.evaluate(() => { const d = __dreybird; d.resetWorld(); d.enterLand('glade'); return d.audio.ctx === null || d.audio.ctx === undefined; });
  const box = await page.locator('#game').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.3);
  // Looked at between finger-down and finger-up: the release is a gesture
  // too, and an open-air tap's pop would create the context there anyway.
  // Only the wake on pointerdown has it awake THIS early.
  await page.mouse.down();
  const down = await page.evaluate(() => { const d = __dreybird; return { ctx: !!d.audio.ctx, mode: d.G.mode }; });
  await page.mouse.up();
  check('a finger down in a land wakes the audio, inside the gesture', before === true && down.ctx === true && down.mode === 'explore',
    JSON.stringify({ before, down }));
  await context.close();
}

// --- no two labels sit on top of each other, in any land -----------------
/* The Kiln's ending card and the land's own name card were written a
   milestone apart and never appeared on one screen until a contact sheet put
   them there: the card's header landed under the steering hint and the name
   landed in the middle of the card. Nothing in the suite could see it,
   because a label drawn over another label still draws. This measures every
   piece of text a land paints in one frame and asserts the boxes are clear
   of each other, so the next land cannot repeat it. */
{
  const { context, page } = await fresh();
  const clashes = await page.evaluate(() => {
    const d = __dreybird;
    const out = [];
    for (const id of Object.keys(d.LANDS)) {
      const boxes = [];
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
        const size = parseFloat(this.font) || 8;
        const wid = this.measureText(String(text)).width;
        const left = this.textAlign === 'center' ? x - wid / 2 : x;
        boxes.push({ t: String(text), l: left, r: left + wid, top: y - size / 2, bot: y + size / 2 });
        return orig.apply(this, arguments);
      };
      d.active().story.flock = ['sky', 'ember'];
      d.resetWorld();
      d.enterLand(id, true);
      d.frame(performance.now() + 100);      // on arrival, name card showing
      CanvasRenderingContext2D.prototype.fillText = orig;

      /* Clearance, not strict overlap. The two labels this was written for
         miss each other by a single pixel and still read as one smudge, so
         the rule is that lines sharing any horizontal span must leave a few
         pixels of air between them. */
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const sideBySide = a.l >= b.r || b.l >= a.r;
          const gap = Math.max(a.top, b.top) - Math.min(a.bot, b.bot);
          if (!sideBySide && gap < 3) {
            out.push(id + ': "' + a.t + '" and "' + b.t + '" ' +
                     (gap < 0 ? 'overlap by ' + (-gap).toFixed(1) : 'sit ' + gap.toFixed(1) + 'px apart'));
          }
        }
      }
    }
    return out;
  });
  check('no land paints one label on top of another', clashes.length === 0, clashes.join(' | ').slice(0, 300));
  await context.close();
}

// --- every land actually draws ------------------------------------------
/* The suite drives the simulation and almost never renders, so a land whose
   DRAWING referenced a constant that no longer existed passed 47 checks and
   then threw the moment a human looked at it. Ticking is not seeing. */
{
  const { context, page } = await fresh();
  const drew = await page.evaluate(() => {
    const d = __dreybird;
    const out = [];
    for (const id of Object.keys(d.LANDS)) {
      d.active().story.flock = ['sky', 'ember'];      // so perched birds draw too
      d.resetWorld(); d.enterLand(id);
      try {
        for (let i = 0; i < 4; i++) { d.tick(); d.frame(performance.now() + i + 1); }
        // And again past the name card, and again mid-conversation.
        for (let i = 0; i < 130; i++) d.tick();
        d.frame(performance.now() + 200);
        if (d.LANDS[id].npc) {
          const n = d.LANDS[id].npc;
          d.bird.x = n.x; d.bird.y = n.y - 20;
          d.tapLand(0, 0);
          d.frame(performance.now() + 300);
        }
        d.openMap(); d.closeMap(false);
        out.push([id, 'ok']);
      } catch (e) { out.push([id, String(e)]); }
    }
    return out;
  });
  check('every land draws without throwing, conversation and all',
    drew.every(r => r[1] === 'ok'), JSON.stringify(drew));
  await context.close();
}

// --- the chain runs end to end, and the second link is not a copy --------
{
  const { context, page } = await fresh();
  const chain = await page.evaluate(() => {
    const d = __dreybird;
    const pr = d.active();
    pr.owned = []; pr.story.lands = {}; pr.story.flock = []; pr.story.flags = [];

    const errand = () => {
      const L = d.land(), pk = d.LANDS[L.id].pickups;
      // In order for an ordered errand; the check below proves order matters.
      pk.at.forEach(sd => { d.bird.x = sd.x; d.bird.y = sd.y; d.bird.vx = 0; d.bird.vy = 0; d.tick(); });
      const n = d.LANDS[L.id].npc;
      d.bird.x = n.x; d.bird.y = n.y - 20;
      d.tapLand(0, 0);
      while (d.land().saying) d.tapLand(0, 0);
      return d.land().opened;
    };
    const fly = () => {
      let g = 0;
      while (!d.stage().won && g++ < 30000) { if (d.pipes[0]) d.bird.y = d.pipes[0].gap; d.bird.vy = 0; d.tick(); }
      for (let i = 0; i < 200; i++) d.tick();
      d.press();
      return d.land().id;
    };

    d.resetWorld(); d.enterLand('glade');
    const gladeOpen = errand();
    d.enterStage(d.STAGES.reeds); d.press();
    const afterReeds = fly();
    const bankOpenBefore = d.land().opened;
    const bankOpen = errand();
    d.enterStage(d.STAGES.narrows); d.press();
    const afterNarrows = fly();

    return { gladeOpen, afterReeds, bankOpenBefore, bankOpen, afterNarrows,
             owned: pr.owned.slice(), flock: pr.story.flock.slice(),
             at: pr.story.at, lands: Object.keys(pr.story.lands).sort() };
  });
  check('the glade opens, and the Reeds land him on the bank',
    chain.gladeOpen === true && chain.afterReeds === 'bank', JSON.stringify(chain.afterReeds));
  check('the bank starts shut even though the glade is done',
    chain.bankOpenBefore === false, String(chain.bankOpenBefore));
  check('its own errand opens it, and the Narrows land him at the Kiln',
    chain.bankOpen === true && chain.afterNarrows === 'kiln', chain.afterNarrows);
  check('both birds are with him, and neither displaced the other',
    chain.flock.join() === 'sky,ember' && chain.owned.length === 2,
    JSON.stringify({ owned: chain.owned, flock: chain.flock }));
  check('each land remembers its own errand separately',
    chain.lands.join() === 'bank,glade' && chain.at === 'kiln', JSON.stringify(chain.lands));
  await context.close();
}

// --- an ordered errand really is ordered ---------------------------------
{
  const { context, page } = await fresh();
  const order = await page.evaluate(() => {
    const d = __dreybird;
    d.active().story.lands = {};
    d.resetWorld(); d.enterLand('bank');
    const at = d.LANDS.bank.pickups.at;
    const touch = i => { d.bird.x = at[i].x; d.bird.y = at[i].y; d.bird.vx = 0; d.bird.vy = 0; d.tick(); };

    touch(2);                       // last one first
    const wrong = d.land().got.filter(Boolean).length;
    touch(0); touch(1);
    const partway = d.land().got.filter(Boolean).length;
    touch(2);                       // and now, in turn
    const done = d.land().got.filter(Boolean).length;
    return { wrong, partway, done, ordered: d.LANDS.bank.pickups.ordered };
  });
  check('the rings are ordered, and taking one out of turn earns nothing',
    order.ordered === true && order.wrong === 0, JSON.stringify(order));
  check('and flying them in order completes the errand',
    order.partway === 2 && order.done === 3, JSON.stringify(order));
  await context.close();
}

// --- the Narrows is genuinely the harder passage -------------------------
{
  const { context, page } = await fresh();
  const hard = await page.evaluate(() => {
    const d = __dreybird;
    const measure = st => {
      d.resetWorld(); d.enterStage(st); d.press();
      /* Any hazard, not just movers. Counting movers alone called a level
         hazard-free when its seed happened to produce a gust instead --
         which is the same "nominally on" mistake this check exists to catch,
         made by the check itself. */
      let haz = 0, guard = 0;
      const seen = new Set();
      while (!d.stage().won && guard++ < 30000) {
        if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
        d.bird.vy = 0;
        for (const q of d.pipes) if (!seen.has(q)) { seen.add(q); if (q.amp) haz++; }
        // Once per hazard, not once per tick it is blowing.
        if (d.G.gust && !seen.has(d.G.gust)) { seen.add(d.G.gust); haz++; }
        if (d.G.fog && !seen.has(d.G.fog)) { seen.add(d.G.fog); haz++; }
        d.tick();
      }
      return { pipes: st.pipes, gap: st.gap, hazards: haz };
    };
    return { reeds: measure(d.STAGES.reeds), narrows: measure(d.STAGES.narrows) };
  });
  check('the Narrows is longer and tighter than the Reeds',
    hard.narrows.pipes > hard.reeds.pipes && hard.narrows.gap < hard.reeds.gap,
    JSON.stringify(hard));
  // Hazards nominally on is not the same as hazards actually reaching the pipes.
  check('and its hazards actually reach the pipes',
    hard.reeds.hazards === 0 && hard.narrows.hazards > 0, JSON.stringify(hard));
  await context.close();
}

// --- content must not cost anyone their progress -------------------------
/* The trap that made every future land dangerous: entering a land threw the
   saved errand away whenever the number of pickups differed from the number
   saved. Adding a fourth seed to the Glade would have silently reset every
   player who was mid-errand there. Driven by really editing the table, the
   way authoring a land does, rather than by calling the load path. */
{
  const { context, page } = await fresh();
  const kept = await page.evaluate(() => {
    const d = __dreybird, p = d.active();
    const at = d.LANDS.glade.pickups.at;
    const was = at.slice();
    const enter = () => { d.resetWorld(); d.enterLand('glade'); return d.land(); };

    // Two of the three seeds found, the middle one still out there.
    p.story.lands.glade = { got: [true, false, true], talked: 1, opened: false };
    const before = enter().got.slice();

    at.push({ x: 150, y: 300 });                 // a fourth seed, added by an author
    const grown = enter();
    const afterGrow = { got: grown.got.slice(), talked: grown.talked };

    at.length = 2;                               // and a land that loses one
    const shrunk = enter().got.slice();

    at.length = 0; for (const a of was) at.push(a);

    /* The other half of the trap: the validator clipped a saved errand to
       eight, so a land of nine pickups could never be finished. Measured
       through the import path, which is where the validator really runs. */
    const big = JSON.parse(JSON.stringify(d.exportSave()));
    const copy = JSON.parse(JSON.stringify(big.profiles[0]));
    copy.id = 'bigland'; copy.name = 'Bigland';
    copy.story.lands = { glade: { got: new Array(40).fill(true), talked: 0, opened: false } };
    big.profiles = [copy];
    d.importSave(big);
    d.switchProfile('bigland');
    const cap = d.active().story.lands.glade.got.length;
    d.switchProfile(p.id);
    return { before, afterGrow, shrunk, cap };
  });
  check('a land that gains a pickup keeps what was already found',
    kept.afterGrow.got.length === 4 &&
    kept.afterGrow.got.slice(0, 3).join() === 'true,false,true' &&
    kept.afterGrow.got[3] === false, JSON.stringify(kept.afterGrow));
  check('and the conversation with it', kept.afterGrow.talked === 1, JSON.stringify(kept.afterGrow));
  check('a land that loses one keeps the rest',
    kept.shrunk.join() === 'true,false', JSON.stringify(kept));
  // 8 was the old cap, which a land of nine pickups would have silently clipped.
  check('and the saved errand has room for a land far bigger than any yet',
    kept.cap >= 32, 'cap=' + kept.cap);
  await context.close();
}

// --- a restored backup is merged, not chosen between ---------------------
/* Whichever record was seen first used to win outright, so importing a
   fuller backup could leave the brambles shut and Thistle still asking on a
   save whose map already said the passage beyond was cleared. */
{
  const { context, page } = await fresh();
  const merged = await page.evaluate(() => {
    const d = __dreybird, p = d.active();
    p.story.lands.glade = { got: [true, false, false], talked: 2, opened: false };
    const backup = JSON.parse(JSON.stringify(d.exportSave()));
    const his = backup.profiles.find(x => x.id === p.id);
    his.story.lands.glade = { got: [false, true, true], talked: 0, opened: true };
    const res = d.importSave(backup);
    const now = d.active().story.lands.glade;
    return { ok: res.ok, merged: res.merged, got: now.got.slice(), talked: now.talked, opened: now.opened };
  });
  check('a restored backup opens a door the live save had shut',
    merged.opened === true, JSON.stringify(merged));
  check('without forgetting a conversation only the live save had',
    merged.talked === 2, JSON.stringify(merged));
  check('and keeps whichever errand had found more',
    merged.got.filter(Boolean).length === 2, JSON.stringify(merged));
  await context.close();
}

// --- a level is not a free flight ----------------------------------------
/* Pipes, power-ups and roosts cleared inside a level were counted into the
   lifetime totals -- the same numbers the boot-time payout used to turn into
   coins, and the numbers the medals and the stats sheet report. A level is
   authored content with a fixed pipe count; anyone could farm it. */
{
  const { context, page } = await fresh();
  const counted = await page.evaluate(() => {
    const d = __dreybird, p = d.active();
    p.stats.pipes = 0;
    d.resetWorld();
    d.enterLand('glade', true);
    d.enterStage(d.STAGES.reeds);
    d.press();
    let guard = 0;
    while (d.G.score < 5 && guard++ < 20000) {
      d.G.state = d.states.PLAYING;
      if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
      d.bird.vy = 0;
      d.tick();
    }
    const inStage = { score: d.G.score, pipes: p.stats.pipes };

    d.resetWorld();
    d.startPlay(31337);
    guard = 0;
    while (d.G.score < 5 && guard++ < 20000) {
      d.G.state = d.states.PLAYING;
      if (d.pipes[0]) d.bird.y = d.pipes[0].gap;
      d.bird.vy = 0;
      d.tick();
    }
    return { inStage, free: { score: d.G.score, pipes: p.stats.pipes } };
  });
  check('five pipes cleared in a level move the lifetime total by nothing',
    counted.inStage.score === 5 && counted.inStage.pipes === 0, JSON.stringify(counted));
  check('while five in free flight move it by five',
    counted.free.pipes === 5, JSON.stringify(counted));
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
    d.bird.x = d.LANDS.glade.npc.x + 10; d.bird.y = d.LANDS.glade.npc.y - 20;
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
