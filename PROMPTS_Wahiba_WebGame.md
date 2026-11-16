# Wahiba Sands Off-Road — Web Version (v2) — Prompt for Claude Code (Opus)

> هذا الملف يلغي خطة Unreal القديمة (`PROMPTS_Wahiba_Offroad.md`). اللعبة الجديدة تشتغل في المتصفح: داخل Claude Code (Browser pane) أو من VS Code بأمر واحد.
> لا Unreal، لا Epic Games، لا محاكي، لا تثبيت محرك.

## البرومبت الصغير (انسخه واعطه لـ Claude Code مع هذا الملف)

```
اقرأ PROMPTS_Wahiba_WebGame.md بالكامل ونفّذه حرفياً بالترتيب: Section A (تنظيف) ثم B (الاستفادة من الشغل السابق) ثم المراحل W1 إلى W6.
لا تنتقل لمرحلة قبل التحقق من شروط DONE وتسجيلها في docs/PROGRESS.md، وبعدها كمّل مباشرة.
أنا نايم: ممنوع تسألني أي سؤال، وممنوع توقف بين المراحل أو تنتظر ردي. خذ أفضل قرار بنفسك، سجّله في docs/DECISIONS.md، وكمّل لين تخلص W6 كامل. أبي أصحى ألقاه مخلص.
اللعبة تشتغل في المتصفح (Three.js) وتتفتح داخل Claude Code أو VS Code. ممنوع Unreal وEpic وأي محاكي.
وفّر التوكن بدون ما تأثر على الجودة حسب قسم TOKEN RULES. كلمني بالعربي وردودك قصيرة.
```

---

## Section A — تنظيف مخلفات المحاولة السابقة (أول خطوة، قبل أي شي)

```
CONTEXT: A previous attempt (a different session) started an Unreal Engine plan. It may have downloaded tools/installers/caches. I want that cleaned up.
HARD RULES:
- DO NOT uninstall or touch Epic Games Launcher itself, its settings, logins, or any games/projects I installed on my own. It stays.
- Delete only things you can show were created by that earlier attempt (created/modified on 2026-11-15 or later, or clearly Unreal-engine/UE-tooling leftovers such as
  Unreal Engine installs/partial downloads, Derived Data Cache, UE prerequisites/installers in Downloads or temp, Visual Studio / Build Tools downloads or installers fetched for it,
  and any project folders for UE). Look in: Epic Games install dir (engine versions only), %LOCALAPPDATA%\UnrealEngine, %LOCALAPPDATA%\EpicGamesLauncher\Saved (only download/cache/staging folders, NOT config/logins),
  C:\ProgramData\Epic (only engine-install caches), Downloads, %TEMP%, package-manager caches created today (winget/choco/scoop), and the project folder.
- Step 1: scan read-only and print ONE table: path | size | created date | why you think it is a leftover | confidence (sure/maybe).
- Step 2: delete everything marked "sure" without asking. "maybe" items: do NOT ask me and do NOT delete them; list them with sizes in docs/PROGRESS.md for me to review later. Never use wildcards on drive roots; resolve every path first.
- Step 3: report total space freed. Keep it to 10 lines.
- KEEP inside the project: Tools/GIS, Data/GIS/out (final outputs), docs/, PROMPTS files. Data/GIS/raw and work may be deleted only if they are reproducible AND I say so; default = keep raw, delete work/ if it is a temp cache.
```

## Section B — الاستفادة من المحاولة السابقة (Fable 5.2) بدون إعادة الشغل

```
READ FIRST (do not redo any of it): docs/PROGRESS.md, docs/DECISIONS.md, Tools/GIS/README.md.
WHAT THE PREVIOUS ATTEMPT (Fable 5.2, Unreal plan) ALREADY DELIVERED AND VERIFIED:
- GIS pipeline, one command: `uv run --directory Tools/GIS python -m wahiba_gis all`; 11 pytest tests passing.
- DEM: Copernicus GLO-30, location confirmed at ~22.38N, 58.78E (northern Wahiba Sands): longitudinal dunes oriented ~8 degrees (north-south), spacing ~2.2 km, local relief ~108 m.
- Heightmap: 4033x4033 at 5 m/px = ~20.16 km square. Max error vs. source DEM: 1.88 m (reprojection only), 5.85 m max / 0.87 m RMS after intentional smoothing + procedural detail layer.
- Extra outputs: sand-type maps (compacted vs. loose), crest/slope masks, sand-ripple texture, 1003 OSM roads (84 tracks) in local coordinates.
WHAT WAS NOT DONE: nothing in Unreal was built (no engine on this machine, integrated GPU only). Phases 2-6 never started. The dune detail layer looked a bit uniform in hillshade; needs visual tuning in the real renderer.
REUSE RULES: consume Data/GIS/out as-is (heightmap, masks, OSM). Convert formats with a small script (e.g., 16-bit PNG / binary float tiles + a JSON manifest) instead of regenerating the GIS.
Do NOT rerun the 7-minute heightmap build unless a parameter changes. The Unreal-specific outputs (Landscape scale values, UE coordinates) are ignored; record only what is still useful.
First task of this section: rewrite CLAUDE.md for the web project (stack, layout, commands, rules from this file) so every future session starts with the right context. Delete the Unreal-only wording.
```

---

## قاعدة التنفيذ (للنموذج)

```
SEQUENCING: Section A -> B -> W1 -> W2 -> W3 -> W4 -> W5 -> W6. Never start the next before the current one meets its DONE WHEN and is verified (build ok, tests ok, measured in a real browser run).
After each phase: update docs/PROGRESS.md (status, evidence, open issues) and docs/DECISIONS.md (why), commit if git exists, then continue without waiting.
FULLY AUTONOMOUS OVERNIGHT RUN: I am asleep for the whole run. You must NEVER ask me a question, never use any ask/confirmation tool, never end your turn between phases, and never wait for input.
Section A -> W6 must run to the end in one continuous run. The only acceptable stopping point is after the FINAL REPORT below is written.
- Need something I would normally provide (a file, a choice, a taste decision)? Pick the most defensible default yourself, build it so it is easy to swap, log it in DECISIONS.md under "Autonomous decisions", and continue.
- A phase cannot fully meet DONE after real attempts (at least 3 distinct fixes tried)? Ship the best working version, mark the unmet criteria "unmet/unverified" in PROGRESS.md with what you tried, and MOVE ON to the next phase. Never loop forever on one problem: cap any single problem at roughly 45 minutes of work.
- Anything destructive or outside the project folder (other than Section A's sure-leftovers): do not do it, skip it, note it in PROGRESS.md.
- Network/download failure: retry a few times with backoff, then use a procedural/offline fallback and log it.
- Keep the game runnable at all times: commit (git init if needed) after each phase on the main branch with a clear message, so a bad phase can be reverted. Never leave the build broken at the end of a phase.
- If you run low on context, compact and resume from docs/PROGRESS.md; that is not a reason to stop.
- FINAL REPORT (the last thing you do): write docs/MORNING_REPORT.md in simple Arabic: how to run the game (exact command), what works, what is unverified/unmet, key FPS numbers, the Autonomous decisions list, and the "maybe" leftover list from Section A. Put the same short summary in your last message.
Never claim success without evidence; write "unverified" explicitly. Do not edit this file's prompts; log deviations in DECISIONS.md.

PLATFORM RULES (non-negotiable):
- The game is a web app: TypeScript + Vite + Three.js (WebGL2; WebGPU only as optional progressive enhancement). It must run with `npm install && npm run dev`, open in the Claude Code Browser pane
  and in any browser, and be launchable from VS Code. No Unreal, no Epic, no Unity, no emulator, no native installs. No paid services.
- Verify by actually running it: start the dev server, open it in the built-in browser, read console errors, take screenshots, measure FPS (performance.now frame times, `?debug` overlay). Test on this machine's integrated GPU: it is the floor target (aim 30+ FPS low preset, 60 FPS where possible), with Low/Medium/High presets.
- Everything data-driven (JSON configs / tuning tables), tunable through a `?debug` panel and URL params. Unit tests (Vitest) for physics maths and a headless smoke test that loads the game and checks no console errors.
- Legal: original or CC0 assets only, no real car logos/models/copyrighted audio. Generate meshes/audio procedurally.

TOKEN RULES (never trade quality for savings; if a saving would hurt correctness, skip it):
A. Fresh context per phase: write what matters to docs/PROGRESS.md + DECISIONS.md, then compact or continue in a new session. The docs are the memory; keep them short.
B. Delegate bulk/mechanical work to cheaper-model subagents (searching code, reading logs, running/summarizing tests, boilerplate, asset-conversion scripts, docs). Keep the main model for physics, sand deformation design, architecture, hard debugging, final verification. Subagents return short summaries with file paths.
C. Read only needed line ranges; never re-read a file you just wrote; filter build/test logs (errors + summary), full logs go to files.
D. Batch independent tool calls. Skip exploratory calls already answered in PROGRESS.md.
E. Small vertical slices that run, not big rewrites. Fix root causes, no blind retries.
F. Short chat output: no recaps; per-phase message max 5 lines; details go in docs.
G. Reasoning effort: High by default; go higher only for genuinely hard problems (vehicle stability, sand deformation, netcode).
H. Reuse Data/GIS/out and existing scripts. Deterministic measure scripts that print one-line results.
```

---

## W1 — العالم: تضاريس بدية الحقيقية في المتصفح

```
Using the existing heightmap and masks (Section B), build the terrain.
- Convert Data/GIS/out to web-friendly tiles/textures + manifest (script in Tools/GIS or Tools/Web). Verify vertical scale against the DEM: dune heights must match reality (report max error in meters by sampling the in-game terrain vs. the source heightmap at test points).
- Terrain renderer: GPU-friendly chunked LOD (CDLOD/clipmap style) using heightmap textures in the vertex shader, covering the 20 km area, streaming/culling so integrated GPUs hold 30+ FPS. Frustum culling, distance fog.
- Sand material (shader): warm golden-orange base, macro color variation from sand-type map (compacted vs. loose), ripple normals from the ripple texture, view-dependent quartz sparkle without flicker, wind streaks on crests.
- Vegetation and props: instanced Ghaf trees and dry shrubs placed by rules from the slope/crest masks (interdune corridors only, no steep slopes, none on tracks), camps/shelters/power poles along OSM tracks. Procedural low-poly meshes. Seed + density as parameters.
- Sky: physically-inspired sky + sun, time-of-day param, haze, so noon and golden hour look right.
DONE WHEN: free-fly camera over the real terrain runs in the browser pane without console errors, screenshots show believable dune scale, FPS numbers recorded, tests green.
```

---

## W2 — الرمل التفاعلي: تشوّه، آثار، غرز، جسيمات

```
Interactive sand, GPU-based and budgeted for integrated GPUs.
- Deformation: a player-following height-delta render target (e.g., 1-2k texture covering ~100-200 m) applied in the terrain vertex shader + normal/color blend for tracks; tire grooves with sand pushed to the sides; slow slumping/relaxation pass so tracks soften. Choose the technique by quick benchmark (justify in DECISIONS.md).
- Sinking/stuck model (pure TypeScript, unit-tested): per-wheel slip ratio, load, tire pressure, sand type (compacted vs. loose from the masks). High slip at low ground speed lowers ground under that wheel and raises rolling resistance until the vehicle is beached. Expose a clean interface for vehicle (W3) and recovery (W6).
- Particles: GPU/instanced sand spray per wheel driven by wheel RPM, slip, steering, sand type, speed; hard particle budget with distance LOD.
DONE WHEN: a test scene lets me drive a placeholder box-vehicle, bury it, see tracks and spray; per-technique benchmark numbers and the final cost are in DECISIONS.md.
```

---

## W3 — فيزياء السيارة

```
Custom raycast-vehicle physics (use Rapier WASM or cannon-es only if it measurably helps; otherwise write the vehicle model yourself on a fixed timestep, 120 Hz substeps).
- Two data-driven presets: Patrol-class heavy SUV (~4.8 L inline-6, ~2.2 t, coil long-travel) and Land-Cruiser-70-pickup-class (solid axles, leaf springs, ~2 t). Look up published specs, cite sources in DECISIONS.md, flag unverified values. No real logos/models.
- Powertrain: torque curve, manual + automatic with shift logic, rev limiter, engine braking, simple turbo lag. Drive modes 2H / 4H / 4L (low-range ratio multiplies torque), center/axle diff lock with real torque-split behavior.
- Tire pressure (airing down) 8-40 PSI: maps to contact patch, cornering stiffness, friction, rolling resistance on hard vs. soft ground, and sinkage (feeds W2). Visual sidewall bulge on the wheel mesh.
- Suspension: spring/damper/bump-stop, anti-roll, center of mass, side-slope behavior that leans/slides believably, aero drag, power loss on long climbs.
- Controls: keyboard + gamepad (Gamepad API analog triggers). Cameras: chase, bonnet, cockpit, with speed-based FOV and optional impact shake (toggle).
- Automated tests: top speed, 0-100, braking, 4L climb, pressure vs. sinkage, side-slope stability; fix NaN/jitter/flip issues. Table of results in PROGRESS.md.
DONE WHEN: vehicle drives stably on the real terrain in the browser at a smooth frame rate, tests green, metrics recorded.
```

---

## W4 — الصوت (Web Audio)

```
Procedural audio with the Web Audio API / AudioWorklet (no copyrighted samples; optional drop-in sample slots via config).
- Engine: RPM/load-driven synth for inline-6 and V8 (firing-order aware), rev limiter hard-cut with pops, overrun crackle/backfire, intake whoosh, turbo spool + flutter.
- Surface/driving: tire scrubbing on sand scaled by slip/speed/pressure, spray hiss, belly impacts, suspension bottoming, low-range gear whine.
- Environment: desert wind with gusts, distance rolloff and high-frequency damping, sparse open-space reverb (no cave-like tails). Spatialization (PannerNode/HRTF) + Doppler for other vehicles, voice-count limits.
- Autoplay policy: start audio after the first user gesture; master volume + mute in the debug panel. Panel to scrub RPM/load/speed and audition each layer.
DONE WHEN: audio binds to the vehicle state, no clicks/glitches, CPU cost measured and noted.
```

---

## W5 — الرسوميات والإضاءة والكاميرا

```
- Lighting/atmosphere: sun/sky/haze tuned for harsh noon and golden hour; time-of-day system (data-driven); soft shadows with cascades (budgeted); tone mapping/exposure so dune contrast reads photographic.
- Effects (each toggleable): heat shimmer post-process (distance-masked), dust haze, wind-blown sand wisps on crests, subtle lens dust.
- Quality presets Low/Medium/High (+ Auto by FPS) documented; screenshots + FPS per preset into PROGRESS.md. Must remain playable on integrated GPU at Low.
DONE WHEN: golden-hour and noon screenshots look good, presets hit their FPS targets, nothing flickers or ghosts in motion.
```

---

## W6 — اللعب: القلص/الونش، الكراج، المهام، الأونلاين

```
- Recovery: tow rope/winch between vehicles or to an anchor (elastic spring-damper rope, max tension, snap, snatch-strap energy, mass-aware); winch with spool speed and pull limit. A beached vehicle (W2) is recoverable only via: lowering pressure, rocking/reversing, digging, towing, winching. HUD prompts + tension indicator.
- Garage: data-driven parts (highway/balloon/paddle tires, suspension, engine/turbo stage, gearing, diff locks, load, snorkel/cooling), each changing real simulation parameters (table of parts x effects, tested). Cosmetic livery separate.
- Modes: free roam, time-attack dune climbs, convoy/recovery missions, photo mode. Mission framework from JSON + localStorage save game.
- Multiplayer (last, optional if blocked by budget): small Node WebSocket server, server-authoritative rope/state with client-side prediction for 2-8 players; test with simulated latency/loss. State clearly what is authoritative.
- Plan max 8 milestones yourself (no approval needed) and execute ALL of them in order. If budget is short, finish single-player first, multiplayer last.
DONE WHEN: a full loop is playable in the browser: drive, get stuck, recover, upgrade, repeat; tests green; docs updated.
```
