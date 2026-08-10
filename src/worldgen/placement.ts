/**
 * Where everything is, this life.
 *
 * Takes the Gazetteer (what exists, forever) and a Draft seed, and produces the
 * other half of the world: a position and a condition for every place. Rerolled
 * on death, which is what makes the same Ostreya a different journey each time.
 *
 * The rule that matters: **affinities are scored, never enforced.** A coastal
 * town that lands inland is not re-rolled — the mismatch is recorded and the
 * game says it out loud. Hard constraints would produce nearly the same map
 * every life and kill the premise; unconstrained randomness produces nonsense,
 * and nonsense reads as a bug rather than as the world coming apart. Scoring
 * with recorded violations is the only one of the three that gets both.
 */

import type { Rng } from '../core/rng.ts';
import { ClimateMap } from './fields.ts';
import { GAZETTEER, CONDITIONS } from './gazetteer.ts';
import type { GazetteerEntry, Affinity, Condition } from './gazetteer.ts';

export interface PlacedSite {
  entry: GazetteerEntry;
  /** room coordinates on the world grid */
  rx: number;
  ry: number;
  condition: Condition;
  /** ring distance from the wake point, 0..1 — this is the difficulty dial */
  threat: number;
  /**
   * Affinities this position fails to honour. Not an error: these are what the
   * game *tells the player*, and they are the sound of the world being wrong.
   */
  violations: Affinity[];
}

export interface WorldPlacement {
  sites: PlacedSite[];
  /** where Aldez wakes; moves every Draft, so "safe" is never the same region */
  wake: { rx: number; ry: number };
  gridW: number;
  gridH: number;
  byId: Map<string, PlacedSite>;
}

/**
 * How well a climate sample honours one affinity, 0..1.
 *
 * Deliberately gradual — a hard threshold would make every coastal town sit on
 * an identical shoreline, and the point is that they vary.
 */
function affinityScore(a: Affinity, elevation: number, moisture: number, temperature: number): number {
  switch (a) {
    case 'coastal': return clamp01(1 - Math.abs(elevation - 0.22) * 3.2);
    case 'inland': return clamp01((elevation - 0.3) * 2.2);
    case 'high': return clamp01((elevation - 0.55) * 2.6);
    case 'lowland': return clamp01(1 - Math.abs(elevation - 0.28) * 2.8);
    case 'fertile': return clamp01(1 - Math.abs(moisture - 0.6) * 2.6);
    case 'arid': return clamp01((0.35 - moisture) * 3.4);
    case 'cold': return clamp01((0.42 - temperature) * 3.0);
    case 'warm': return clamp01((temperature - 0.55) * 2.8);
    case 'forested': return clamp01(1 - Math.abs(moisture - 0.68) * 2.4);
    case 'open': return clamp01(1 - Math.abs(moisture - 0.45) * 2.2);
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** An affinity scoring below this is *violated*, and gets said out loud. */
const VIOLATION_THRESHOLD = 0.25;

/**
 * Place every Gazetteer entry.
 *
 * Ordered by constraint tightness — Sanctums and the capital choose first,
 * villages take what is left — because the tightly-constrained entries have
 * fewer good cells and letting a village take one is how you end up with the
 * capital in a bog for no reason.
 */
export function placeWorld(
  climate: ClimateMap,
  rng: Rng,
  gridW: number,
  gridH: number,
  instability: number,
): WorldPlacement {
  const cx = (gridW - 1) / 2;
  const cy = (gridH - 1) / 2;
  const maxRing = Math.hypot(cx, cy);

  // The wake point moves every Draft, so the safe region is somewhere new each
  // life. Kept off the extreme edge so the world surrounds the player.
  const wakeRng = rng.stream('wake');
  const wake = {
    rx: Math.round(cx + wakeRng.range(-0.28, 0.28) * gridW),
    ry: Math.round(cy + wakeRng.range(-0.28, 0.28) * gridH),
  };

  const ringOf = (rx: number, ry: number): number =>
    Math.min(1, Math.hypot(rx - wake.rx, ry - wake.ry) / maxRing);

  // Tightest first. Sanctums also carry a target ring, which is the strongest
  // constraint of all, so they lead.
  const order = [...GAZETTEER].sort((a, b) => {
    const rank = (e: GazetteerEntry): number =>
      (e.sanctumIndex !== undefined ? 0 : e.kind === 'capital' ? 1 : e.kind === 'town' ? 2 : 3);
    return rank(a) - rank(b) || b.affinities.length - a.affinities.length;
  });

  const taken: PlacedSite[] = [];
  const sites: PlacedSite[] = [];

  for (const entry of order) {
    const pick = rng.stream(`site:${entry.id}`);
    // Jitter grows with instability: a stable Draft looks almost like the world
    // the player remembers, a late one is a catalogue of things in wrong places.
    const wobble = 0.1 + Math.min(0.5, instability * 0.09);

    let best: { rx: number; ry: number; score: number } | null = null;
    // Sample rather than sweep: the grid is large and a few hundred candidates
    // find a good cell without the solver becoming the slowest thing in the game.
    for (let attempt = 0; attempt < 260; attempt++) {
      const rx = pick.int(1, gridW - 2);
      const ry = pick.int(1, gridH - 2);
      if (tooClose(taken, rx, ry, entry.footprint)) continue;

      const c = climate.sample(rx, ry);
      let score = 0;
      for (const a of entry.affinities) {
        score += affinityScore(a, c.elevation, c.moisture, c.temperature);
      }
      score /= Math.max(1, entry.affinities.length);

      // Distance from the entry's intended ring. This is what spreads the eight
      // Sanctums into an exploration order without a single locked door.
      const ringErr = Math.abs(ringOf(rx, ry) - entry.ring);
      score -= ringErr * 1.6;
      score += pick.range(-wobble, wobble);

      if (!best || score > best.score) best = { rx, ry, score };
    }

    // Every entry places. A world missing a Sanctum is unfinishable, so the
    // fallback is a free cell rather than a skipped place.
    const spot = best ?? freeCell(taken, pick, gridW, gridH, entry.footprint);
    const c = climate.sample(spot.rx, spot.ry);
    const violations = entry.affinities.filter(
      (a) => affinityScore(a, c.elevation, c.moisture, c.temperature) < VIOLATION_THRESHOLD,
    );

    const placed: PlacedSite = {
      entry,
      rx: spot.rx,
      ry: spot.ry,
      condition: pick.pick(CONDITIONS as readonly Condition[]),
      threat: ringOf(spot.rx, spot.ry),
      violations,
    };
    taken.push(placed);
    sites.push(placed);
  }

  return {
    sites,
    wake,
    gridW,
    gridH,
    byId: new Map(sites.map((s) => [s.entry.id, s])),
  };
}

/** Sites need elbow room, scaled to the larger of the two footprints. */
function tooClose(taken: readonly PlacedSite[], rx: number, ry: number, footprint: number): boolean {
  for (const t of taken) {
    const need = 2 + Math.max(footprint, t.entry.footprint);
    if (Math.abs(t.rx - rx) < need && Math.abs(t.ry - ry) < need) return true;
  }
  return false;
}

function freeCell(
  taken: readonly PlacedSite[],
  rng: Rng,
  gridW: number,
  gridH: number,
  footprint: number,
): { rx: number; ry: number } {
  for (let i = 0; i < 4000; i++) {
    const rx = rng.int(1, gridW - 2);
    const ry = rng.int(1, gridH - 2);
    if (!tooClose(taken, rx, ry, footprint)) return { rx, ry };
  }
  return { rx: 1, ry: 1 };
}

/**
 * What the player is told about a place before they have found it.
 *
 * The lead line. This is the answer to "what am I looking for" — every waking
 * names somewhere worth walking to, built from the Draft's own variables rather
 * than from authored quest text.
 */
export function describeLead(site: PlacedSite, from: { rx: number; ry: number }): string {
  const dx = site.rx - from.rx;
  const dy = site.ry - from.ry;
  const ns = dy < -1 ? 'north' : dy > 1 ? 'south' : '';
  const ew = dx < -1 ? 'west' : dx > 1 ? 'east' : '';
  const dir = `${ns}${ew}` || 'near';
  const far = Math.hypot(dx, dy);
  const reach = far > 18 ? 'a long way' : far > 9 ? 'some distance' : 'not far';
  return `${site.entry.name.toLowerCase()} lies ${reach} to the ${dir}`;
}

/** The sentence a violated affinity earns. This is the world sounding wrong. */
export function describeViolation(site: PlacedSite): string | null {
  const v = site.violations[0];
  if (!v) return null;
  const name = site.entry.name;
  switch (v) {
    case 'coastal': return `${name} has a harbour wall, and no water behind it`;
    case 'high': return `${name} was built for a mountain that is not here`;
    case 'cold': return `nothing in ${name} has ever needed a fire, and every house has one`;
    case 'warm': return `the orchards of ${name} are under frost that does not lift`;
    case 'forested': return `${name} is a woodcutters' town with no wood`;
    case 'arid': return `the salt roads into ${name} run through green`;
    case 'fertile': return `${name} keeps granaries, and nothing grows`;
    case 'lowland': return `${name} sits higher than its own aqueduct`;
    case 'inland': return `the roads out of ${name} end in water`;
    case 'open': return `${name} was laid out for a plain that has closed in`;
  }
}
