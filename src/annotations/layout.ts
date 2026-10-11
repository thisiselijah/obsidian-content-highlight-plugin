// Pure layout for annotations. All coordinates share one space (the overlay's
// scroll-content coordinates), so this has no DOM access.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface AnnotationAnchor {
  id: string;
  // Stable per annotation (derived from its text), so its random variation
  // is the same on every render.
  seed: number;
  // One rect per rendered line fragment of the highlight.
  rects: Box[];
}

export type Placement =
  | { kind: "note"; id: string; note: Box; arrow: Point[] }
  | { kind: "marker"; id: string; at: Point };

export interface NoteSize {
  width: number;
  height: number;
}

// A note's size, plus one box per line of its text, relative to its top-left corner.
export interface NoteMeasure extends NoteSize {
  lines: Box[];
}

// The last layout of each annotation, relative to its highlight's top-left
// corner (keyed by annotation id). `followMemory` replays it as the highlight
// moves; a full layout starts from it.
export type MemoryEntry =
  | { kind: "note"; offset: Point; size: NoteSize; arrow: Point[] }
  | { kind: "marker" };
export type LayoutMemory = Map<string, MemoryEntry>;

/**
 * Force model, with every length in line heights (L) so the layout scales
 * with font size and zoom instead of using fixed pixel thresholds.
 */
const FORCES = {
  // Gap between a note and its highlight that the spring settles at.
  restGap: 1.6,
  spring: 0.12,
  // Clearance notes keep from text, and from each other.
  textClearance: 0.35,
  noteClearance: 0.6,
  // Share of an overlap resolved per iteration.
  overlapPush: 0.5,
  // Push off the highlight's own line, so arrows come in at a slant.
  rowAvoid: 0.25,
  // Push off another annotation's connector.
  arrowAvoid: 0.4,
  // Largest move per iteration.
  maxStep: 0.6,
  // Notes wider than this wrap.
  maxWidth: 12,
  // How far from the highlight obstacles still matter.
  searchRadius: 10,
  // Least clearance from text a final spot may have (forces aim for textClearance).
  minTextGap: 0.25,
  // A highlight within this share of the column width from the left or right
  // edge of the text leans its note into the margin on that side.
  edgeReach: 0.35,
  // Pull toward that margin, and score bonus (in L) for landing in it, at the very edge.
  edgePull: 0.15,
  marginBonus: 3,
  // Bonus for staying put in the refinement pass, so equally good spots don't flip-flop.
  stickiness: 0.5,
};

// Spots per note that get a full arrow route in the refinement pass.
const REFINE_SHORTLIST = 3;

// How many crossing pairs the final pass tries to untangle.
const UNCROSS_ATTEMPTS = 3;

const ITERATIONS_COLD = 160;
const ITERATIONS_WARM = 40;

interface Body {
  id: string;
  anchor: AnnotationAnchor;
  bounds: Box;
  width: number;
  height: number;
  // The note's lines of text, relative to its top-left corner.
  lines: Box[];
  // Note's top-left corner.
  x: number;
  y: number;
  near: Box[];
  // `near` minus the highlight's own text: what its arrow shouldn't cut through.
  crossable: Box[];
  // Kept at its remembered spot; exerts forces but doesn't move.
  settled: boolean;
  // This note's spring rest gap (px): varies per note with `randomness`.
  restGap: number;
  // Seeded per note, so its variation is the same on every render.
  random: () => number;
  randomness: number;
  // The text column around the highlight.
  column: { left: number; right: number };
  // 0..1 per side: how close the highlight sits to that edge of the column.
  edgeLean: { left: number; right: number };
}

/**
 * Replays the remembered layout, moving each note and arrow along with its
 * highlight, without re-deciding anything. Returns null when an annotation
 * has no remembered layout yet (it's new, or its note or text changed), in
 * which case a full `layoutAnnotations` pass is needed.
 *
 * Clicking into a highlight (which reveals its markup in Live Preview),
 * moving the cursor, scrolling or typing elsewhere all reflow the text but
 * add no annotation, so the layout just follows instead of being re-decided.
 */
export function followMemory(anchors: AnnotationAnchor[], memory: LayoutMemory): Placement[] | null {
  const visible = anchors.filter((a) => a.rects.length > 0);
  if (visible.some((a) => !memory.has(a.id))) return null;

  return visible.map((anchor): Placement => {
    const entry = memory.get(anchor.id)!;
    if (entry.kind === "marker") {
      const last = anchor.rects[anchor.rects.length - 1];
      return { kind: "marker", id: anchor.id, at: { x: last.right, y: last.top } };
    }
    const origin = unionBox(anchor.rects);
    const left = origin.left + entry.offset.x;
    const top = origin.top + entry.offset.y;
    const arrow = entry.arrow.map((p) => ({ x: origin.left + p.x, y: origin.top + p.y }));
    // If the highlight rewrapped, keep the tip on its nearest fragment.
    const tip = arrow[arrow.length - 1];
    const nearest = anchor.rects.reduce((best, r) =>
      boxGap(pointBox(tip), r) < boxGap(pointBox(tip), best) ? r : best
    );
    arrow[arrow.length - 1] = closestPointOnBox(nearest, tip);
    return {
      kind: "note",
      id: anchor.id,
      note: { left, top, right: left + entry.size.width, bottom: top + entry.size.height },
      arrow,
    };
  });
}

/**
 * Places notes with a small force simulation, the way notes settle on a page
 * by hand: each note is pulled toward its highlight by a spring with a
 * comfortable rest length, pushed out of text, pushed off its highlight's own
 * line (so the arrow comes in at a slant), and kept apart from other notes
 * and from other annotations' arrows. Crossed arrows are untangled by
 * swapping note positions. Notes start from `memory` when possible, so
 * re-renders only nudge them. A note that ends up overlapping text falls back
 * to the closest free spot, or to a marker if there is none.
 *
 * `measure(id, width)` returns the note's size when laid out at `width`
 * (`null` = natural single-line width).
 */
export function layoutAnnotations(
  anchors: AnnotationAnchor[],
  obstacles: Box[],
  visible: { left: number; right: number },
  measure: (id: string, width: number | null) => NoteMeasure,
  memory: LayoutMemory = new Map(),
  // 0..1: how much notes vary in distance, direction and spot choice.
  randomness = 0
): Placement[] {
  const sorted = anchors
    .filter((a) => a.rects.length > 0)
    .sort((a, b) => a.rects[0].top - b.rects[0].top);
  if (sorted.length === 0) return [];

  const L = lineHeight(sorted);
  const area = { left: visible.left + 0.4 * L, right: visible.right - 0.4 * L };

  const bodies: Body[] = [];
  let anyNew = false;
  for (const anchor of sorted) {
    const bounds = unionBox(anchor.rects);
    const natural = measure(anchor.id, null);
    const maxWidth = Math.min(FORCES.maxWidth * L, (area.right - area.left) / 2);
    const size = natural.width > maxWidth ? measure(anchor.id, maxWidth) : natural;
    const radius = FORCES.searchRadius * L;
    const near = obstacles.filter((o) => o.bottom >= bounds.top - radius && o.top <= bounds.bottom + radius);
    const body: Body = {
      id: anchor.id,
      anchor,
      bounds,
      width: size.width,
      height: size.height,
      lines: size.lines,
      x: 0,
      y: 0,
      near,
      crossable: near.filter((o) => !isOwnText(o, anchor.rects)),
      settled: false,
      restGap: 0,
      random: seededRandom(anchor.seed),
      randomness,
      column: { left: 0, right: 0 },
      edgeLean: { left: 0, right: 0 },
    };
    body.column = {
      left: Math.min(bounds.left, ...near.map((o) => o.left)),
      right: Math.max(bounds.right, ...near.map((o) => o.right)),
    };
    const reach = FORCES.edgeReach * Math.max(1, body.column.right - body.column.left);
    const lean = (distance: number) => clamp(1 - distance / reach, 0, 1);
    body.edgeLean = { left: lean(bounds.left - body.column.left), right: lean(body.column.right - bounds.right) };
    // Only the nearer edge pulls.
    if (body.edgeLean.left > body.edgeLean.right) body.edgeLean.right = 0;
    else body.edgeLean.left = 0;
    // Some notes sit closer, some further out (±40% at full randomness).
    body.restGap = FORCES.restGap * L * (1 + (body.random() - 0.5) * 0.8 * randomness);

    // A remembered spot that is still free stays put (other notes still feel
    // it), so notes don't drift on every keystroke. Only new notes and ones
    // that text has reflowed into get simulated.
    const remembered = memory.get(anchor.id);
    if (remembered?.kind === "note") {
      body.x = bounds.left + remembered.offset.x;
      body.y = bounds.top + remembered.offset.y;
      const box = boxOf(body);
      body.settled =
        box.left >= area.left - 1 &&
        box.right <= area.right + 1 &&
        !near.some((o) => overlapArea(box, o, 0) > 4) &&
        !bodies.some((b) => b.settled && overlapArea(box, boxOf(b), 0) > 0);
    } else {
      anyNew = true;
      const seed = seedPosition(body, bodies, area, L);
      body.x = seed.x;
      body.y = seed.y;
    }
    bodies.push(body);
  }

  // Settled notes stay as they are; anything new or displaced triggers a full
  // pass (which may also move settled notes, if crowding made a better spot).
  if (bodies.some((b) => !b.settled)) {
    simulate(bodies, area, L, anyNew ? ITERATIONS_COLD : ITERATIONS_WARM, anyNew ? 1 : 0.35);
    untangle(bodies, area, L);
    refine(bodies, area, L);
  }

  // Settle each note on a free spot (or give up and show a marker).
  const placed: Body[] = [];
  const markers = new Set<Body>();
  for (const body of bodies) {
    let note: Box | null = boxOf(body);
    const blocked = (b: Box) =>
      body.near.some((o) => overlapArea(b, o, 0) > 4) || placed.some((p) => overlapArea(b, boxOf(p), 0) > 0);
    if (blocked(note) || note.left < area.left - 1 || note.right > area.right + 1) {
      note = closestFreeSpot(body, placed.map(boxOf), area, L);
    }
    if (!note) {
      markers.add(body);
      continue;
    }
    body.x = note.left;
    body.y = note.top;
    placed.push(body);
  }

  const routes = routeAll(placed, area, L);
  if (anyNew || bodies.some((b) => !b.settled)) uncross(placed, routes, area, L);
  for (const body of placed) routes.set(body, alignStartToText(boxOf(body), body.lines, routes.get(body)));

  const placements: Placement[] = [];
  for (const body of bodies) {
    if (markers.has(body)) {
      const last = body.anchor.rects[body.anchor.rects.length - 1];
      placements.push({ kind: "marker", id: body.id, at: { x: last.right, y: last.top } });
      memory.set(body.id, { kind: "marker" });
      continue;
    }
    const note = boxOf(body);
    const path = routes.get(body)!;
    const origin = body.bounds;
    memory.set(body.id, {
      kind: "note",
      offset: { x: note.left - origin.left, y: note.top - origin.top },
      size: { width: body.width, height: body.height },
      arrow: path.map((p) => ({ x: p.x - origin.left, y: p.y - origin.top })),
    });
    placements.push({ kind: "note", id: body.id, note, arrow: path });
  }
  return placements;
}

// Routes every arrow, each around the ones routed before it.
function routeAll(bodies: Body[], area: { left: number; right: number }, L: number) {
  const routes = new Map<Body, Point[]>();
  const routed: Point[][] = [];
  for (const body of bodies) {
    const blockers = bodies.filter((b) => b !== body).map(boxOf);
    const { path } = routeArrow(body.anchor.rects, boxOf(body), body.crossable, blockers, area, L, routed);
    routes.set(body, path);
    routed.push(path);
  }
  return routes;
}

/**
 * Arrows are routed one by one, so an earlier arrow can leave a later one no
 * way through without crossing. For each pair of routed arrows that cross,
 * this tries moving one of the two notes to one of its few best alternative
 * spots, re-routes both arrows, and keeps the move if it removes crossings.
 */
function uncross(bodies: Body[], routes: Map<Body, Point[]>, area: { left: number; right: number }, L: number) {
  const crossingsOf = (body: Body, path: Point[]) =>
    bodies.filter((other) => other !== body && pathsCross(path, routes.get(other)!)).length;

  for (let attempt = 0; attempt < UNCROSS_ATTEMPTS; attempt++) {
    const pair = findCrossingPair(bodies, routes);
    if (!pair) return;

    let best: { body: Body; box: Box; paths: [Point[], Point[]]; crossings: number; cost: number } | null = null;
    const [a, b] = pair;
    const before = crossingsOf(a, routes.get(a)!) + crossingsOf(b, routes.get(b)!);
    for (const mover of [a, b]) {
      const others = bodies.filter((o) => o !== mover);
      const original = { x: mover.x, y: mover.y };
      const candidates = alternativeBoxes(mover, others, area, L)
        .map((box) => ({ box, cost: placementCost(mover, box, others, area, L, true) }))
        .filter((c) => c.cost < Infinity)
        .sort((p, q) => p.cost - q.cost)
        .slice(0, REFINE_SHORTLIST + 1);

      for (const { box, cost } of candidates) {
        mover.x = box.left;
        mover.y = box.top;
        // Re-route just the pair, around every other arrow.
        const otherPaths = bodies.filter((o) => o !== a && o !== b).map((o) => routes.get(o)!);
        const pathA = routeArrow(a.anchor.rects, boxOf(a), a.crossable, bodies.filter((o) => o !== a).map(boxOf), area, L, otherPaths).path;
        const pathB = routeArrow(b.anchor.rects, boxOf(b), b.crossable, bodies.filter((o) => o !== b).map(boxOf), area, L, [...otherPaths, pathA]).path;
        const trial = new Map(routes).set(a, pathA).set(b, pathB);
        const crossings =
          bodies.filter((o) => o !== a && pathsCross(pathA, trial.get(o)!)).length +
          bodies.filter((o) => o !== b && pathsCross(pathB, trial.get(o)!)).length;
        if (crossings < before && (!best || crossings < best.crossings || (crossings === best.crossings && cost < best.cost))) {
          best = { body: mover, box, paths: [pathA, pathB], crossings, cost };
        }
      }
      mover.x = original.x;
      mover.y = original.y;
    }

    if (!best) return;
    best.body.x = best.box.left;
    best.body.y = best.box.top;
    routes.set(a, best.paths[0]).set(b, best.paths[1]);
  }
}

/**
 * An arrow that leaves from a note's left or right end starts level with the
 * middle of the nearest line of text, at that line's end, so it reads as
 * coming out of the text rather than off the corner of the note's box. A
 * corner start that heads off mostly up or down belongs to the top or bottom
 * edge and stays put.
 */
function alignStartToText(note: Box, lines: Box[], path: Point[]): Point[] {
  if (lines.length === 0 || path.length < 2) return path;
  const [start, next] = path;
  const side = start.x <= note.left ? "left" : start.x >= note.right ? "right" : null;
  if (!side) return path;
  const onCorner = start.y <= note.top || start.y >= note.bottom;
  if (onCorner && Math.abs(next.y - start.y) > Math.abs(next.x - start.x)) return path;

  // Same air between stroke and text as the route's start (see routeInRegion).
  const gap = 3;
  const placed = lines.map((l) => ({
    left: note.left + l.left,
    top: note.top + l.top,
    right: note.left + l.right,
    bottom: note.top + l.bottom,
  }));
  const nearest = [...placed].sort((p, q) => Math.abs(center(p).y - start.y) - Math.abs(center(q).y - start.y));
  for (const line of nearest) {
    const aligned = { x: side === "left" ? line.left - gap : line.right + gap, y: center(line).y };
    // From the end of a short line, the stroke must not cut through the lines beside it.
    if (placed.some((o) => o !== line && segmentHitsBox(aligned, next, o))) continue;
    return [aligned, ...path.slice(1)];
  }
  return path;
}

function findCrossingPair(bodies: Body[], routes: Map<Body, Point[]>): [Body, Body] | null {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (pathsCross(routes.get(bodies[i])!, routes.get(bodies[j])!)) return [bodies[i], bodies[j]];
    }
  }
  return null;
}

function pathsCross(p: Point[], q: Point[]) {
  for (let i = 1; i < p.length; i++) {
    for (let j = 1; j < q.length; j++) {
      if (segmentsIntersect(p[i - 1], p[i], q[j - 1], q[j])) return true;
    }
  }
  return false;
}

// --- Simulation ---------------------------------------------------------------

function simulate(bodies: Body[], area: { left: number; right: number }, L: number, iterations: number, heat: number) {
  for (let it = 0; it < iterations; it++) {
    // Cools down so notes move freely at first and settle at the end.
    const temperature = heat * (1 - it / iterations) + 0.05;
    const moves = bodies.map((body) => (body.settled ? { x: 0, y: 0 } : netForce(body, bodies, area, L)));
    bodies.forEach((body, i) => {
      if (body.settled) return;
      const move = clampLength(scale(moves[i], temperature), FORCES.maxStep * L);
      body.x += move.x;
      body.y += move.y;
    });
  }
}

function netForce(body: Body, bodies: Body[], area: { left: number; right: number }, L: number): Point {
  const note = boxOf(body);
  const noteCenter = center(note);
  const force = { x: 0, y: 0 };
  const add = (v: Point, k = 1) => {
    force.x += v.x * k;
    force.y += v.y * k;
  };

  // Spring toward the highlight; pushes away instead when closer than the rest gap.
  const toAnchor = sub(center(body.bounds), noteCenter);
  const gap = boxGap(note, body.bounds);
  add(normalize(toAnchor), FORCES.spring * (gap - body.restGap));

  // Out of text (including the highlight itself).
  for (const o of body.near) {
    add(separation(note, o, FORCES.textClearance * L), FORCES.overlapPush);
  }

  // Off the highlight's own line, toward whichever side the note already
  // leans, unless nothing on that line sits between them (a margin note
  // beside a highlight at the start or end of a line is a natural spot).
  const rowOverlap = Math.min(note.bottom, body.bounds.bottom) - Math.max(note.top, body.bounds.top);
  if (rowOverlap > 0 && textBetweenOnRow(note, body.bounds, body.crossable)) {
    const up = noteCenter.y <= center(body.bounds).y ? -1 : 1;
    add({ x: 0, y: up * rowOverlap }, FORCES.rowAvoid);
  }

  for (const other of bodies) {
    if (other === body) continue;
    // Apart from other notes.
    add(separation(note, boxOf(other), FORCES.noteClearance * L), FORCES.overlapPush);
    // Off other annotations' connectors.
    const a = center(boxOf(other));
    const b = center(other.bounds);
    if (segmentHitsBox(a, b, expand(note, 0.3 * L))) {
      add(awayFromLine(noteCenter, a, b), FORCES.arrowAvoid * L);
    }
  }

  // Into the margin beside the highlight, when it sits near that edge of the text.
  const rightMargin = body.column.right + body.restGap;
  if (body.edgeLean.right > 0 && note.left < rightMargin) {
    force.x += FORCES.edgePull * body.edgeLean.right * (rightMargin - note.left);
  }
  const leftMargin = body.column.left - body.restGap;
  if (body.edgeLean.left > 0 && note.right > leftMargin) {
    force.x -= FORCES.edgePull * body.edgeLean.left * (note.right - leftMargin);
  }

  // Inside the visible area.
  if (note.left < area.left) force.x += area.left - note.left;
  if (note.right > area.right) force.x -= note.right - area.right;
  return force;
}

// Swaps notes whose connectors cross when that lowers the total energy, then lets them settle again.
function untangle(bodies: Body[], area: { left: number; right: number }, L: number) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (a.settled || b.settled || !connectorsCross(a, b)) continue;

      const before = energy(bodies, L);
      const ca = center(boxOf(a));
      const cb = center(boxOf(b));
      const swap = () => {
        [a.x, a.y, b.x, b.y] = [cb.x - a.width / 2, cb.y - a.height / 2, ca.x - b.width / 2, ca.y - b.height / 2];
      };
      swap();
      if (energy(bodies, L) >= before) {
        // Swapping back restores the original centers exactly.
        [a.x, a.y, b.x, b.y] = [ca.x - a.width / 2, ca.y - a.height / 2, cb.x - b.width / 2, cb.y - b.height / 2];
      }
    }
  }
  simulate(bodies, area, L, 30, 0.25);
}

function energy(bodies: Body[], L: number) {
  let total = 0;
  for (const body of bodies) {
    const note = boxOf(body);
    total += (boxGap(note, body.bounds) - body.restGap) ** 2;
    for (const o of body.near) total += overlapArea(note, o, FORCES.textClearance * L);
    for (const other of bodies) {
      if (other === body) continue;
      total += overlapArea(note, boxOf(other), FORCES.noteClearance * L);
      if (other.id > body.id && connectorsCross(body, other)) total += 50 * L * L;
    }
  }
  return total;
}

// --- Refinement ---------------------------------------------------------------

/**
 * Forces only know where a note sits, not what its arrow will look like. This
 * pass judges each note by its arrow: it compares the current spot with the
 * mirrored spots (other side, above/below) and the margins beside the
 * highlight's line, and moves the note if another spot gives a clearly
 * cleaner arrow. The current spot gets a small bonus so notes don't flip back
 * and forth between equally good spots.
 */
function refine(bodies: Body[], area: { left: number; right: number }, L: number) {
  for (let round = 0; round < 2; round++) {
    for (const body of bodies) {
      const others = bodies.filter((b) => b !== body);
      const current = boxOf(body);
      const candidates = [current, ...alternativeBoxes(body, others, area, L)];
      // Staying put earns a bonus; with randomness, each spot also gets a
      // small seeded nudge (up to ±1 line height), so near-ties don't always
      // resolve the same way for every note.
      const adjust = (index: number) =>
        (index === 0 ? FORCES.stickiness * L : 0) -
        (seededRandom(body.anchor.seed + index * 7919)() - 0.5) * 2 * L * body.randomness;

      // Routing an arrow is the expensive part, so rank every spot with a
      // straight-line estimate first and only route the most promising few.
      // Spots with no valid arrow route score Infinity and don't use up the
      // shortlist, so we keep going until enough routable spots are found.
      const ranked = candidates
        .map((box, index) => ({ box, index, cost: placementCost(body, box, others, area, L, true) - adjust(index) }))
        .filter((c) => c.cost < Infinity)
        .sort((a, b) => a.cost - b.cost);

      let best = { box: current, cost: Infinity };
      let routable = 0;
      for (const { box, index } of ranked) {
        const cost = placementCost(body, box, others, area, L, false) - adjust(index);
        if (cost === Infinity) continue;
        if (cost < best.cost) best = { box, cost };
        if (++routable >= REFINE_SHORTLIST) break;
      }
      body.x = best.box.left;
      body.y = best.box.top;
    }
  }
}

// How bad a spot is for `body`, in px: text under the arrow, distance (with a
// penalty for crowding the highlight), and tangles with other annotations.
// `quick` estimates the arrow as a straight line instead of routing it.
function placementCost(
  body: Body,
  box: Box,
  others: Body[],
  area: { left: number; right: number },
  L: number,
  quick: boolean
) {
  if (box.left < area.left - 1 || box.right > area.right + 1) return Infinity;
  if (body.near.some((o) => overlapArea(box, o, FORCES.minTextGap * L) > 0)) return Infinity;
  if (others.some((b) => overlapArea(box, boxOf(b), FORCES.noteClearance * L * 0.5) > 0)) return Infinity;

  const route = quick
    ? straightRoute(box, body.bounds, body.crossable)
    : routeArrow(body.anchor.rects, box, body.crossable, others.map(boxOf), area, L);
  const gap = boxGap(box, body.bounds);
  let cost = route.overlap + 0.15 * gap;
  // A highlight near the edge of the text prefers its note in the margin on that side.
  const inMargin =
    box.left >= body.column.right ? body.edgeLean.right : box.right <= body.column.left ? body.edgeLean.left : 0;
  cost -= inMargin * FORCES.marginBonus * L;
  if (gap < body.restGap) cost += (body.restGap - gap) * 1.5;
  // Hand-drawn arrows head one way: doubling back (a U-turn around a
  // paragraph) costs the extra travel, and a long detour reads as lost.
  cost += backtrack(route.path);
  const ends = route.path;
  const straight = Math.hypot(ends[ends.length - 1].x - ends[0].x, ends[ends.length - 1].y - ends[0].y);
  cost += Math.max(0, route.length - 1.6 * straight) * 0.3;

  const from = center(box);
  const to = center(body.bounds);
  for (const other of others) {
    if (segmentsIntersect(from, to, center(boxOf(other)), center(other.bounds))) cost += 3 * L;
  }
  return cost;
}

// Distance a path travels against its overall direction, per axis (0 for a
// path that only ever heads toward its end).
function backtrack(path: Point[]) {
  let x = 0;
  let y = 0;
  for (let k = 1; k < path.length; k++) {
    x += Math.abs(path[k].x - path[k - 1].x);
    y += Math.abs(path[k].y - path[k - 1].y);
  }
  const last = path[path.length - 1];
  return x - Math.abs(last.x - path[0].x) + (y - Math.abs(last.y - path[0].y));
}

// Cheap stand-in for routeArrow: a straight line between the closest points,
// with the text it crosses sampled every 4px.
function straightRoute(note: Box, target: Box, obstacles: Box[]): ArrowRoute {
  const to = closestPointOnBox(target, center(note));
  const from = closestPointOnBox(note, to);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(length / 4));
  let overlap = 0;
  for (let i = 1; i < steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    if (obstacles.some((o) => x >= o.left && x <= o.right && y >= o.top && y <= o.bottom)) overlap += length / steps;
  }
  return { path: [from, to], overlap, length };
}

// Mirror images of the current spot around the highlight, the margins level
// with the highlight's first/last line, and straight above and below it. Spots that collide are swapped
// for the nearest free spot.
function alternativeBoxes(body: Body, others: Body[], area: { left: number; right: number }, L: number): Box[] {
  const current = center(boxOf(body));
  const anchor = center(body.bounds);
  const at = (x: number, y: number): Box => ({
    left: x - body.width / 2,
    top: y - body.height / 2,
    right: x + body.width / 2,
    bottom: y + body.height / 2,
  });

  const first = body.anchor.rects[0];
  const last = body.anchor.rects[body.anchor.rects.length - 1];
  const textLeft = Math.min(body.bounds.left, ...body.near.map((o) => o.left));
  const textRight = Math.max(body.bounds.right, ...body.near.map((o) => o.right));
  const gap = body.restGap;
  const raw = [
    at(2 * anchor.x - current.x, current.y),
    at(current.x, 2 * anchor.y - current.y),
    at(2 * anchor.x - current.x, 2 * anchor.y - current.y),
    at(textRight + gap + body.width / 2, (last.top + last.bottom) / 2),
    at(textLeft - gap - body.width / 2, (first.top + first.bottom) / 2),
    // Straight above and below the highlight (in dense text these resolve to
    // the nearest paragraph break or the space around the paragraph).
    at(anchor.x, body.bounds.top - gap - body.height / 2),
    at(anchor.x, body.bounds.bottom + gap + body.height / 2),
  ];

  const taken = others.map(boxOf);
  const boxes: Box[] = [];
  for (const box of raw) {
    boxes.push(box);
    const free = closestFreeSpot(body, taken, area, L, center(box));
    if (free) boxes.push(free);
  }
  return boxes;
}

// Is there text on the highlight's line between the note and the highlight?
function textBetweenOnRow(note: Box, bounds: Box, obstacles: Box[]) {
  let span: { left: number; right: number };
  if (note.right <= bounds.left) span = { left: note.right, right: bounds.left };
  else if (note.left >= bounds.right) span = { left: bounds.right, right: note.left };
  else return true; // Note overlaps the highlight horizontally: it's on top of the text.
  return obstacles.some(
    (o) => o.bottom > bounds.top + 2 && o.top < bounds.bottom - 2 && o.right > span.left && o.left < span.right
  );
}

// --- Seeding and fallback -----------------------------------------------------

// Tries spots around the highlight (diagonals first, then above/below, then
// the side margins) and keeps the one that overlaps text and notes the least.
function seedPosition(body: Body, placed: Body[], area: { left: number; right: number }, L: number): Point {
  const c = center(body.bounds);
  const halfW = (body.bounds.right - body.bounds.left) / 2 + body.restGap + body.width / 2;
  const halfH = (body.bounds.bottom - body.bounds.top) / 2 + body.restGap + body.height / 2;
  const diagonals: Point[] = [
    { x: c.x + halfW, y: c.y - halfH },
    { x: c.x + halfW, y: c.y + halfH },
    { x: c.x - halfW, y: c.y - halfH },
    { x: c.x - halfW, y: c.y + halfH },
  ];
  // With randomness, notes don't all try the same corner first.
  if (body.random() < body.randomness) {
    const shift = Math.floor(body.random() * diagonals.length);
    diagonals.push(...diagonals.splice(0, shift));
  }
  // A highlight near the edge of the text tries the margin on that side first.
  // Level with it only if no text sits between (the arrow can't slide along
  // text), otherwise just above it.
  const beside: Point[] = [];
  if (Math.max(body.edgeLean.left, body.edgeLean.right) > 0.3) {
    const x =
      body.edgeLean.right > 0
        ? body.column.right + body.restGap + body.width / 2
        : body.column.left - body.restGap - body.width / 2;
    const level = { left: x - body.width / 2, top: c.y - body.height / 2, right: x + body.width / 2, bottom: c.y + body.height / 2 };
    const clear = !textBetweenOnRow(level, body.bounds, body.crossable);
    beside.push({ x, y: clear ? c.y : body.bounds.top - body.restGap - body.height / 2 });
  }
  const centers: Point[] = [
    ...beside,
    ...diagonals,
    { x: c.x, y: c.y - halfH },
    { x: c.x, y: c.y + halfH },
    { x: area.right - body.width / 2, y: c.y - halfH },
    { x: area.left + body.width / 2, y: c.y - halfH },
  ];

  let best: { point: Point; cost: number } | null = null;
  for (const centerPoint of centers) {
    const point = {
      x: Math.min(Math.max(centerPoint.x - body.width / 2, area.left), area.right - body.width),
      y: centerPoint.y - body.height / 2,
    };
    const box = { left: point.x, top: point.y, right: point.x + body.width, bottom: point.y + body.height };
    let cost = 0;
    for (const o of body.near) cost += overlapArea(box, o, FORCES.textClearance * L);
    for (const p of placed) cost += overlapArea(box, boxOf(p), FORCES.noteClearance * L);
    if (!best || cost < best.cost) best = { point, cost };
  }
  return best!.point;
}

// Nearest collision-free spot to `target` (default: where the simulation left
// the note), from positions aligned to obstacle edges.
function closestFreeSpot(
  body: Body,
  placed: Box[],
  area: { left: number; right: number },
  L: number,
  target: Point = center(boxOf(body))
): Box | null {
  const gap = FORCES.textClearance * L;
  const xs = new Set<number>([area.left, area.right - body.width]);
  const ys = new Set<number>();
  for (const o of [body.bounds, ...body.near, ...placed]) {
    xs.add(o.right + gap + 1);
    xs.add(o.left - gap - 1 - body.width);
    ys.add(o.bottom + gap + 1);
    ys.add(o.top - gap - 1 - body.height);
  }

  let best: { box: Box; distance: number } | null = null;
  for (const x of xs) {
    for (const y of ys) {
      const box = { left: x, top: y, right: x + body.width, bottom: y + body.height };
      const distance = Math.hypot(center(box).x - target.x, center(box).y - target.y);
      if (best && distance >= best.distance) continue;
      if (box.left < area.left || box.right > area.right) continue;
      if (Math.abs(box.top - body.bounds.top) > FORCES.searchRadius * L) continue;
      if (body.near.some((o) => overlapArea(box, o, FORCES.minTextGap * L) > 0)) continue;
      if (placed.some((p) => overlapArea(box, p, gap) > 0)) continue;
      best = { box, distance };
    }
  }
  return best?.box ?? null;
}

// --- Arrows -------------------------------------------------------------------

// Cost of moving through one grid cell, relative to blank space (1).
const CELL_COST = {
  text: 8,
  // Hugging text: keeps paths in the middle of gaps rather than grazing letters.
  nearText: 2.5,
  // The highlight itself: the arrow should end at it, not run along it.
  ownText: 4,
  // Other notes (and this one): practically walls.
  note: 40,
  // Arrows already drawn: avoid running along or across them.
  arrow: 10,
  nearArrow: 3,
};
// Extra cost for changing direction by 45° / 90°; sharper turns aren't allowed.
const TURN_COST = [0, 0.5, 2];

// 8 directions in circular order, so index distance = turn size.
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const NO_DIRECTION = 8;

export interface ArrowRoute {
  // Points the arrow passes through, from the note to the highlight.
  path: Point[];
  // Length (px) of the path that runs over text.
  overlap: number;
  length: number;
  // No valid route exists (the path is a bare fallback line), so this note
  // spot should not be used.
  blocked?: boolean;
}

/**
 * Finds the arrow's path with A* on a cost grid around the note and its
 * highlight: blank space is cheap, text is expensive, notes are walls. The
 * search starts anywhere around the note and ends anywhere along the
 * highlight's edge, and turning costs extra, so the path flows through the
 * page's gaps (margins, line spacing, paragraph breaks) and crosses text only
 * where it has to, as directly as it can. The cell path is simplified to its
 * turning points; the overlay draws a smooth curve guided by them.
 */
function routeArrow(
  rects: Box[],
  note: Box,
  obstacles: Box[],
  blockers: Box[],
  area: { left: number; right: number },
  L: number,
  // Paths of arrows already placed.
  arrows: Point[][] = []
): ArrowRoute {
  // Search close by first; widen once so a route can detour through a
  // paragraph break or margin further out.
  for (const reach of [1.5, 4]) {
    const route = routeInRegion(rects, note, obstacles, blockers, area, L, arrows, reach * L);
    if (route) return route;
  }
  // No valid route: callers treat this spot as unusable; if it must be drawn,
  // it's a bare line between the closest points.
  const target = unionBox(rects);
  const to = closestPointOnBox(target, center(note));
  const from = closestPointOnBox(note, to);
  return { path: [from, to], overlap: Infinity, length: Math.hypot(to.x - from.x, to.y - from.y), blocked: true };
}

function routeInRegion(
  rects: Box[],
  note: Box,
  obstacles: Box[],
  blockers: Box[],
  area: { left: number; right: number },
  L: number,
  arrows: Point[][],
  reach: number
): ArrowRoute | null {
  const cell = Math.max(3, Math.round(L / 5));
  const target = unionBox(rects);
  const region = expand(unionBox([note, target]), reach);
  region.left = Math.max(region.left, area.left - L);
  region.right = Math.min(region.right, area.right + L);
  const cols = Math.ceil((region.right - region.left) / cell) + 1;
  const rows = Math.ceil((region.bottom - region.top) / cell) + 1;

  const costs = new Float32Array(cols * rows).fill(1);
  const cellCenter = (i: number): Point => ({
    x: region.left + ((i % cols) + 0.5) * cell,
    y: region.top + (Math.floor(i / cols) + 0.5) * cell,
  });
  const forCells = (b: Box, fn: (i: number) => void) => {
    const c0 = Math.max(0, Math.floor((b.left - region.left) / cell));
    const c1 = Math.min(cols - 1, Math.floor((b.right - region.left) / cell));
    const r0 = Math.max(0, Math.floor((b.top - region.top) / cell));
    const r1 = Math.min(rows - 1, Math.floor((b.bottom - region.top) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * cols + c);
  };
  const raise = (b: Box, value: number) => forCells(b, (i) => (costs[i] = Math.max(costs[i], value)));

  for (const o of obstacles) {
    if (overlapArea(o, region, 0) === 0) continue;
    raise(expand(o, cell), CELL_COST.nearText);
  }
  // Text cells, for the cost and for the one-way crossing rule.
  const isText = new Uint8Array(cols * rows);
  for (const o of obstacles) {
    if (overlapArea(o, region, 0) === 0) continue;
    raise(o, CELL_COST.text);
    forCells(o, (i) => (isText[i] = 1));
  }
  for (const r of rects) raise(r, CELL_COST.ownText);
  for (const b of [note, ...blockers]) if (overlapArea(b, region, 0) > 0) raise(expand(b, 2), CELL_COST.note);
  for (const arrow of arrows) {
    for (let k = 1; k < arrow.length; k++) {
      const a = arrow[k - 1];
      const b = arrow[k];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell / 2)));
      for (let s = 0; s <= steps; s++) {
        const p = pointBox({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
        raise(expand(p, cell * 1.5), CELL_COST.nearArrow);
        raise(expand(p, cell * 0.5), CELL_COST.arrow);
      }
    }
  }

  // Start: the ring of cells just outside the note. Goal: the ring just outside the highlight.
  const starts: number[] = [];
  forCells(expand(note, cell + 2), (i) => {
    const p = cellCenter(i);
    if (!(p.x > note.left - 2 && p.x < note.right + 2 && p.y > note.top - 2 && p.y < note.bottom + 2)) starts.push(i);
  });
  const isGoal = new Uint8Array(cols * rows);
  for (const r of rects) {
    forCells(expand(r, cell), (i) => {
      const p = cellCenter(i);
      if (!(p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom)) isGoal[i] = 1;
    });
  }

  const cells = aStar(costs, isText, cols, rows, starts, isGoal, (i) => boxGap(pointBox(cellCenter(i)), target) / cell);
  if (!cells) return null;

  let overlap = 0;
  for (const i of cells) if (isText[i]) overlap += cell;

  const points = cells.map(cellCenter);
  // Pin the ends to the note's border and the highlight's edge.
  // The start keeps a little air between the stroke and the note's text.
  points[0] = closestPointOnBox(expand(note, 3), points[0]);
  const lastRect = rects.reduce((best, r) =>
    boxGap(pointBox(points[points.length - 1]), r) < boxGap(pointBox(points[points.length - 1]), best) ? r : best
  );
  points[points.length - 1] = closestPointOnBox(lastRect, points[points.length - 1]);

  // Only the big turns survive; the overlay draws a spline that cuts their corners.
  let path = simplify(points, Math.max(cell * 1.2, 0.5 * L));

  // A hand-drawn arrow leaves its note along the line of text, then turns into
  // the highlight. In open space both corners of a one-turn route cost about
  // the same, so one that dips first and then runs level into the highlight is
  // swapped for its mirror image, when that way is just as clear.
  if (path.length === 3) {
    const [a, turn, b] = path;
    const steepness = (p: Point, q: Point) => Math.abs(q.y - p.y) / (Math.abs(q.x - p.x) + 1);
    if (steepness(a, turn) > steepness(turn, b)) {
      const mirrored = { x: a.x + b.x - turn.x, y: a.y + b.y - turn.y };
      const legCost = (p: Point, q: Point) => {
        const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (cell / 2)));
        let cost = 0;
        let text = false;
        for (let s = 0; s <= steps; s++) {
          const col = clamp(Math.floor((p.x + ((q.x - p.x) * s) / steps - region.left) / cell), 0, cols - 1);
          const row = clamp(Math.floor((p.y + ((q.y - p.y) * s) / steps - region.top) / cell), 0, rows - 1);
          cost += costs[row * cols + col];
          if (isText[row * cols + col]) text = true;
        }
        return { cost: (cost * Math.hypot(q.x - p.x, q.y - p.y)) / (steps + 1), text };
      };
      const before = legCost(a, turn).cost + legCost(turn, b).cost;
      const first = legCost(a, mirrored);
      const second = legCost(mirrored, b);
      if (!first.text && !second.text && first.cost + second.cost <= before * 1.15) {
        path = [a, mirrored, b];
        overlap = 0;
      }
    }
  }

  let length = 0;
  for (let k = 1; k < path.length; k++) length += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y);
  return { path, overlap, length };
}

// Weight on the heuristic: >1 trades a little optimality for far fewer
// expansions; the path is simplified and smoothed afterwards anyway.
const HEURISTIC_WEIGHT = 1.5;

// Which way the path has crossed text so far. Once it crosses text going up
// it may only cross text going up again (and likewise down): a stroke that
// climbs through a paragraph never loops around and cuts back down through it.
const CROSSING_NONE = 0;
const CROSSING_UP = 1;
const CROSSING_DOWN = 2;

// A* over (cell, crossing direction) states. Turning cost uses the heading
// each state was reached with (an approximation that keeps the state space
// small). Returns the cell indices of a cheap path from any start to any
// goal, or null.
function aStar(
  costs: Float32Array,
  isText: Uint8Array,
  cols: number,
  rows: number,
  starts: number[],
  isGoal: Uint8Array,
  heuristic: (cell: number) => number
): number[] | null {
  const count = cols * rows * 3;
  const g = new Float32Array(count).fill(Infinity);
  const parent = new Int32Array(count).fill(-1);
  const heading = new Int8Array(count).fill(NO_DIRECTION);
  const closed = new Uint8Array(count);
  const heap = new MinHeap();

  for (const c of starts) {
    const s = c * 3 + CROSSING_NONE;
    g[s] = 0;
    heap.push(s, HEURISTIC_WEIGHT * heuristic(c));
  }

  while (heap.size > 0) {
    const s = heap.pop().item;
    if (closed[s]) continue;
    closed[s] = 1;
    const c = Math.floor(s / 3);
    const crossing = s % 3;
    if (isGoal[c]) {
      const path: number[] = [];
      for (let t = s; t !== -1; t = parent[t]) path.push(Math.floor(t / 3));
      return path.reverse();
    }

    const col = c % cols;
    const row = Math.floor(c / cols);
    for (let d = 0; d < 8; d++) {
      let turn = 0;
      if (heading[s] !== NO_DIRECTION) {
        const diff = Math.abs(d - heading[s]);
        turn = Math.min(diff, 8 - diff);
        if (turn >= TURN_COST.length) continue;
      }
      const nc = col + DX[d];
      const nr = row + DY[d];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = nr * cols + nc;

      // No sliding along a line of text: that reads as a strikethrough. Text is
      // only ever crossed (vertically or at a slant); horizontal travel happens
      // in blank space such as margins and paragraph breaks.
      if (isText[n] && DY[d] === 0) continue;

      let nextCrossing = crossing;
      if (isText[n]) {
        const direction = DY[d] < 0 ? CROSSING_UP : CROSSING_DOWN;
        if (crossing !== CROSSING_NONE && crossing !== direction) continue;
        nextCrossing = direction;
      }
      const ns = n * 3 + nextCrossing;
      if (closed[ns]) continue;

      const step = d % 2 === 0 ? 1 : Math.SQRT2;
      const cost = g[s] + (step * (costs[c] + costs[n])) / 2 + TURN_COST[turn];
      if (cost < g[ns]) {
        g[ns] = cost;
        parent[ns] = s;
        heading[ns] = d;
        heap.push(ns, cost + HEURISTIC_WEIGHT * heuristic(n));
      }
    }
  }
  return null;
}

class MinHeap {
  private items: number[] = [];
  private priorities: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, priority: number) {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.priorities[up] <= this.priorities[i]) break;
      this.swap(i, up);
      i = up;
    }
  }

  pop(): { item: number; priority: number } {
    const top = { item: this.items[0], priority: this.priorities[0] };
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.priorities[l] < this.priorities[smallest]) smallest = l;
        if (r < this.items.length && this.priorities[r] < this.priorities[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}

// Ramer–Douglas–Peucker: keeps the points where the path really turns.
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], first, last);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  return simplify(points.slice(0, index + 1), tolerance).slice(0, -1).concat(simplify(points.slice(index), tolerance));
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function closestPointOnBox(box: Box, p: Point): Point {
  return { x: clamp(p.x, box.left, box.right), y: clamp(p.y, box.top, box.bottom) };
}

function pointBox(p: Point): Box {
  return { left: p.x, top: p.y, right: p.x, bottom: p.y };
}

// --- Geometry -----------------------------------------------------------------

// Small seeded PRNG (mulberry32): same seed, same sequence of numbers in [0, 1).
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Median height of the highlights' line fragments: the unit for all distances.
function lineHeight(anchors: AnnotationAnchor[]) {
  const heights = ([] as number[])
    .concat(...anchors.map((a) => a.rects.map((r) => r.bottom - r.top)))
    .sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || 20;
}

function boxOf(body: Body): Box {
  return { left: body.x, top: body.y, right: body.x + body.width, bottom: body.y + body.height };
}

// Text box belongs to the highlight itself. (Center test, not overlap: the
// highlight's padding touches the lines above and below.)
function isOwnText(o: Box, rects: Box[]) {
  const c = center(o);
  return rects.some((r) => c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom);
}

// Shortest move that pushes `a` out of `b` grown by `clearance` (zero if apart).
function separation(a: Box, b: Box, clearance: number): Point {
  const ox = Math.min(a.right, b.right + clearance) - Math.max(a.left, b.left - clearance);
  const oy = Math.min(a.bottom, b.bottom + clearance) - Math.max(a.top, b.top - clearance);
  if (ox <= 0 || oy <= 0) return { x: 0, y: 0 };
  const ca = center(a);
  const cb = center(b);
  if (ox < oy) return { x: (ca.x >= cb.x ? 1 : -1) * ox, y: 0 };
  return { x: 0, y: (ca.y >= cb.y ? 1 : -1) * oy };
}

function overlapArea(a: Box, b: Box, clearance: number) {
  const ox = Math.min(a.right, b.right + clearance) - Math.max(a.left, b.left - clearance);
  const oy = Math.min(a.bottom, b.bottom + clearance) - Math.max(a.top, b.top - clearance);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function connectorsCross(a: Body, b: Body) {
  return segmentsIntersect(center(boxOf(a)), center(a.bounds), center(boxOf(b)), center(b.bounds));
}

function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point) {
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function segmentHitsBox(a: Point, b: Point, box: Box) {
  if (Math.max(a.x, b.x) < box.left || Math.min(a.x, b.x) > box.right) return false;
  if (Math.max(a.y, b.y) < box.top || Math.min(a.y, b.y) > box.bottom) return false;
  const corners = [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ];
  // The segment touches the box if the box's corners aren't all on one side of its line.
  const sides = corners.map((c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)));
  return !(sides.every((s) => s > 0) || sides.every((s) => s < 0));
}

// Unit vector from the line through a–b toward `p`.
function awayFromLine(p: Point, a: Point, b: Point): Point {
  const d = normalize(sub(b, a));
  const normal = { x: -d.y, y: d.x };
  const side = (p.x - a.x) * normal.x + (p.y - a.y) * normal.y >= 0 ? 1 : -1;
  return scale(normal, side);
}

function boxGap(a: Box, b: Box) {
  const dx = Math.max(0, a.left - b.right, b.left - a.right);
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  return Math.hypot(dx, dy);
}

function unionBox(rects: Box[]): Box {
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

function expand(b: Box, by: number): Box {
  return { left: b.left - by, top: b.top - by, right: b.right + by, bottom: b.bottom + by };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function center(b: Box): Point {
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Point, k: number): Point {
  return { x: v.x * k, y: v.y * k };
}

function normalize(v: Point): Point {
  const length = Math.hypot(v.x, v.y);
  return length === 0 ? { x: 0, y: -1 } : { x: v.x / length, y: v.y / length };
}

function clampLength(v: Point, max: number): Point {
  const length = Math.hypot(v.x, v.y);
  return length > max ? scale(v, max / length) : v;
}
