# Wahiba Sands Off-Road Game — Prompt Pack for Claude Code (Fable 5.2)

## قاعدة التنفيذ (EXECUTION RULE) — موجهة للنموذج

```
You are given this whole file. Execute it autonomously, strictly in order:
Prompt 0 (adopt as rules) -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6.

SEQUENCING RULES
1. Never start Phase N+1 until Phase N meets its "DONE WHEN" criteria AND you have verified them
   (build passes, tests/measurements run, numbers recorded). Do not skip, merge, or reorder phases.
2. After finishing a phase: update docs/PROGRESS.md (phase status, verification evidence, open issues, assumptions),
   then immediately continue to the next phase WITHOUT waiting for me, unless a stop condition below applies.
3. Before starting any phase, read docs/PROGRESS.md and docs/DECISIONS.md so earlier decisions are respected.
   If you are resuming after a restart or context compaction, find the last phase marked DONE there and continue from the next one.
4. STOP and ask me only if: (a) you need something only I can provide (files, accounts, licenses, a taste decision),
   (b) a phase cannot meet its DONE criteria after real attempts to fix it, or (c) an action is destructive or outside the project folder.
   When stopping, state exactly what is blocked, what you tried, and what you need.
5. A phase is not done if something is unverified. Say "unverified" explicitly; never claim success without evidence.
6. Never edit this file's prompts. Record deviations in docs/DECISIONS.md with the reason.
7. At the very end, print a final report: per-phase status, key measurements, assumptions list, and what remains.

TOKEN-SAVING RULES (must NOT lower result quality; if a saving would hurt correctness, skip the saving)
A. Fresh context per phase: finish a phase, write everything needed into docs/PROGRESS.md + docs/DECISIONS.md, then continue in a clean context
   (compact or start a new session). Never carry the full history of an old phase forward. The two docs are the memory; keep them short and factual.
B. Delegate bulk work to cheaper models via subagents, keep the main model for design and hard decisions. Use a smaller/faster model for:
   searching the codebase/engine headers, reading logs and build output, running and summarizing tests, boilerplate (data assets, config, repetitive Blueprint/C++ scaffolding),
   formatting, docs, and asset-pipeline scripts. Keep the main model for: physics/vehicle/sand algorithms, architecture, networking design, debugging non-obvious failures, final verification.
   Subagents return short summaries (conclusion + file paths), not raw dumps.
C. Read less: grep/glob to locate, then read only the needed line ranges. Never re-read a file you just wrote or edited. Never paste large files, logs or engine source into the chat.
   Filter build/test output (errors and the final summary only; write full logs to a file).
D. Batch independent tool calls in one step. Do not make exploratory calls whose answer you already know from PROGRESS.md/DECISIONS.md.
E. Write once, test early: small vertical slices that build and run, instead of large rewrites that break and need many repair rounds. Fix root causes, do not retry blindly.
F. Short outputs: no recaps of what you just did, no restating the plan, no long explanations in chat. Put detail in the docs files. Final per-phase message: 5 lines max.
G. Reasoning effort: High is the default. Do not escalate to the maximum unless a problem is genuinely hard (sand deformation design, vehicle dynamics stability, replication). Lower effort for mechanical tasks.
H. Reuse instead of regenerate: put shared constants/config in data assets and common code in helpers; do not duplicate large code blocks across phases.
I. Prefer deterministic scripts for repetitive checks (measurement/benchmark scripts that print a one-line result) over interactive trial and error.
```

## طريقة الاستعمال (للمستخدم)
1. ثبّت السكيلز (انظر آخر الملف) واشغّل Claude Code من داخل مجلد المشروع.
2. ضع Prompt 0 في `CLAUDE.md` (اختياري، لأن القاعدة أعلاه تجعله يتبناه تلقائياً، لكن وجوده في CLAUDE.md أضمن في الجلسات الطويلة).
3. أعطِه هذا الملف مع **البرومبت الصغير** الموجود في آخر هذا الملف. لا حاجة لنسخ كل مرحلة بشكل منفصل.
4. هذه الأوامر مكتوبة لنموذج وكيل (agent) ينفّذ فعلاً: يكتب الملفات، يبني المشروع، يشغّل الاختبارات، ويصلح أخطاءه.

---

## Prompt 0 — دستور المشروع (ضعه في CLAUDE.md)

```
# Project: Wahiba Sands Off-Road (Unreal Engine 5, C++ + Blueprint + Python)

## Goal
A realistic open-world dune-bashing ("تطعيس") game set in Ramlat Al Wahiba (Sharqiya Sands), Oman,
real-world 1:1 scale, centered near 22.38N, 58.78E (verify the coordinates against the DEM before using them).

## How you must work
- You are the lead engineer. Act, do not lecture. Write real files, build, run, measure, fix.
- First detect the installed UE version and the project path (look for *.uproject and the Engine install).
  Target the installed version; do not assume 5.4. Use only APIs that exist in that version (check Engine headers/source).
- Prefer C++ modules + data assets for gameplay/physics, Unreal Editor Python scripts (run via UnrealEditor-Cmd -ExecCmds / -run=pythonscript)
  for repeatable editor automation, and give me exact manual editor steps ONLY for things that truly cannot be scripted.
- Every system must be: data-driven (DataAssets/curves, no magic numbers in code), tunable at runtime via console variables (CVars),
  and covered by at least one automated test (Automation Spec or Functional Test) or a headless measurement script.
- Build after each meaningful change (UnrealBuildTool). Never leave the project in a non-compiling state.
- Performance budget: 60 FPS on an RTX 3060-class GPU at 1440p with Lumen; report measurements (stat unit/gpu, Unreal Insights) with numbers.
- Keep docs/PROGRESS.md and docs/DECISIONS.md updated: what is done, what is verified, what is open, and why each design choice was made.
- When a requirement is ambiguous or a real-world figure is uncertain, state your assumption, pick the most defensible value, mark it `// ASSUMPTION:` and list it in docs/DECISIONS.md. Do not invent precise-looking numbers silently.
- Legal: use only assets/data with licenses allowing game use (CC0/CC-BY/own-generated/Quixel-Fab-with-UE-license). Do not copy real car brand logos/models or copyrighted audio. Use original/parametric placeholders with real-world-inspired specs.
- Language: code and comments in English. Talk to me in Arabic (Gulf-friendly), technical terms in English.
```

---

## Prompt 1 — العالم: تضاريس رمال بدية + البيئة

```
Read CLAUDE.md first. Task: build the Wahiba Sands world foundation, end to end, as a reproducible pipeline (not a tutorial).

1. DATA PIPELINE (scripts in /Tools/GIS, Python, reproducible with one command):
   - Choose and justify the best freely usable DEM for the area (compare Copernicus GLO-30, SRTM 1-arc-sec, ALOS AW3D30, and any better open source you can verify exists).
     Download programmatically if network access works; if not, write the script + exact instructions and stop at that point for me to supply the files.
   - Pick the play-area bounding box (target ~20x20 km first, scalable to larger). Reproject to a metric CRS, resample, export 16-bit heightmap(s) sized to valid UE Landscape/World Partition resolutions.
   - Compute and print the exact Landscape Scale X/Y/Z values from the DEM's real resolution and elevation range, so dune heights match reality. Show the math and verify by sampling the imported landscape in-editor against the source DEM (report max error in meters).
   - Real DEMs lose dune micro-detail. Add a procedural detail layer: sand ripples, slip-face sharpening, and wind-aligned dune crest features, driven by dune orientation derived from the DEM itself. Implement it in Python/numpy (or a Gaea/World Machine graph only if I have it installed — check) and keep detail amplitude as a parameter.
   - Pull OpenStreetMap tracks/roads/settlements for the bbox via Overpass API; export as splines/JSON for UE.

2. UNREAL IMPORT (automate with Editor Python / C++ editor utility):
   - World Partition landscape with correct component/section sizes, streaming cells, HLOD setup. Justify the numbers and show me the resulting cell layout.
   - A Landscape material skeleton ready for the sand shader of Prompt 2 (layer slots, RVT outputs reserved).

3. VEGETATION & PROPS via PCG:
   - Create PCG graphs (as assets, built by script where the API allows) placing: Ghaf trees (Prosopis cineraria) in low interdune corridors using slope + height-above-local-minimum + distance-from-crest rules;
     sparse dry shrubs/grasses on dune flanks; Bedouin-style camps, shelters and power poles along the OSM tracks and near settlements.
   - If no suitable meshes exist, generate simple original placeholder meshes procedurally and wire the PCG to swap in final assets later via a DataAsset.
   - Density, seed and exclusion zones must be parameters. Verify no props spawn on slopes > threshold or inside the road corridor.

DONE WHEN: the project opens, the landscape streams without hitches, a flythrough capture shows correct dune scale, stat unit numbers are recorded in docs/PROGRESS.md, and every script runs from a clean checkout.
Ask me only if you are blocked by something only I can provide (files, licenses, a decision). Otherwise proceed.
```

---

## Prompt 2 — الرمل: الشيدر + التشوّه + الغرز + الجسيمات

```
Read CLAUDE.md and docs/PROGRESS.md. Task: interactive sand — look, deformation, sinking, and particles — implemented and measured.

1. SAND LOOK: Landscape material for Wahiba sand: warm golden-orange base with macro color variation, wind ripples (normal/heights), view-angle dependent sparkle from quartz grains
   (micro-glints, no aliasing/flicker in motion), wetness-free dry look, and wind-blown surface streaks on crests. Expose parameters in a Material Parameter Collection.

2. DEFORMATION: Evaluate the viable techniques for the installed UE version and pick one WITH EVIDENCE:
   (a) Landscape Patches / Landscape Brush render-target height edits,
   (b) a local-area top-down height RenderTarget (follows the player) feeding WPO/virtual displacement + RVT-blended normal/color for tracks,
   (c) any engine-native sand/snow-trail approach that exists in this version.
   Build a small benchmark for each candidate if needed, record GPU/CPU cost and visual quality, then implement the winner.
   Requirements: tires leave persistent grooves with displaced sand pushed to the sides; deformation fades/relaxes with a slope-based "sand slumping" pass so tracks soften over time; works at the 20 km scale (only a window around players is simulated); multiplayer-friendly data flow (note what must replicate).

3. SINKING / STUCK MECHANICS (C++ component, data-driven): per wheel compute slip ratio (wheel angular speed vs. ground speed), load, tire pressure and sand compaction.
   Sand types as a DataAsset curve set: compacted (interdune floor), loose (crest/slip face). If slip stays high with low ground speed, ground height under that wheel is lowered gradually and rolling resistance rises
   until the vehicle is beached (belly contact). Provide a tuning table and a debug HUD graph. Expose a clear interface the vehicle (Prompt 3) and recovery (Prompt 6) systems consume.

4. PARTICLES: Niagara sand spray per wheel; spawn rate, velocity, direction and size driven by wheel RPM, slip, steering angle, sand type, and vehicle speed. Use GPU sims and cap budget; include an LOD/distance culling plan.

DONE WHEN: a test map lets me drive a placeholder vehicle, bury it deliberately, and see tracks + spray; benchmark numbers for each technique and the final cost are in docs/DECISIONS.md.
```

---

## Prompt 3 — فيزياء السيارة (Chaos Vehicles) والتنسيم والتعليق

```
Read CLAUDE.md and docs/PROGRESS.md. Task: a high-fidelity 4x4 off-road vehicle model on Chaos Vehicles (extend it in C++ where the stock component is not enough).

Vehicles are data-driven; first ship two presets with realistic, sourced-or-flagged-as-assumption specs:
 - Patrol-class heavy SUV (inline-6 petrol ~4.8 L, ~2.2 t, long-travel coil suspension),
 - Land-Cruiser-70-pickup-class (solid axles, leaf springs, ~2 t).
Do not use real logos/models; use placeholder rigs. Look up published specs (peak power/torque, gear ratios, final drive, transfer-case low range ratio, curb weight, wheelbase, track) and cite sources in docs/DECISIONS.md; flag anything unverified.

Deliver:
1. Powertrain: torque curve asset, manual + automatic gearboxes, realistic shift logic, rev limiter, engine braking, turbo lag as a simple model.
   Drive modes: 2H / 4H / 4L (low range multiplies torque and reduces speed with proper ratios), center and axle diff lock states with realistic torque split behavior (open vs. locked), implemented in the drivetrain, not faked.
2. Tire pressure ("تنسيم"): runtime variable 8–40 PSI. Map pressure to contact patch length/width, cornering stiffness, longitudinal friction, rolling resistance on hard vs. soft ground, and sinkage coefficient (feeds Prompt 2's sand system).
   Visually bulge the sidewall via WPO or morph-driven wheel mesh parameter. Provide a single physically-reasoned tuning curve asset and explain each coefficient in comments.
3. Suspension & chassis: long-travel springs/dampers with bump stops, anti-roll, correct center-of-mass, side-slope stability (side-sloping on dune faces should lean and slide believably, not flip arbitrarily), and speed-dependent aerodynamic drag.
   Add a hill-climb power model: engine power falls with altitude/revs and traction depends on sand type; verify the vehicle climbs a 30 degree compacted slope and fails on loose slip face at low tire pressure vs. succeeds at lowered pressure.
4. Input: keyboard, gamepad with analog triggers, steering wheel (Force Feedback hooks). Handle stationary spin-up, launch, and recovery gracefully.
5. TESTS: automated drive tests (Functional Test maps or headless scripts) for: top speed, 0–100, braking distance, 4L climb, tire-pressure effect on sinkage, side-slope stability. Output a metrics table to docs/PROGRESS.md and fix instability found (NaNs, jitter, flipping).

Ask me only about decisions that change the game feel (arcade vs. sim lean); otherwise default to "simulation-leaning but fun".
```

---

## Prompt 4 — الصوت (MetaSounds)

```
Read CLAUDE.md and docs/PROGRESS.md. Task: a vehicle and environment audio system in MetaSounds.

No copyrighted samples. Choose one: (a) author a procedural engine synth in MetaSounds (harmonic/granular, firing-order aware for inline-6 and V8), or (b) a sample-based setup using royalty-free/CC0 loops that I supply — build the pipeline so replacing samples is a drag-and-drop DataAsset change. Recommend and implement the better option for quality/effort, and say why.

Deliver:
1. Engine: RPM/load-driven layers (idle, on-throttle, off-throttle), rev limiter hard-cut with pops, backfire/overrun crackle on lift, intake/air-filter whoosh, turbo spool + blow-off flutter.
2. Surface/driving: tire scrubbing on sand scaled by slip + speed + tire pressure, sand spray hiss, chassis/belly impacts with the dune, suspension bottoming, gear whine in low range.
3. Environment: desert wind with gust variation, distance-based high-frequency rolloff, open-space reverb/early-reflection setup (convolution or Submix reverb with sparse reflections), no cave-like reverb.
4. Spatial: Doppler for other players, per-camera mix (cockpit/chase/bonnet), attenuation and concurrency rules to keep voice count low.
5. A debug panel to scrub RPM/load/speed and audition each layer; document the parameter interface the vehicle component exposes.

DONE WHEN: parameters bind from the vehicle component, the debug panel works, and CPU audio cost is measured and noted.
```

---

## Prompt 5 — الرسوميات والإضاءة والطقس

```
Read CLAUDE.md and docs/PROGRESS.md. Task: photorealistic Omani desert lighting, atmosphere and camera, with measured performance.

1. Lighting: Lumen GI/reflections tuned for bright desert (check engine version for best Lumen/Virtual Shadow Map settings), physically based sun intensity/exposure workflow (state the lux/EV values you use and why), Sky Atmosphere with warm dusty aerosol parameters, volumetric clouds sparse/high.
   Build a time-of-day system (data-driven) with noon harsh sun, golden hour, and dusk; auto-exposure tuning for dune contrast.
2. Atmosphere FX: heat shimmer post-process (distance-masked, off at low heat), dust/haze depth fog tinted correctly, wind-blown sand wisps on crests (integrates with Prompt 2 parameters), subtle lens dust. Make every effect toggleable and budgeted.
3. Camera: cockpit, bonnet, chase, drone/cinematic cameras on CineCamera with realistic lens/aperture/exposure settings, speed-based FOV, camera shake from impacts/bumps driven by suspension events, with an accessibility option to disable shake.
4. Scalability: Low/Medium/High/Cinematic presets; document what each changes. Capture comparison screenshots and numbers (stat gpu) per preset into docs/PROGRESS.md.

DONE WHEN: golden-hour and noon screenshots read as photographic, presets hit their FPS targets, and nothing flickers or ghosts in motion.
```

---

## Prompt 6 — اللعب: الونش/الحبل، الكراج، الأونلاين، التقدّم

```
Read CLAUDE.md and docs/PROGRESS.md. Task: core gameplay loop, built on the systems from Prompts 1–5.

1. RECOVERY: tow rope / winch between two vehicles or vehicle-to-anchor using Cable/physics constraints properly (rope as elastic spring-damper with max tension, snap threshold, snatch-strap kinetic energy, mass-aware).
   Winch mode with spool speed + pull limit. A stuck vehicle (from Prompt 2's beached state) must be recoverable only by: lowering pressure, reversing/rocking technique, digging, towing, or winching. Expose UX: prompts, rope attach points, tension indicator.
2. GARAGE/CUSTOMIZATION: data-driven parts (tires: highway / balloon / paddle; suspension kits; engine/turbo stage; gearing; diff locks; weight/roof load; snorkel/cooling).
   Each part must modify real simulation parameters (grip, sinkage, mass, power curve) — show a table of parts × effects and test that each measurably changes behavior. Cosmetic paint/livery slot separate.
3. MODES: free roam, time-attack dune climbs, convoy/recovery missions, photo mode. Simple mission framework (DataAssets) + save game.
4. MULTIPLAYER: dedicated-server-ready architecture. State clearly what is server-authoritative (vehicle physics, rope, sand deformation seeds) and what is client-side cosmetic. Implement co-op convoy of 2–8 players using Unreal's replication, with client prediction strategy for Chaos Vehicles justified in docs/DECISIONS.md. Test with a PIE multi-client + simulated latency/packet-loss and report results.
5. Quality: automated tests for rope snap, part effects, save/load, replication smoke test. Update docs/PROGRESS.md.

Start by proposing the milestone breakdown (max 8 milestones, each with a demoable result) and then execute milestone 1 immediately.
```

---

## البرومبت الصغير (انسخه واعطه لـ Claude Code مع الملف)

```
اقرأ الملف PROMPTS_Wahiba_Offroad.md بالكامل ونفّذه حرفياً. ابدأ بـ "EXECUTION RULE" ثم Prompt 0 ثم المراحل 1 إلى 6 بالترتيب.
لا تنتقل لمرحلة قبل ما تنتهي من السابقة وتتحقق منها وتسجلها في docs/PROGRESS.md، وبعدها كمّل للمرحلة التالية مباشرة بدون ما تنتظرني.
وقف واسألني فقط حسب شروط التوقف في الملف. كلمني بالعربي.
وفّر التوكن بدون ما تأثر على جودة النتيجة، واتبع قسم TOKEN-SAVING RULES في الملف:
- بعد كل مرحلة اكتب كل شي مهم في docs/PROGRESS.md و docs/DECISIONS.md ثم كمّل بسياق نظيف (compact أو جلسة جديدة) بدل ما تحمل تاريخ المرحلة القديمة.
- وزّع الشغل الروتيني (بحث في الكود، قراءة اللوقات، تشغيل الاختبارات، الملفات المتكررة، الوثائق) على subagents بنموذج أصغر وأسرع،
  واحتفظ بالنموذج الأقوى للخوارزميات الصعبة والتصميم والتحقق النهائي.
- اقرأ الأسطر اللازمة فقط، ولا تعد قراءة ملف كتبته، ولا تطبع لوقات طويلة (اكتبها في ملف وارجع لأهم السطور).
- ردودك قصيرة، والتفاصيل تروح للملفات. استخدم High كمعدل تفكير، ولا ترفع لأعلى مستوى إلا في مشكلة صعبة فعلاً.
- استخدم engineering:testing-strategy عند كتابة الاختبارات و engineering:documentation عند تحديث الوثائق.
```

---

## السكيلز (Skills) اللي تقصدها
**skills.sh من Vercel** (الموقع: https://skills.sh) — مكتبة/ليدربورد مفتوحة لـ Agent Skills أطلقتها شركة **Vercel** في 20 يناير 2026، مع أداة `skills` CLI.
التثبيت والبحث:
```
npx skills find unreal
npx skills add <owner>/<repo>
```
تنبيه: الترتيب فيها حسب عدد التثبيتات وليس تدقيقاً أمنياً، فراجع أي سكيل قبل ما تثبته (خصوصاً اللي فيها سكربتات).
