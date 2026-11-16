| Slot | Option | Price | Effect | patrol stock → fitted |
|---|---|---|---|---|
| Tyres | All-terrain (stock) | 0 | — | — |
| Tyres | Highway tyres | 300 | mul tyre.mu_hard 1.06 | 1 → 1.06 |
| Tyres | Highway tyres | 300 | mul tyre.mu_sand 0.85 | 0.62 → 0.527 |
| Tyres | Highway tyres | 300 | mul tyre.width 0.93 | 0.275 → 0.256 |
| Tyres | Highway tyres | 300 | mul tyre.shapeSand 0.95 | 1.08 → 1.026 |
| Tyres | Wide desert balloon tyres | 900 | mul tyre.width 1.3 | 0.275 → 0.358 |
| Tyres | Wide desert balloon tyres | 900 | add tyre.radius 0.02 | 0.396 → 0.416 |
| Tyres | Wide desert balloon tyres | 900 | mul tyre.sidewall_m 1.2 | 0.19 → 0.228 |
| Tyres | Wide desert balloon tyres | 900 | mul tyre.mu_sand 1.06 | 0.62 → 0.657 |
| Tyres | Wide desert balloon tyres | 900 | mul tyre.inertia 1.25 | 3.4 → 4.25 |
| Tyres | Wide desert balloon tyres | 900 | add mass 40 | 2500 → 2540 |
| Tyres | Sand paddle tyres (rear-biased grip) | 1400 | mul tyre.mu_sand 1.3 | 0.62 → 0.806 |
| Tyres | Sand paddle tyres (rear-biased grip) | 1400 | mul tyre.mu_hard 0.75 | 1 → 0.75 |
| Tyres | Sand paddle tyres (rear-biased grip) | 1400 | mul tyre.kappaPeak 1.6 | 0.11 → 0.176 |
| Tyres | Sand paddle tyres (rear-biased grip) | 1400 | mul tyre.width 1.15 | 0.275 → 0.316 |
| Tyres | Sand paddle tyres (rear-biased grip) | 1400 | mul tyre.inertia 1.2 | 3.4 → 4.08 |
| Suspension | Stock | 0 | — | — |
| Suspension | Long-travel kit (+60 mm, softer) | 2200 | add susp.*.travel 0.06 | 0.28 → 0.34 |
| Suspension | Long-travel kit (+60 mm, softer) | 2200 | mul susp.*.spring 0.85 | 50000 → 42500 |
| Suspension | Long-travel kit (+60 mm, softer) | 2200 | mul susp.*.antiRoll 0.8 | 12000 → 9600 |
| Suspension | Long-travel kit (+60 mm, softer) | 2200 | add body.groundClearance 0.04 | 0.23 → 0.27 |
| Suspension | Long-travel kit (+60 mm, softer) | 2200 | add cgHeight 0.04 | 0.82 → 0.86 |
| Suspension | Heavy-duty (stiffer, for load) | 1200 | mul susp.*.spring 1.3 | 50000 → 65000 |
| Suspension | Heavy-duty (stiffer, for load) | 1200 | mul susp.*.bump 1.25 | 4000 → 5000 |
| Suspension | Heavy-duty (stiffer, for load) | 1200 | mul susp.*.rebound 1.25 | 6800 → 8500 |
| Suspension | Heavy-duty (stiffer, for load) | 1200 | mul susp.*.antiRoll 1.25 | 12000 → 15000 |
| Engine | Stock | 0 | — | — |
| Engine | Stage 1 (intake, exhaust, tune: +8 %) | 1500 | mulCurve engine.torqueCurve  | peak 188 kW → 204 kW |
| Engine | Turbo kit (+30 % above 2000 rpm, lag) | 5500 | mulCurve engine.torqueCurve  | peak 188 kW → 245 kW |
| Engine | Turbo kit (+30 % above 2000 rpm, lag) | 5500 | setIfNull engine.turbo  | null → {"lag_s":0.8,"naFrac":0.7,"spoolRpm":2000} |
| Engine | Turbo kit (+30 % above 2000 rpm, lag) | 5500 | mul engine.thermal.heatPerSecFull 1.25 | 0.6 → 0.75 |
| Gearing | Stock | 0 | — | — |
| Gearing | Shorter final drive (+12 %) | 1100 | mul gearbox.final 1.12 | 3.9 → 4.368 |
| Gearing | Crawler low range (x1.4) | 1600 | mul gearbox.lowRange 1.4 | 2.02 → 2.828 |
| Diff lockers | As delivered | 0 | — | — |
| Diff lockers | Rear locker | 900 | set driveline.rearLocker  | true → true |
| Diff lockers | Front + rear lockers | 1900 | set driveline.rearLocker  | true → true |
| Diff lockers | Front + rear lockers | 1900 | set driveline.frontLocker  | false → true |
| Load | Empty | 0 | — | — |
| Load | Camping gear, water, fuel (+250 kg) | 0 | add mass 250 | 2500 → 2750 |
| Load | Camping gear, water, fuel (+250 kg) | 0 | add cgHeight 0.04 | 0.82 → 0.86 |
| Load | Camping gear, water, fuel (+250 kg) | 0 | add frontWeightFrac -0.03 | 0.53 → 0.5 |
| Load | Fully loaded (+500 kg, roof rack) | 0 | add mass 500 | 2500 → 3000 |
| Load | Fully loaded (+500 kg, roof rack) | 0 | add cgHeight 0.09 | 0.82 → 0.91 |
| Load | Fully loaded (+500 kg, roof rack) | 0 | add frontWeightFrac -0.05 | 0.53 → 0.48 |
| Snorkel / cooling | Stock | 0 | — | — |
| Snorkel / cooling | Snorkel (cooler, cleaner air: +3 %) | 600 | mulCurve engine.torqueCurve  | peak 188 kW → 194 kW |
| Snorkel / cooling | Snorkel (cooler, cleaner air: +3 %) | 600 | mul engine.thermal.heatPerSecFull 0.92 | 0.6 → 0.552 |
| Snorkel / cooling | Snorkel + big radiator + oil cooler | 1800 | mulCurve engine.torqueCurve  | peak 188 kW → 194 kW |
| Snorkel / cooling | Snorkel + big radiator + oil cooler | 1800 | mul engine.thermal.coolPerSec 1.8 | 0.02 → 0.036 |
| Snorkel / cooling | Snorkel + big radiator + oil cooler | 1800 | add engine.thermal.derateStartC 8 | 105 → 113 |
| Snorkel / cooling | Snorkel + big radiator + oil cooler | 1800 | mul engine.thermal.heatPerSecFull 0.85 | 0.6 → 0.51 |
