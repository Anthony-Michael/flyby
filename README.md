# SkyHaul ✈️

### [▶ Play SkyHaul](https://anthony-michael.github.io/flyby/)

[![CI](https://github.com/Anthony-Michael/flyby/actions/workflows/ci.yml/badge.svg)](https://github.com/Anthony-Michael/flyby/actions/workflows/ci.yml)

A bush-pilot cargo flying game for the browser. Take off, thread the mountain passes of the Kettle Range, and — most importantly — land *gently*. The landing grade is your paycheck.

- **Tech:** HTML5 Canvas + vanilla ES modules. Zero build step, zero dependencies.
- **Play:** [in your browser](https://anthony-michael.github.io/flyby/), or serve the folder statically (`npm start` → http://localhost:8000).
- **Test:** `npm test` (uses `node --test`, no deps).

## Features

- Arcade-but-honest flight model: lift, drag, thrust, gravity, stall, wind & gusts
- Skill-based takeoff and graded landings (★–★★★ with per-factor breakdown)
- 8-mission campaign + procedurally seeded Free Contracts
- Economy & progression: earn per landing grade, buy planes & upgrades
- Progress persisted in localStorage

## Controls

| Key | Action |
|---|---|
| ↑ / ↓ | Pitch up / down |
| W / S | Throttle up / down |
| B (hold) | Wheel brakes |
| R | Restart mission |
| P / Esc | Pause |

## Architecture

Pure logic core (`physics`, `terrain`, `landing`, `sim`, `economy`, `migrate`, mission data) with a thin impure shell (`renderer`, `hud`, `input`, `game`). Impure modules may import pure ones — never the reverse. Full design: [docs/DESIGN.md](docs/DESIGN.md).
