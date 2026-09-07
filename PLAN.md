# DreyBird's World: Development Plan

Read this before every session. Take the top open item in the current milestone. The rules for choosing are in section 3; the milestones in section 4. Line numbers refer to index.html at the commit that added this file and drift as the file changes; the function and table names do not.

## 1. Vision and design pillars

You are DreyBird. Find the scattered flock. The 12 skins are the flock. Hold to steer in lands, classic flap in stages. Roost and errands pay coins only. Every change must pass four tests.

1. **Flappy stays Flappy.** In a stage the only input is a tap. The constants at index.html:677-691 do not move and determinism.mjs still passes.
2. **The thumb is the controller.** Lands are hold-to-steer, stages are tap. No screen is left with no input. No action fires from a thumb the player did not re-press.
3. **The world tells the truth.** A card, counter or panel may only promise what the code delivers. Flock count, shop and arrival card must agree.
4. **A land is data.** Adding a land costs one LANDS row, one NPCS row with its art grid, one STAGES row, a README line and a CACHE bump. Nothing else. A per-land branch in drawLand or tickExplore fails review until M3 removes the seam.

## 2. Where we stand

Live main is d2c8b02, CI run #10 green: 3 lands, 2 passages, 2 of 12 birds home. The staged tree adds west doors, the map sheet, README edits and 13 world checks, and all 13 suites, 283 checks, pass on it. That staged map has a soft-lock: travelling from the map over a fallen stage leaves G.paused true forever, because openMap sets it at index.html:4226-4227, closeMap keeps it at 4234, and travel at 4218-4222 never clears it. The fallen panel at 3191 advertises exactly that path. Beyond that, the first ten minutes fail on seams, not missing content: stage entry sets vy 0 and the bird falls at tick 44 before any pipe, the first three pipes use the free gap 104, the rescued Bluebird stays locked in the shop, and the title never points to the story. Space in a land applies the -6.7 flap, and a thumb held at the left edge chains Kiln to Bank to Glade with no release. The page runs in quirks mode with no doctype, and the install identity is still the classic game's. The gate is CI-only in practice: world.mjs took 279 s locally, 4 s in CI.

## Progress log

- `c210929` M0 shipped: west doors, the map sheet, the soft-lock fixed with its check. CI run #11 green.
- `aa84e4c` M1 door beat and stage gap: a level waits for the first tap and every pipe in it is the level's width. CI run #12.
- `6bf9893` M1 rescue real: a rescued bird can be flown at a best of 0, the map counts what the shop lets you fly, and a flock of strangers reveals nothing. CI run #13.
- `8967c7c` M1 names and sky: a land names itself on arrival, the level's copy names the right places, and a level reads its sky pin instead of overwriting the player's setting. A ten-minute timeout on CI test jobs. CI run #14.
- `d25c6d5` M1 a way in and a way out: the title says where the story is and the map button beckons until the glade is seen, a cleared level retires the flap lesson, the map names only passages he has heard of and says which rows can be tapped, and the Kiln ends on a card that counts the flock. CI run #15.
- `9a7688c` the polish suite's flap-lesson check sees the glade first; run #15 was red because the story line now takes that slot on a fresh profile. Lesson: run the quick suites that touch a changed screen before a push, not only world.mjs. Run #16 green.
- M1 teach the thumb and size the text: HOLD TO FLY is its own line and retires after a second and a half of holding, a tap in open air flicks the wing and pops, the land HUD sits below the buttons, speech paints at 7 px with prompts at 6, and the dialogue is paged as sentences. This commit.

## 3. How we decide

**Priority rubric.**
- P0 Blocked: the player cannot continue or progress is destroyed. Ships first.
- P1 Promise broken: the game says something false or a reward is inert.
- P2 Feel: the right thing happens but reads wrong.
- P3 Growth: new content, reach, return hooks.

Within a tier, cheapest first. Ties break toward the earlier player minute. A P3 never jumps a P1 unless the P1 needs it.

**Session rule.** One session, one visible change on the phone, one new check that goes red without the change. If the visible part cannot be shown, the item was too big. Split it. An invisible change rides with a visible one or waits.

**Definition of done.** Green in CI on the pushed commit. The check asserts behaviour or pixels, never a flag. Mutation-tested: revert the fix, watch red. README counts match. A play report confirms it.

**Evidence, ranked.** A phone play report first; it finds what green tests miss. Then a headless probe through window.__dreybird at 4915-4985. Then a failing check. Then the CI contact sheet once M3 builds it. Reading code alone is weakest. Nothing below a failing check closes a P0 or P1.

**Refactor thresholds.** None fire today.
- Mode table replacing the chains at 2437-2449 and 3439-3450: a fourth flight mode, or the same mode bug twice in a month.
- Camera: a land larger than one 288x512 screen, or play reports call six lands cramped.
- Branching map: only after CHAIN at 4151 is derived from LANDS.east and STAGES.to. Before that it is a fourth hand-kept copy of the graph.
- HTML dialogue overlay: only if the 390x844 screenshot still fails a 9.5 CSS px floor after speech is 7px.
- File split: index.html past about 8000 lines. It is 5049. The split ships with sw.js SHELL and the pages.yml assemble step updated in the same commit.

**Content versus foundations.** Ship content on current seams when the next land is a copy of the last. Fix a seam first when the next land would add a second branch to the same function. The five seams in M3 are the whole list. After them, content wins. Never let two milestones of foundations pass without a visible content beat.

## 4. Milestones

### M0: Ship the map
Goal: the staged work reaches the phone without the soft-lock.
Player after M0: falls in the Reeds, opens the map, lands in the Glade and steers.
Exit: fall in the Reeds, open the map, travel to the Glade, steer, open the pause sheet. Run #11 green.
Work:
- S. `G.paused = false` in resetWorld at 1752-1794. Add `!d.paused()` and a ticks-advance assert to the travel check at world.mjs:456-467. Revert the fix once to see red.
- S. README counts at README.md:366, 362, 305, 39. Network-first wording at 333.
- S. Add this plan as PLAN.md.
- S. Commit, push, watch run #11. Do not claim green until it is.
Gate: run #11 green plus the travel play report. Nothing else lands before this.

### M1: The first ten minutes
Goal: a new player reaches Bluebird, equips it, and knows where the story lives.
Player after M1: sees THE GLADE fade in, learns to hold, survives to the first pipe, flies as Bluebird, finds an ending at the Kiln.
Exit on the phone: enter the Reeds and survive to the first pipe. Bluebird's card reads Tap to equip. The title says TAP THE MAP. The Kiln shows N OF 12 ARE HOME. Space in a land steers. Text readable at 390 wide.
Work, in order:
- S. Door beat: a `G.stage.ready` flag set in enterStage at 2320-2348, a freeze arm like the failed arm at 2443, cleared by press at 3631-3632 with a flap. retryStage at 2382-2385 takes the same path. A lone flap only moves death from tick 44 to about 64. One `d.press()` added to each stage loop in world.mjs 271, 365, 524.
- S. Stage gap: `startPlay(seed, gap)` at 1916 and 1950, pass `st.gap` at 2337, delete 2343-2345. The ready arm goes after startPlay, not after the deleted lines.
- S. Rescue real: available at 1082 honours profile.owned. One `home(b)` predicate at 4200, 4205 and 3044 reading profile.best. Delete the roost reveal at 4156. Filter flock ids against SKINS in sane at 962-963. world.mjs:633 becomes 2 OF 12.
- S. Names and sky: move the E.t<110 block from tapLand 2276-2281 into drawLand after 3072. st.name at 3153 and 3158. `LANDS[stageNow().from].name` at 3182 and 4103-4105 with an else branch restoring End run. Delete `G.bg = st.bg` at 2342; read the pin in phaseNow at 2676-2681. Pixel check at row 150 after enterLand.
- S/M. Title hint and ending: at 3357 show TAP THE MAP until a seen:glade flag exists, retiring the taught line for story players. Pulse #btn-world from syncStage at 3612-3619. In buildMap at 4172 hide unreached passage names while lands still read ????? and give rows a tap cue. Replace drawWorldEdge copy at 3058-3063 with a card drawing home birds via drawBird.
- S/M. Teach the thumb and text size: an E.held counter on the G.explore literal at 2404 and an independent `if (E.held < 90)` HOLD TO FLY branch before nearNpc at 3120. A tap in open air at 2283-2284 flicks the wing and pops. Speech 7px, prompts 6px at 3116-3119, 3191, 3062. HUD y 76 at 3096-3099. Re-page NPCS 1399-1419 as sentences; run the fit loop at world.mjs:58 over every NPC.
- S. Door re-arm and keyboard: clear `hold.on` in enterLand at 2404-2413 so a held thumb cannot chain lands. The probe reaches the Bank at tick 21 and the Glade at tick 94 today. The west-door checks at world.mjs:574-598 then need a letGo and holdAt pair. Arrows and WASD set a virtual thumb offset; `if (G.mode !== 'explore') press()` at 3683. Probe audio.ctx after enterLand plus pickup, since only press at 3634 starts audio.
Gate: a timed fresh-profile play report. Over ten minutes to Bluebird triggers Decision 1.

### M2: Identity and reach hygiene
Goal: the World can be shared without breaking the classic or itself.
Player after M2: installs the World beside the classic and pastes a link that previews as the World.
Exit: the install prompt appears with the classic installed. Distinct icon and name. The classic stays cached after a World update. document.compatMode is CSS1Compat. A pasted link shows title, blurb and image.
Work:
- S. manifest.webmanifest:5 id dreybirds-world, :3 short_name Drey World, :4 flock blurb. index.html:4, :9, :646, :648. A distinguishing mark in test/make-icons.mjs, `npm run icons`, CACHE dbw-v8.
- S. sw.js:31 `names.filter(n => n.startsWith('dbw-') && n !== CACHE && n !== RUNTIME)`. pwa.mjs: a seeded dreybird-v16 cache survives activate.
- S. `<!doctype html>` and `<html lang="en">` at index.html:1, landed alone and verified against smoke.mjs:52-61 plus a phone screenshot.
- S. og:title, og:description, og:image, twitter:card in the head plus one 1200x630 PNG in icons and a SHELL entry.
Gate: Decision 5 on the origin. No public link and no TWA before this milestone is on main.

### M3: Authoring at scale
Goal: a land is three table rows and CI shows you the pictures.
Player after M3: nothing new in hand, but the Actions tab shows every land and stage panel in one PNG after each push.
Exit: bench/shots.mjs renders every land and stage state into one PNG uploaded by pages.yml. Deleting a LANDS field turns world.mjs red with no hand-written check. A 9-pickup land keeps its saved got[] on the next enterLand.
Work:
- M. Contact sheet outside test/, since run-all.mjs:7-9 treats every test file as a suite. `?land=` and `?stage=` parsed before resetWorld at 4903. Do this first.
- M. Table-iterating block in world.mjs: every land's east resolves to a STAGES row whose to points west back; finds and roost in SKINS; npc.who in NPCS with four arrays; wrapLines fit; alpha-count pixels at npc, pickups, GATE_X and perches. Plus a page.reload round-trip of story.at, since no world check reloads today.
- S. got cap 8 to 32 at 972; keep the prefix at 2405-2406, which is the line that wipes today. Import merge per land at 4672-4674; granted true in createProfile at 4553, because backPay 1052-1064 repays pipes, powers, medals and best. Stats bumps at 2507, 2523 and 2101 skip stage mode.
- M. The five seams, smallest first: a PICKUPS table for 3083-3084, 3096, 2235; NPC art as grid rows painted by one drawGrid lifted from drawHat's loop at 2724-2733, replacing 2951-2985 and 3090-3091; LANDS[id].perches in drawRoosting 3042-3048; gate {opens} in advanceTalk 2305; CHAIN derived by walking LANDS.east to STAGES.to from glade. Rename land() at 1996 to hitGround, since the harness land() at 4956 means the current land.
- S. Local speed: one browser per suite, an `--only` filter, concurrency in the deploy job at pages.yml:8-10.
Gate: contact sheets before and after the art rewrite; any changed pixel on Thistle or Stilt needs a play report. Pass when land 4 can be authored as rows only, in one session.

### M4: Land 4 and the economy
Goal: the campaign has a next place and a first coin.
Player after M4: talks to Ember at the Kiln, clears a new passage, finds Ghost, equips Ghost at best 0, sees coins rise once per errand.
Exit: the Kiln NPC gives an errand and opens east. A Kiln to land 4 stage finds Ghost, equippable at best 0. Finishing an errand raises coins once.
Work:
- M. Kiln NPC row with Ember as the voice, drop ends:true at 1390, a LANDS row for land 4 with an art grid, a STAGES row finding ghost with need 25. Zero test code if M3 held.
- S/M. Errands pay: pin `G.coinMul = 1; G.hitW = HIT_W; G.hitH = HIT_H` in enterLand. ERRAND_COIN 12 through earn where E.opened flips at 2306-2307. A GO TELL THISTLE flash at gotAll 2253 and a sign at GATE_X.
- S. Loop hygiene: clamp acc to DT after 3520, snap px and py in die() after 1985, resetWorld stage branch 1781-1785 calls leaveLand. Checks in comfort.mjs and polish.mjs.
- S. Portal policy: explicit `portal:false` per STAGES row at 1829-1831. A Flock tile in buildStats.
Gate: count the lines land 4 took. More than about 60 lines of rows means a seam is still open. Decision 2 on the bounty, settled by the coin curve after land 4.

### M5: Items, branching, daily
Goal: barricades that are not pipes and a reason to return.
Player after M5: carries an item from the Kiln to Stilt and a door opens, flies a daily seed, shares a run by link.
Exit: an item carried across a map travel opens a gate. A `?seed=` link plays the same flight on two phones. A daily flight shows a streak.
Work:
- M/L. ITEMS table, profile.story.items in newProfile 924, sane 958 and import 4665; wants and gives in startTalk 2292-2294; `when:` clauses on dialogue.
- M. Currents and weather as LANDS fields applied in tickExplore before drag at 2187 and at 3214.
- M. `?seed=` before 4903, seed on drawOver near 3412, navigator.share, then stats.daily.
- L each. Camera G.cam lerped at 3428-3430 and the branching map with north and south doors at 2214-2215 and a two-column buildMap at 4166-4196, only when their thresholds fire.
Gate: land 5 play reports decide whether any land truly needs an item before ITEMS grows.

## 5. Decisions only the owner can make

1. **Reeds length.** Keep 16, cut to 12, or 10 at STAGES 1431. Recommend 12. Evidence: time to Bluebird on a fresh profile. Under ten minutes settles it.
2. **Do stages ever pay?** Nothing, a one-time bounty via the cleared flag at 2374-2376, or per-pipe pay. Recommend errands pay once plus a first-clear bounty of st.pipes coins. Evidence: a story-only player's coins after land 4 against the 720 coin cost of the seven purchase birds.
3. **Seams before land 4, or after?** Recommend seams first, once the contact sheet exists. Evidence: if the Kiln NPC needs a new drawX branch, the seams were needed.
4. **Which bird does land 4 find?** Ghost, Circuit, or a cost bird. Recommend Ghost, which proves the available fix on the first new content. Evidence: a fresh profile equips it at best 0 on the phone.
5. **Custom domain or stay on github.io?** Decide this month. Recommend a domain if a Play Store build is ever wanted. Evidence: IndexedDB at 748, caches and install id are origin-scoped, so every player re-imports if you move later.
6. **Bigger canvas text or an HTML dialogue overlay?** Recommend canvas 7px now. Evidence: a 390x844 screenshot measured against a 9.5 CSS px floor.

## 6. Working cadence

**Session loop.** Read this plan. Take the top open item in the current milestone. State the check, then the change. Revert the fix once, see red, restore. Push and watch CI. Play the deployed build. Send a play report.

**Play report.** Six lines. Build: commit hash. Device: phone and browser, fresh profile or not. Path: what you did, in order. Expected: what you thought would happen. Saw: what happened, the second it went wrong, screenshot if visual. Rating: P0 to P3 by the rubric. One line per surprise, even good ones. Surprises outrank green checks. A P0 goes to the front of the current milestone.

**Release checklist.** Green on the pushed commit. New checks mutation-tested. README counts current. CACHE bumped only for icons or manifest. Contact sheet reviewed on the phone once it exists. Play report received. A fresh profile tried once per milestone. Export a save before any storage or origin change.

## 7. Risks

- **Green suite, broken game.** 283 checks passed while the map soft-locked. Mitigation: play reports are first-class, and every travel and door check asserts ticks advance.
- **Local gate unusable from a phone.** world.mjs at 279 s locally, full npm test near 25 minutes. Mitigation: the M3 speed item; until then push small and let CI be the gate.
- **Progress wipe from content.** The length check at 2405-2406 discards saved errands on the next enterLand. Mitigation: the M3 cap and prefix fix before any land gains a pickup.
- **Shared origin traps saves.** Storage, caches and install id are origin-scoped. Mitigation: decide the domain in M2, ship export first, no public link until M2 is on main.
- **Refactor appetite.** Mode table, camera and branching each cost L and show nothing. Mitigation: only the section 3 thresholds trigger them.
- **Quirks mode surprises.** The doctype may shift layout. Mitigation: land it alone with a phone screenshot.

## 8. Parking lot

- Perched flockmates as tappable NPCs speaking from NPCS by skin id.
- Stilt notices Bluebird: one conditional at startTalk 2292-2294.
- Resume into story.at on boot at 4903 once story progress exists.
- Retry high-water bar on the fallen panel at 3168-3193.
- Stage variants from existing knobs: pattern, assist, weather per STAGES row.
- Pickup kinds beyond seed and ring once PICKUPS is a table.
- Postcard share from the arrival panel via navigator.share.
- Daily errand row on the map with a per-day flag.
- Storage health line in the Players sheet.
- Slow-device Lighter sky switch that drops trail and parallax.
- Player-pasted diagnostics blob instead of analytics.
- Second-finger pointerId tracking in the hold handler at 3655-3677.
- Gzip size budget check under 80 KB on index.html in CI.
- GLIDE_DRAG sweep 0.94 to 0.97 after a pinned sag check.
- Android TWA after the origin decision.
