# DreyBird's World

**You are DreyBird. Your flock was scattered across the pipe-lands, and you are
bringing them home.**

An adventure built on the bones of a Flappy Bird tribute. Between the pipe-lands
there are quiet places where the world stops rushing at you — hold your thumb and
DreyBird glides toward it, coasting when you let go. Land near a field mouse and
he will tell you what the wind took. Help him and he will pull the brambles aside.
Beyond them is a proper pipe-land, and at the far end of it, one of your flock.

The endless game this grew out of is still here as **free mode**, unchanged.

> Seeded from [DreyBird](https://github.com/dreymar87/DreyBird), which remains its
> own game. Storage is deliberately named apart: both are served from
> `dreymar87.github.io`, and browser storage is scoped per origin rather than per
> path, so sharing a name would mean sharing — and overwriting — each other's saves.

A one-file tribute to Flappy Bird. Tap to flap, thread the pipes, chase a medal.

**Play it: https://dreymar87.github.io/DreyBird**

No build step, no dependencies, no assets — the whole game is `index.html`.
Open it in any browser (phone included) and play.

```
open index.html          # macOS
xdg-open index.html      # Linux
```

## Install it

DreyBird is a progressive web app, so it can live on your home screen and
play with no signal at all.

- **Android / Chrome** — open the link above and tap **Install DreyBird**
  (the button appears once the browser offers it), or use the ⋮ menu →
  *Add to Home screen*.
- **iPhone / Safari** — open the link, tap **Share**, then
  **Add to Home Screen**.

It launches fullscreen and portrait, with no browser bar. Your best score and
chosen bird come along, because the installed app shares the browser's
storage for the same site.

## Players

Tap the person icon (top-left) to manage players. Several people can share
one device — each keeps their own bird, best score, medal case and game
count, and the title screen shows whose turn it is. Rename and delete live
on the row of whoever is active; you can't delete the last one.

These are labels, not accounts: no passwords, no sign-in, no server. Nothing
you do in DreyBird leaves your device.

### What "saved" actually means

Browser storage is evictable by default. Chrome discards it under disk
pressure, and iOS Safari drops site data after about a week without a visit.
DreyBird asks for an exemption via `navigator.storage.persist()` and tells
you the real answer in the Players sheet — Safari only grants it once the
game is on your home screen, which is one more reason to install it.

Two things make that safe:

- **Save file** writes every player to a dated file. The button tells you
  where you stand: **Saved ✓** when the copy you have is current,
  **Save file (3)** when three runs have happened since. No more saving
  "just in case" and ending up with `(1)`, `(2)`, `(3)`.
- **Load file** reads one back, merging by player. On a conflict it keeps
  the *better* of each number, so importing an old backup can never lower a
  best score, wipe a medal or repossess something you bought.

Where the browser supports it (desktop Chromium), DreyBird remembers the
file you chose and writes back over it — a real overwrite. iOS Safari and
Android Chrome don't offer that API, so there each save is a new dated
file, and the button says so.

**On security, honestly:** the save is plain JSON and the badge is a
change detector, not a tamper detector. A hash computed in a page anyone
can read proves nothing about who wrote a file. Your live save also sits
in IndexedDB, editable from devtools in seconds. Making a save genuinely
tamper-proof needs either a native app with private storage or a server
that owns the data — neither of which a static page can be. DreyBird has
no leaderboard and nothing at stake, so this is a deliberate trade rather
than an oversight.

Coins, purchases and scores live in IndexedDB, falling back to `localStorage` where
IndexedDB is blocked (private windows, some embedded browsers). If you played
an earlier version, your existing best score is migrated into the first
player rather than lost — and your pipes, power-ups and medals from before
the shop existed are paid out in coins, once.

## Background

Every world drifts through its own times of day as you fly — Meadow through
day, sunset, night and dawn; Neon Grid through dusk, midnight and signal. If
you'd rather it held still, Settings (the gear, top-left) lets you pin any
one of them. You pick by looking at a strip of the actual sky rather than
choosing a name from a list, and the choice is saved per player.

## The world

Pipes come in **formations**, not just independent random gaps — ascents,
descents, valleys, zigzags and narrow corridors, shuffled from the run's
seed. They unlock as a run goes on, so the opening is always plain drift
and the shapes arrive once you're warmed up.

Three **hazards** turn up later in a run:

- **Movers** — the pipe pair swings up and down, and the gap swings with it.
- **Gusts** — an updraft or downdraft pushes you for a few seconds, always
  announced first by chevrons down both edges pointing the way you'll be
  pushed. A gust you can't see coming is unfair, not hard.
- **Fog** — a band of haze hides part of the playfield. It changes what you
  can see, never what the world does.

Hazard frequency ramps on how far into the run you are, and **assist mode
halves it**. Everything is drawn from the seed, so two people playing the
same seed meet the same formations and the same weather.

## Levels and birds

Every run pays **XP** as well as coins, and they measure different things:
coins reward volume (a coin a pipe), XP rewards depth and improvement —
your score plus your medal, doubled when you beat your own best. XP is
only ever earned, never spent, so buying a hat never costs you progress.

**The twelve birds now fly differently**, and every one of them trades
something. Ember has a punchy flap but falls heavy; Ghost slips through
gaps but dives fast; Coal's shield takes two hits but it's heavy; Gilded
earns much more but sinks. Classic is the baseline and trades nothing.
Each card shows its trade before you buy.

No bird is strictly better than another — that's enforced by a test, not
by good intentions: every non-baseline bird must be better at something
*and* worse at something, or the suite fails.

**Perks** ("feathers") unlock with level and equip into slots that open at
levels **4, 12 and 22**. They're mild global modifiers — a coin bonus,
longer power-ups, an extra shield hit:

| Perk | Level | What it does |
| --- | --- | --- |
| Thrift | 4 | Every pipe pays a little more |
| Study | 6 | Runs teach you faster |
| Updraft | 9 | The air holds you up a touch |
| Slipstream | 12 | A slightly finer profile |
| Reservoir | 16 | Power-ups run longer |
| Plating | 20 | Shields take an extra hit |

Every perk unlocks at a level where a slot already exists to hold it, so
nothing is ever shown as available while being unusable. The Perks tab
tells you where the next slot is (`LV 7 · 1/1 SLOTS · NEXT AT 12`), and a
card with nowhere to go says which level frees one.

Traits and perks change **the bird, never the world**. Pipe layout, gap
width, speed and hazards come from the seed alone, so two people on the
same seed fly the same world whatever they've equipped. That's what makes
a shared daily challenge possible later, and a test asserts it across all
twelve birds.

## Feel

A collision freezes the world for seven frames before the fall begins —
cheap, and most of what makes an impact land. The world has depth: a far
ridge drifts at a tenth of the scroll speed, the skyline at a quarter,
clouds at a half, and grass tufts in front of the ground move faster than
the ground itself. Clearing a pipe throws a small spark. The title
breathes on the start screen. All of it respects `prefers-reduced-motion`,
where the freeze is skipped entirely.

**Music** is a slow pentatonic arpeggio over a soft bass, built from the
same oscillators as the sound effects — pentatonic because every note in
it agrees with every other, so a loop can't land on a sour interval. It is
**off by default**, with its own toggle in Settings, and muting the game
silences it too.

New players get one line of guidance under the prompt, which disappears
for good once they finish a run.

## Comfort

Settings (the gear, top-left) also holds:

- **Haptics** — a buzz on flap and crash. Off by default, and Android only:
  iPhones ignore vibration from a web page whatever you set here.
- **Assist mode** — gentler gravity, a softer flap, a wider gap and slower
  pipes, for anyone finding the original feel too punishing. Assist runs
  earn coins normally but **do not set a best score**, and the game-over
  panel says so. A record set on easier physics isn't the same record, and
  quietly recording it would be worse than not recording it.

**Pause** appears in the top-right while you're flying, and leaving the tab
pauses automatically rather than costing you the run.

## How to play

| Input | Action |
| --- | --- |
| Tap / click | Flap |
| <kbd>Space</kbd>, <kbd>↑</kbd> | Flap |
| Tap after a crash | Play again |
| <kbd>Esc</kbd> | Close the bird picker |

Your best score is kept in the browser, on your device.

## What's in it

**The faithful part.** 288×512 playfield, gravity-and-impulse flight,
scrolling pipes, ground and ceiling collisions, a forgiving hitbox, and
bronze / silver / gold / platinum medals at 10, 20, 30 and 40 points.

**Portals and the Roost.** Rarely — about a third of runs that get past
pipe 40, never before pipe 15, and never twice — a pipe carries a door: a
wider opening with a shimmering ring hanging in the middle of it. It
announces itself well before it can reach you, then pulls you gently toward
the ring.

Fly into the ring and you drop into **the Roost**, a quiet violet room with
a line of coins to fly and nothing at all that can hurt you. Your run does
not end while you are in there — it waits. The pipes, the power-ups and the
generator are all exactly where you left them when you come back out, and
the bird returns to the height it left at.

Two rules hold the whole thing together. **The pull can never kill you:** it
only ever draws you toward the centre of the gap, it reaches only as far as
the clear air between pipes, and its strength is derived from your own run's
gravity so that letting go always still sinks you. **And you can refuse
it:** the opening is wide enough to fly past the ring on either side, and a
single flap erases everything the pull has gathered. Taking the portal is a
choice, never something done to you.

Score does not move in the Roost. Coins are the reward; score stays a pure
count of pipes cleared.

**A stats screen.** The chart button in the top-left opens it. Best, level,
games and coins across the top; a bar chart of your last 30 runs with the
average marked; then the totals — pipes cleared, power-ups taken, longest
single flight, Roosts found, and your average run — and a medal case broken
out by tier rather than summed into one number.

Four of those had been recorded since the shop was built and displayed
nowhere at all. Only the run history is drawn as a chart, because it is the
only one of them that is about change over time; a bar chart of "games
played" would say nothing the number does not. The medal case stays a
labelled list on purpose — four coloured bars for bronze through platinum
would lean on exactly the hues a colour-blind reader cannot separate.

**Day/night cycle.** The sky drifts through day → sunset → night → dawn as
you fly. Stars come out, city windows light up, the ground cools off. It's
cosmetic — it never changes the difficulty.

**Coins and a shop.** Clearing a pipe pays 1 coin, a power-up 2, and
finishing with a medal pays a bonus (bronze 5, silver 15, gold 30, platinum
60). Spend them in the shop — the palette button in the top-left corner.

Your bird's coin trait multiplies all of it, and the fraction carries
across the run rather than being rounded away on each pipe. That matters
more than it sounds: rounding every award on its own made a pipe pay 1
coin whatever you flew, so Gilded's 1.35 and Mint's 0.9 both paid exactly
what Classic paid. A single pipe can now tick no coin at all while the
run's total still comes to what the multiplier says it should.

**Thirty cosmetics**, in four kinds:

- **12 birds.** Classic is yours from the start; Bluebird, Ember, Ghost and
  Circuit still unlock at a best score of 5, 15, 25 and 40 — they were earned
  before the shop existed, so they stay free. The other seven cost coins.
- **6 hats** — ball cap, party hat, halo, crown, horns, top hat. Drawn on the
  bird's head and leaning with the dive, independent of which bird you fly,
  so the combinations multiply.
- **5 flight trails** — sparks, bubbles, embers, frost, rainbow.
- **4 world themes** beyond the default Meadow: Endless Sunset, Monochrome,
  Neon Grid and Sakura, each repainting the pipes, sky and ground — and each
  carrying its own three times of day.

Coins are earned by playing. There is no real money in DreyBird, nothing to
buy with a card, and no server to check anything — the wallet lives in your
own save file. Editing it only cheats you.

**Two power-ups**, floating between pipes once you're past 4 points:

- **Shield** — absorbs one crash, then pops.
- **Slow-mo** — drops the world into ~60% speed for about six seconds.

## How it's built

Plain JavaScript on a `<canvas>`, roughly 900 lines:

- **Fixed timestep.** The world advances in 60 Hz ticks with an accumulator,
  and rendering interpolates between them. A 120 Hz phone plays exactly like
  a 60 Hz one — no double-speed gravity.
- **No sprites.** The bird is a 17×12 character grid painted from a palette,
  so a new skin is just a new set of colors. Pipes, clouds, skyline and ground
  are canvas rectangles.
- **No audio files.** Every sound is a WebAudio oscillator built on the fly,
  created on first tap so mobile browsers unlock it.
- **Seeded runs.** Anything that shapes a run — pipe gaps, power-up spawns —
  draws from a seeded generator, so a seed reproduces a run exactly. The
  draws happen unconditionally, before the score is consulted, so the pipe
  sequence depends on the seed alone and not on how well you are playing.
  Cosmetic jitter deliberately stays unseeded: it can't affect fairness.
- **Nothing external, and nothing waited on.** One optional Google Fonts
  request for the pixel typeface. The link carries `media="print"` so it
  stays off the parser's critical path, and the service worker's font
  handler races the network against a timeout and synthesises an empty
  stylesheet rather than leaving the request pending.

  Both matter: a pending stylesheet blocks the parser from running the
  scripts after it, so a font host that accepts a connection and never
  answers — a captive portal, a blackholed network — used to hang the
  whole game at `readyState: "loading"`. `pwa.mjs` simulates exactly that
  and asserts the game still boots and plays.
- **Offline by default.** `sw.js` is a hand-written service worker — no
  Workbox — that precaches the app shell and keeps the pixel typeface in a
  stale-while-revalidate cache. Bump `CACHE` in it to ship an update.
- **Async storage, synchronous loop.** The vault is read once during boot
  into a plain object; the game loop never awaits anything. Writes go through
  an ordered queue so a reload can't catch the store half-updated, and they
  fire immediately rather than on a debounce — the moment a run ends is
  exactly when someone closes the tab.
- **Icons are generated, not drawn.** `test/make-icons.mjs` renders them with
  the game's own bird code, so the app icon can never drift from the bird.

The game exposes `window.__dreybird` so a headless browser can drive the same
loop with synthetic timestamps. `test/smoke.mjs` uses that to check the
physics, scoring, collisions, power-ups, unlocks and mobile layout:

```
npm install && npx playwright install chromium
npm test                     # every suite, one verdict

npm run test:smoke           # 24  gameplay, top bar, storage, CI coverage
npm run test:pwa             # 14  installability, offline, updates, font-hang
npm run test:profiles        # 28  storage, profiles, import/export
npm run test:cosmetics       # 15  economy, shop, rendering
npm run test:determinism     # 12  seeded runs and backgrounds
npm run test:comfort         # 16  haptics, pause, assist
npm run test:dynamics        # 16  formations and hazards
npm run test:progression     # 39  XP, traits, perks, payouts
npm run test:crash           #  9  crash survival
npm run test:polish          # 10  juice, music, tutorial
npm run test:portal          # 19  portals, the pull, the Roost
npm run test:stats           # 20  the stats screen and its chart
npm run icons                #     regenerate the app icons
```

222 checks in total.

`smoke.mjs` drops screenshots of each game state into `test/shots/`.
`pwa.mjs` serves the repo on localhost, waits for the service worker to take
control, then pulls the network out and proves the game still boots, starts
on a tap and scores. `profiles.mjs` covers the storage layer: migration from
the old single-player build, two players not bleeding into each other,
surviving a reload both with and without an explicit flush, both answers to
the persistent-storage request, export/import round trips, and the game still
working with IndexedDB blocked entirely. `cosmetics.mjs` checks the
catalogue for malformed art and duplicate ownership keys, drives real runs to
verify what they pay, and screenshots the same frame with and without
cosmetics equipped to prove they reach the canvas.

`.github/workflows/pages.yml` runs every suite as a parallel matrix on each
push and **only then** deploys — the `deploy` job declares `needs: test`, so
publishing is impossible while anything is red. Tests run on every branch;
deployment stays restricted to `main`.

`crash.mjs` covers the failure path: a frozen canvas is the worst outcome
because it looks like a hang and tells nobody anything. One bad frame is
skipped and the game carries on; a persistent one stops and paints what
actually went wrong; and the profile is written to storage before either.
Losing a crash is annoying — losing the runs that led to it is worse.

---

Made as a homage to Dong Nguyen's *Flappy Bird* (2013). All code and art here
are original.
