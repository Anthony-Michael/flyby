# SkyHaul daily playtest routine — scheduled-task prompt

This is the prompt for the recurring `skyhaul-playtest-round` scheduled task.
To set it up on a new machine: open Claude Code in this repo and say
"Create a daily 9:00 AM scheduled task named skyhaul-playtest-round using the
prompt in playtest/ROUTINE-PROMPT.md, with REPO_PATH replaced by this repo's
absolute path." Run it once manually to pre-approve tool permissions.
Only ONE machine should run this task at a time (concurrent runs race on git push).

---

You are the lead developer running one autonomous playtest→triage→fix→ship round on SkyHaul, a browser bush-pilot flying game. Work with no user input; make evidence-backed decisions yourself.

## Project
- Repo: REPO_PATH (git; remote https://github.com/Anthony-Michael/flyby.git, branch main; live at https://anthony-michael.github.io/flyby/ via GitHub Pages, auto-deploys on push; CI runs `node --test` on push)
- Zero-dependency vanilla-JS Canvas game. Pure logic core (src/physics.js, sim.js, landing.js, terrain.js, economy.js, migrate.js, data/) + thin impure shell (renderer, hud, input, game). Design contract: docs/DESIGN.md. Tests: `npm test` (node --test, must stay green).
- Playtest infrastructure in playtest/: humanPilot.js (human-imperfect pilot: reaction delay, micro-tap keys, seeded variation, skill profiles firstTimer/secondTry/warmedUp/robot), run.js (skill×mission matrix), impact-probe/funnel-probe/miss-probe/campaign-probe/feasibility/qa-* scripts, and FINDINGS-ROUND*.md (previous rounds' findings, fixes, and the open backlog — READ THE LATEST ONE FIRST).

## Round procedure
1. `git pull` in REPO_PATH and run `npm test` to confirm a green baseline. Read the latest playtest/FINDINGS-ROUND*.md for the open backlog.
2. Pick the 1–3 highest-value open items from that backlog. If subagent capacity is available you may parallelize with background agents; otherwise work inline.
3. Gather evidence with headless probes (extend playtest/, keep scripts deterministic — seeded PRNG only), then fix what the evidence justifies. Rules: pure-core discipline (no DOM in logic modules); update docs/DESIGN.md and the pinned tests together with any tolerance/content change; grading stays strict (survival forgiving, ★★★ hard); never weaken a test just to pass it.
4. Verify: `npm test` fully green + rerun playtest/run.js matrix and compare against the previous round's numbers recorded in the latest findings file — no regressions.
5. Write playtest/FINDINGS-ROUND<N>.md (findings, evidence, actions, new open backlog with the fresh matrix numbers as next round's baseline). Commit with a descriptive message ending in the Claude co-author line, push to main, and confirm CI passes (`gh run list`) and Pages serves the change (fetch a changed file and check for a new marker).
6. Finish with a concise report: what was measured, what shipped, metric movement, what's next round.

Constraints: keep the game zero-dependency; do not add monetization code beyond the existing monetize.js hooks; do not create new remotes/services; if the working tree has unexpected uncommitted changes at start, stop and report instead of committing them.
