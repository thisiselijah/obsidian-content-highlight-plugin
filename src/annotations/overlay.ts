import rough from "roughjs";
import {
  AnnotationAnchor,
  Box,
  followMemory,
  layoutAnnotations,
  seededRandom,
  LayoutMemory,
  NoteMeasure,
  NoteSize,
  Point,
} from "src/annotations/layout";
import { HighlightrSettings } from "src/settings/settingsData";

const SVG_NS = "http://www.w3.org/2000/svg";

// Fired on window when a setting that affects how annotations are drawn changes.
export const ANNOTATIONS_CHANGED_EVENT = "Highlightr-AnnotationsChanged";

// Non-text content that notes must not cover. Text is collected separately, per line fragment.
const OBSTACLE_SELECTOR = [
  "img", "video", "iframe", "canvas", "svg", "pre", "table", "hr",
  ".cm-gutters", ".callout", ".internal-embed", ".cm-embed-block", ".math-block",
  ".HyperMD-codeblock", ".list-bullet", ".task-list-item-checkbox",
].join(", ");

// Obstacles further than this (px) from every highlight are left out; the
// layout only looks about 10 line heights away.
const OBSTACLE_MARGIN = 400;

interface AnnotationSource {
  anchor: AnnotationAnchor;
  note: string;
  color: string;
}

/**
 * Draws annotations for every `.hltr[data-hltr-note]` element inside a
 * scrolling host (`.cm-scroller` in Live Preview, `.markdown-preview-view` in
 * Reading mode). Each render measures where text actually sits on screen and
 * places notes in the free space around their highlight. The layer is
 * absolutely positioned in the host's scroll content, so it scrolls with the
 * text and only needs re-rendering when the layout changes.
 */
export class AnnotationOverlay {
  readonly el: HTMLDivElement;
  // Layout assumes each note keeps the size it was measured at. Late-loading
  // fonts or stylesheets (e.g. right after a hot reload) break that, so ask
  // for a fresh render when a placed note's size drifts.
  private placedSizes = new Map<Element, NoteSize>();
  // The last layout, replayed until an annotation is added or changed.
  private layoutMemory: LayoutMemory = new Map();
  // Remembered spots are tuned to one pane width; start fresh when it changes.
  private layoutWidth = 0;
  private noteResizes = new ResizeObserver((entries) => {
    const drifted = entries.some(({ target }) => {
      const expected = this.placedSizes.get(target);
      // offset* sizes ignore the tilt transform, which would otherwise read as a resize.
      const { offsetWidth, offsetHeight } = target as HTMLElement;
      return (
        expected &&
        (Math.abs(offsetWidth - expected.width) > 1 || Math.abs(offsetHeight - expected.height) > 1)
      );
    });
    // The remembered layout was built for the old size; lay out again.
    if (drifted) {
      this.layoutMemory.clear();
      this.requestRender();
    }
  });

  // Settings can change where notes belong (randomness), so start the layout fresh.
  private onSettingsChanged = () => {
    this.layoutMemory.clear();
    this.requestRender();
  };

  constructor(
    private host: HTMLElement,
    private settings: HighlightrSettings,
    private requestRender: () => void
  ) {
    this.host.addClass("hltr-annotation-host");
    this.el = this.host.ownerDocument.createElement("div");
    this.el.addClass("hltr-annotation-layer");
    this.host.appendChild(this.el);
    window.addEventListener(ANNOTATIONS_CHANGED_EVENT, this.onSettingsChanged);
  }

  render() {
    this.noteResizes.disconnect();
    this.placedSizes.clear();
    this.el.empty();
    if (this.host.clientWidth === 0) return;

    const hostRect = this.host.getBoundingClientRect();
    const offsetX = this.host.scrollLeft - hostRect.left - this.host.clientLeft;
    const offsetY = this.host.scrollTop - hostRect.top - this.host.clientTop;
    const toLocal = (r: DOMRect): Box => ({
      left: r.left + offsetX,
      top: r.top + offsetY,
      right: r.right + offsetX,
      bottom: r.bottom + offsetY,
    });

    const sources = this.collectSources(toLocal);
    if (sources.size === 0) return;

    const anchors = [...sources.values()].map((s) => s.anchor);
    const notes = new Map<string, HTMLElement>();
    for (const [id, source] of sources) {
      notes.set(id, this.createNote(source));
    }

    if (this.host.clientWidth !== this.layoutWidth) {
      this.layoutMemory.clear();
      this.layoutWidth = this.host.clientWidth;
    }

    // Notes and arrows only get re-decided when an annotation is new or has
    // changed; otherwise the last layout just follows the text as it moves.
    const placements =
      followMemory(anchors, this.layoutMemory) ??
      layoutAnnotations(
        anchors,
        this.collectObstaclesAround(anchors, toLocal),
        { left: this.host.scrollLeft, right: this.host.scrollLeft + this.host.clientWidth },
        (id, width) => measureNote(notes.get(id)!, width),
        this.layoutMemory,
        this.settings.annotationRandomness
      );

    for (const placement of placements) {
      const source = sources.get(placement.id)!;
      const note = notes.get(placement.id)!;
      const seed = source.anchor.seed;

      if (placement.kind === "marker") {
        note.remove();
        this.drawMarker(placement.at, source, seed);
        continue;
      }

      note.style.width = `${placement.note.right - placement.note.left}px`;
      note.style.left = `${placement.note.left}px`;
      note.style.top = `${placement.note.top}px`;
      note.addClass("is-placed");
      // A slight tilt, as if written by hand (up to ±2° at full randomness).
      const tilt = (seededRandom(seed + 1)() - 0.5) * 4 * this.settings.annotationRandomness;
      note.style.transform = `rotate(${tilt.toFixed(2)}deg)`;
      this.placedSizes.set(note, {
        width: placement.note.right - placement.note.left,
        height: placement.note.bottom - placement.note.top,
      });
      this.noteResizes.observe(note);
      // The arrow's start is attached to the note, so it turns with the tilt
      // (CSS rotates about the note's center, clockwise for positive angles).
      const [start, ...rest] = placement.arrow;
      const pivot = {
        x: (placement.note.left + placement.note.right) / 2,
        y: (placement.note.top + placement.note.bottom) / 2,
      };
      const angle = (tilt * Math.PI) / 180;
      const tilted = {
        x: pivot.x + (start.x - pivot.x) * Math.cos(angle) - (start.y - pivot.y) * Math.sin(angle),
        y: pivot.y + (start.x - pivot.x) * Math.sin(angle) + (start.y - pivot.y) * Math.cos(angle),
      };
      this.drawArrow([tilted, ...rest], source.color, seed, this.settings.annotationRandomness);
    }
  }

  destroy() {
    window.removeEventListener(ANNOTATIONS_CHANGED_EVENT, this.onSettingsChanged);
    this.noteResizes.disconnect();
    this.el.remove();
    this.host.removeClass("hltr-annotation-host");
  }

  // One source per annotation, keyed by its content (highlighted text, note,
  // color) rather than its position, so its remembered layout survives edits
  // elsewhere in the note and a changed note counts as a new annotation.
  // Live Preview may split one highlight into several spans; they share a
  // `data-hltr-id` and are grouped first.
  private collectSources(toLocal: (r: DOMRect) => Box) {
    const groups = new Map<string, { els: HTMLElement[]; rects: Box[] }>();
    this.host.querySelectorAll<HTMLElement>(".hltr[data-hltr-note]").forEach((el, index) => {
      if (this.el.contains(el)) return;
      const rects = visibleRects(el.getClientRects()).map(toLocal);
      if (rects.length === 0) return;

      const key = el.dataset.hltrId ?? `mark-${index}`;
      const group = groups.get(key);
      if (group) {
        group.els.push(el);
        group.rects.push(...rects);
      } else {
        groups.set(key, { els: [el], rects });
      }
    });

    const sources = new Map<string, AnnotationSource>();
    for (const { els, rects } of groups.values()) {
      const note = els[0].dataset.hltrNote ?? "";
      const color = els[0].style.getPropertyValue("--hltr-color");
      const text = els.map((el) => el.textContent ?? "").join("");
      const base = `${text}\u0000${note}\u0000${color}`;
      // Identical annotations are told apart by order.
      let id = base;
      for (let n = 2; sources.has(id); n++) id = `${base}\u0000${n}`;
      sources.set(id, {
        // Seeded by content too, so typing elsewhere doesn't reshuffle its look.
        anchor: { id, rects, seed: hashSeed(id) },
        note,
        color: toStrokeColor(this.settings.annotationColorMode === "custom" ? this.settings.annotationColor : color),
      });
    }
    return sources;
  }

  private collectObstaclesAround(anchors: AnnotationAnchor[], toLocal: (r: DOMRect) => Box) {
    const rects = ([] as Box[]).concat(...anchors.map((a) => a.rects));
    return this.collectObstacles(
      toLocal,
      Math.min(...rects.map((r) => r.top)) - OBSTACLE_MARGIN,
      Math.max(...rects.map((r) => r.bottom)) + OBSTACLE_MARGIN
    );
  }

  // Boxes of everything drawn on screen between `top` and `bottom`: one box per
  // line fragment of each text node, plus non-text blocks.
  private collectObstacles(toLocal: (r: DOMRect) => Box, top: number, bottom: number) {
    const boxes: Box[] = [];
    const inWindow = (b: Box) => b.bottom >= top && b.top <= bottom;
    const doc = this.host.ownerDocument;
    const range = doc.createRange();
    const parentInWindow = new Map<Element, boolean>();

    const walker = doc.createTreeWalker(this.host, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue?.trim() || this.el.contains(parent)) continue;
      if (!parentInWindow.has(parent)) {
        parentInWindow.set(parent, inWindow(toLocal(parent.getBoundingClientRect())));
      }
      if (!parentInWindow.get(parent)) continue;

      range.selectNodeContents(node);
      for (const rect of visibleRects(range.getClientRects())) {
        boxes.push(toLocal(rect));
      }
    }

    this.host.querySelectorAll(OBSTACLE_SELECTOR).forEach((el) => {
      if (this.el.contains(el)) return;
      const [rect] = visibleRects([el.getBoundingClientRect()]);
      if (rect && inWindow(toLocal(rect))) boxes.push(toLocal(rect));
    });
    return boxes;
  }

  private createNote(source: AnnotationSource) {
    const note = this.el.ownerDocument.createElement("div");
    note.addClass("hltr-annotation-note");
    note.textContent = source.note;
    note.style.setProperty("--hltr-annotation-color", source.color);
    this.el.appendChild(note);
    return note;
  }

  private createSvg(bounds: Box) {
    const svg = this.el.ownerDocument.createElementNS(SVG_NS, "svg");
    svg.addClass("hltr-annotation-svg");
    svg.setAttribute("width", `${bounds.right - bounds.left}`);
    svg.setAttribute("height", `${bounds.bottom - bounds.top}`);
    svg.style.left = `${bounds.left}px`;
    svg.style.top = `${bounds.top}px`;
    this.el.appendChild(svg);
    return svg;
  }

  // A smooth curve guided by the route's turning points: a single hand-drawn
  // stroke, with solid arrowheads on the ends chosen in settings.
  private drawArrow(path: Point[], color: string, seed: number, randomness: number) {
    const from = path[0];
    const to = path[path.length - 1];
    if (Math.hypot(to.x - from.x, to.y - from.y) < 4) return;

    // Seeded, so each arrow keeps its own quirks across renders.
    const random = seededRandom(seed);
    // Symmetric variation in [-amount, amount], scaled by the randomness setting.
    const vary = (amount: number) => (random() - 0.5) * 2 * amount * randomness;
    const bowScale = 1 + vary(0.6);
    const flipBow = random() < 0.25 * randomness;
    const headScale = 1 + vary(0.25);
    const strokeWidth = 1.6 + vary(0.4);
    const roughness = Math.max(0.2, 0.6 + vary(0.35));

    const segments = splineSegments(jitterTurns(withBow(path, bowScale, flipBow), vary));
    const length = segments.reduce((sum, s) => sum + Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y), 0);

    // Each end's arrowhead follows the curve's tangent there, i.e. points away
    // from that end's control point (or the far end, if they coincide).
    const direction = this.settings.arrowDirection;
    const first = segments[0];
    const last = segments[segments.length - 1];
    const heads: Point[][] = [];
    if (direction === "to-highlight" || direction === "both") {
      heads.push(arrowhead(to, samePoint(last.c2, to) ? last.start : last.c2, length, headScale));
    }
    if (direction === "to-note" || direction === "both") {
      heads.push(arrowhead(from, samePoint(first.c1, from) ? first.end : first.c1, length, headScale));
    }

    // Each cubic segment stays inside the hull of its points.
    const points = ([] as Point[]).concat(...segments.map((s) => [s.start, s.c1, s.c2, s.end]), ...heads);
    const padding = 6;
    const bounds = {
      left: Math.min(...points.map((p) => p.x)) - padding,
      top: Math.min(...points.map((p) => p.y)) - padding,
      right: Math.max(...points.map((p) => p.x)) + padding,
      bottom: Math.max(...points.map((p) => p.y)) + padding,
    };
    const svg = this.createSvg(bounds);
    const local = (p: Point): [number, number] => [p.x - bounds.left, p.y - bounds.top];
    const d =
      `M ${local(from).join(" ")} ` +
      segments.map((s) => `C ${local(s.c1).join(" ")} ${local(s.c2).join(" ")} ${local(s.end).join(" ")}`).join(" ");

    const rc = rough.svg(svg);
    const stroke = {
      stroke: color,
      strokeWidth,
      roughness,
      bowing: 0.5,
      disableMultiStroke: true,
      seed,
    };
    svg.appendChild(rc.path(d, stroke));
    for (const head of heads) {
      svg.appendChild(
        rc.polygon(head.map(local), { ...stroke, roughness: 0.3, fill: color, fillStyle: "solid" })
      );
    }
  }

  // Fallback when no free space fits the note: a hand-drawn dot that shows the note on hover.
  private drawMarker(at: Point, source: AnnotationSource, seed: number) {
    const size = 12;
    const svg = this.createSvg({
      left: at.x + 1,
      top: at.y - size / 2,
      right: at.x + 1 + size,
      bottom: at.y + size / 2,
    });
    svg.addClass("hltr-annotation-marker");
    svg.setAttribute("aria-label", source.note);
    svg.setAttribute("data-tooltip-position", "top");

    const rc = rough.svg(svg);
    svg.appendChild(
      rc.circle(size / 2, size / 2, size - 3, {
        stroke: source.color,
        fill: source.color,
        fillStyle: "solid",
        roughness: 0.8,
        seed,
      })
    );
  }
}

// Size of a note at `width`, or at its natural single-line width when `width` is null.
function measureNote(note: HTMLElement, width: number | null): NoteMeasure {
  note.style.width = width === null ? "max-content" : `${width}px`;
  const rectWidth = Math.ceil(note.getBoundingClientRect().width) + 1;
  if (width === null) note.style.width = `${rectWidth}px`;
  return { width: width ?? rectWidth, height: note.offsetHeight, lines: textLines(note) };
}

// One box per line of a note's text, relative to its top-left corner (the
// note isn't tilted yet when measured). Fragments sharing a line are merged.
function textLines(note: HTMLElement): Box[] {
  const origin = note.getBoundingClientRect();
  const range = note.ownerDocument.createRange();
  range.selectNodeContents(note);
  const lines: Box[] = [];
  for (const r of visibleRects(range.getClientRects())) {
    const box = { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
    const line = lines.find((l) => Math.min(l.bottom, box.bottom) - Math.max(l.top, box.top) > (box.bottom - box.top) / 2);
    if (!line) {
      lines.push(box);
      continue;
    }
    line.left = Math.min(line.left, box.left);
    line.top = Math.min(line.top, box.top);
    line.right = Math.max(line.right, box.right);
    line.bottom = Math.max(line.bottom, box.bottom);
  }
  return lines;
}

// Triangle with its tip at `tip`, pointing away from `behind`.
function arrowhead(tip: Point, behind: Point, curveLength: number, scale = 1): Point[] {
  const angle = Math.atan2(tip.y - behind.y, tip.x - behind.x);
  const size = Math.min(10, curveLength * 0.4) * scale;
  const halfWidth = size * 0.45;
  const base = { x: tip.x - size * Math.cos(angle), y: tip.y - size * Math.sin(angle) };
  return [
    tip,
    { x: base.x - halfWidth * Math.sin(angle), y: base.y + halfWidth * Math.cos(angle) },
    { x: base.x + halfWidth * Math.sin(angle), y: base.y - halfWidth * Math.cos(angle) },
  ];
}

interface Segment {
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
}

// Quadratic B-spline guided by `points` (clamped to the first and last), as
// cubic Bézier segments. Unlike a spline through the points, it cuts the
// corners of the route, so a right-angle turn becomes one sweeping stroke.
function splineSegments(points: Point[]): Segment[] {
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (points.length < 3) {
    const [a, b] = points;
    return [{ start: a, c1: a, c2: b, end: b }];
  }
  const segments: Segment[] = [];
  let start = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i];
    const end = i === points.length - 2 ? points[i + 1] : mid(points[i], points[i + 1]);
    // Quadratic (start, control, end) as a cubic.
    segments.push({
      start,
      c1: { x: start.x + ((control.x - start.x) * 2) / 3, y: start.y + ((control.y - start.y) * 2) / 3 },
      c2: { x: end.x + ((control.x - end.x) * 2) / 3, y: end.y + ((control.y - end.y) * 2) / 3 },
      end,
    });
    start = end;
  }
  return segments;
}

// A straight two-point route (from the note `a` to the highlight `b`) gets a
// slight bow so it still looks hand-drawn, scaled by `scale`. A route that
// climbs or descends bows toward the note's row, so the stroke leaves the note
// along its line of text and turns into the highlight, instead of leaving at
// an angle to it. A level route bows upward, or downward if `flip`.
function withBow(path: Point[], scale = 1, flip = false): Point[] {
  if (path.length !== 2) return path;
  const [a, b] = path;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  let nx = (b.y - a.y) / length;
  let ny = -(b.x - a.x) / length;
  const level = Math.abs(b.y - a.y) <= 2;
  const side = level ? (flip ? 1 : -1) : Math.sign(a.y - b.y);
  if (ny * side < 0) {
    nx = -nx;
    ny = -ny;
  }
  const bow = Math.min(length * 0.12, 10) * scale;
  const mid = { x: (a.x + b.x) / 2 + nx * bow, y: (a.y + b.y) / 2 + ny * bow };
  // A route that climbs or descends must keep doing so (it may be crossing
  // text, which must be crossed one way only); only a level route bows up.
  if (Math.abs(b.y - a.y) > 2) mid.y = clamp(mid.y, Math.min(a.y, b.y), Math.max(a.y, b.y));
  return [a, mid, b];
}

// Nudges each turning point sideways (not the ends, which touch the note and
// the highlight), so no two arrows bend quite alike.
function jitterTurns(points: Point[], vary: (amount: number) => number): Point[] {
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    const prev = points[i - 1];
    const next = points[i + 1];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = vary(Math.min(length * 0.15, 12));
    const moved = { x: p.x + (-dy / length) * offset, y: p.y + (dx / length) * offset };
    // Where the route climbs or descends through this point, the nudge must not
    // make it double back vertically: the spline follows its points' ups and
    // downs, and text may only be crossed one way.
    const low = Math.min(prev.y, next.y);
    const high = Math.max(prev.y, next.y);
    if (p.y >= low && p.y <= high) moved.y = clamp(moved.y, low, high);
    return moved;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function samePoint(a: Point, b: Point) {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

function visibleRects(rects: ArrayLike<DOMRect>) {
  return Array.from(rects).filter((r) => r.width > 0 && r.height > 0);
}

// Highlight colors are usually translucent (#RRGGBBAA); arrows read better opaque.
// SVG presentation attributes can't resolve CSS variables, so fall back to currentColor.
function toStrokeColor(color: string) {
  const hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return `#${hex.slice(0, 6)}`;
  return color.trim() && !color.includes("var(") ? color.trim() : "currentColor";
}

// Stable per-annotation seed so the hand-drawn strokes don't jitter on re-render.
function hashSeed(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2147483646) + 1;
}
