// hardcore-campaign.mjs — fly all 8 campaign missions with the stock Kestrel.
import { MISSIONS } from '../src/data/missions.js';
import { PLANES, effectivePlane } from '../src/data/planes.js';
import { flyMission, fmt, stallSpeed } from './hardcore-lib.mjs';

const kestrel = PLANES.kestrel;

// per-mission pilot tweaks a competent player would make
const TWEAKS = {
  m3: { cruiseSpeed: 32 },                      // heavy — keep speed margin modest
  m5: { clearance: 60, lookahead: 900 },        // ridge + downdraft after it
  m6: { approachSpeed: 26, touchSpeed: 21 },    // short shelf strip, charter
  m7: { cruiseSpeed: process.env.M7SPEED ? +process.env.M7SPEED : 33 }, // fuel economy
  m8: { clearance: 60, approachSpeed: 27, touchSpeed: 22, flareH: 5 },  // gusts + cliff shelf
};

console.log('=== CAMPAIGN, stock Kestrel, tuned feedback pilot ===');
for (const m of MISSIONS) {
  const r = flyMission(m, kestrel, TWEAKS[m.id] ?? {});
  const vs = stallSpeed(m, kestrel);
  console.log(`${m.id} ${m.name.padEnd(14)} dist=${(m.endRunway.x - m.startRunway.x) / 1000}km cargo=${m.cargoKg}kg wind=${m.wind.baseX}/${m.wind.gustAmp} vStall=${vs.toFixed(1)}`);
  console.log(`   ${fmt(r)}`);
  if (m.id === 'm7') {
    console.log(`   par=${m.parTimeS}s touchdownT=${r.touchdownT?.toFixed(0)}s beatPar=${r.touchdownT != null && r.touchdownT <= m.parTimeS}`);
  }
}

// also: default pilot with NO per-mission tweaks (a less adaptive player)
console.log('\n=== CAMPAIGN, default pilot params (no tweaks) ===');
for (const m of MISSIONS) {
  const r = flyMission(m, kestrel, {});
  console.log(`${m.id} ${fmt(r)}`);
}
