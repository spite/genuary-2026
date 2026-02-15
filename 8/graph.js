import {
  Vector2,
  Vector3,
  LineBasicMaterial,
  Line as LineMesh,
  BufferGeometry,
  Color,
  ArrowHelper,
  Shape,
  Mesh,
  ShapeGeometry,
  MeshBasicMaterial,
  DoubleSide,
  Group,
} from "three";
import { ImprovedNoise } from "third_party/ImprovedNoise.js";

const noise = new ImprovedNoise();

let minDistance = 1;
let minTwistDistance = 1;
let minAngle = Math.PI / 2 - 1;
let maxAngle = Math.PI / 2 + 1;
let probability = 0.995;
let noiseScale = 1;
let radius = 10;

const lines = [];

const nodes = [];

const dt = 0.1;

function getNode(p) {
  const id = nodes.length;
  nodes.push(p.clone());
  return id;
}

function getRandomDirection() {
  const res = new Vector3();
  do {
    res.set(Maf.randomInRange(-1, 1), 0, Maf.randomInRange(-1, 1));
  } while (isNaN(res.length()));
  return res;
}

function getSegmentIntersection(
  start1,
  end1,
  start2,
  end2,
  includeEndpoints = true,
  target = new Vector3(),
) {
  const x1 = start1.x,
    y1 = start1.z;
  const x2 = end1.x,
    y2 = end1.z;
  const x3 = start2.x,
    y3 = start2.z;
  const x4 = end2.x,
    y4 = end2.z;

  const denominator = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);

  if (Math.abs(denominator) < 1e-10) {
    return null;
  }

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator;

  if (includeEndpoints) {
    if (ua < 0 || ua > 1 || ub < 0 || ub > 1) {
      return null;
    }
  } else {
    if (ua <= 0 || ua >= 1 || ub <= 0 || ub >= 1) {
      return null;
    }
  }

  const x = x1 + ua * (x2 - x1);
  const z = y1 + ua * (y2 - y1);

  return target.set(x, 0, z);
}

const up = new Vector3(0, 1, 0);

class Line {
  constructor(startNode, direction) {
    this.id = lines.length;
    this.startNode = startNode;
    this.endNode = null;
    this.start = new Vector3().copy(nodes[this.startNode]);
    this.end = this.start.clone();
    this.direction = direction;
    this.direction.normalize().multiplyScalar(dt);
    this.active = true;
    this.color = new Color();
    this.color.setHSL(
      Math.random(),
      Maf.randomInRange(0.5, 1),
      Maf.randomInRange(0.25, 0.75),
    );
    this.stepsSinceLastSplit = 0;
    this.stepsSinceLastTwist = 0;
  }

  grow() {
    if (!this.active) {
      return;
    }

    this.stepsSinceLastSplit++;
    this.stepsSinceLastTwist++;
    this.end.add(this.direction);

    const intersects = this.intersects();
    if (intersects.length) {
      const end = getNode(intersects[0].point.clone());
      this.close(end);

      const other = lines[intersects[0].id];
      const closedDir = new Vector3().subVectors(other.end, other.start);
      const closed = new Line(other.startNode, closedDir);
      closed.close(end);
      lines.push(closed);

      other.startNode = end;
      other.start.copy(intersects[0].point);

      return;
    }

    if (this.end.length() > radius) {
      const node = getNode(this.end.clone());
      this.close(node);
      return;
    }

    if (
      this.stepsSinceLastSplit * dt > minDistance &&
      Math.random() < probability
    ) {
      this.split();
    } else if (this.stepsSinceLastTwist * dt > minTwistDistance) {
      this.twist();
    }
  }

  intersects() {
    const res = [];

    for (const line of lines) {
      if (line.id === this.id) continue;
      const i = getSegmentIntersection(
        this.start,
        this.end,
        line.start,
        line.end,
        false,
      );
      if (i) {
        res.push({ id: line.id, point: i });
      }
    }

    res.sort(
      (a, b) =>
        this.start.distanceToSquared(a.point) -
        this.start.distanceToSquared(b.point),
    );
    return res;
  }

  restart(node) {
    this.startNode = node;
    this.start.copy(nodes[this.startNode]);
    this.end.copy(this.start);
  }

  close(node) {
    this.endNode = node;
    this.end.copy(nodes[this.endNode]);
    this.active = false;
  }

  twist() {
    const newStart = getNode(this.end.clone());

    const old = new Line(this.startNode, this.direction.clone());
    old.close(newStart);
    lines.push(old);

    this.restart(newStart);
    this.stepsSinceLastTwist = 0;

    let angle = Math.atan2(this.direction.z, this.direction.x);
    const s = noiseScale;
    const n = noise.noise(this.end.x * s, this.end.y * s, this.end.z * s);
    angle += Maf.map(-1, 1, 0, 0.01 * 2 * Math.PI, n);
    this.direction.x = Math.cos(angle);
    this.direction.z = Math.sin(angle);
    this.direction.normalize().multiplyScalar(dt);
  }

  split() {
    const newStart = getNode(this.end.clone());

    const old = new Line(this.startNode, this.direction.clone());
    old.close(newStart);
    lines.push(old);

    this.restart(newStart);
    this.stepsSinceLastSplit = 0;

    const s = Math.random() > 0.5 ? 1 : -1;
    const angle = Maf.randomInRange(minAngle, maxAngle);
    const dir = this.direction.clone().applyAxisAngle(up, angle * s);
    const line = new Line(this.startNode, dir, old.id);
    lines.push(line);

    if (Math.random() > 0.5) {
      const dir2 = this.direction
        .clone()
        .applyAxisAngle(up, angle * s + Math.PI);
      const line = new Line(this.startNode, dir2, old.id);
      lines.push(line);
    }
  }

  getPoints() {
    const points = [];
    const origin = this.start.clone();
    const end = this.end.clone();

    points.push(origin);
    points.push(end);
    return points;
  }
}

function start(x, y, numLines = 1) {
  const id = getNode(new Vector3(x, 0, y));

  for (let i = 0; i < numLines; i++) {
    const line = new Line(id, getRandomDirection(), null);
    lines.push(line);
  }
}

function update(n = 1) {
  for (let i = 0; i < n; i++) {
    // Snapshot the current line count so newly-created lines
    // (from split/twist/intersection) aren't grown in the same step
    const count = lines.length;
    for (let j = 0; j < count; j++) {
      lines[j].grow();
    }
  }
}

function reset(options) {
  minDistance = options.minDistance;
  minTwistDistance = options.minTwistDistance;
  minAngle = options.minAngle;
  maxAngle = options.maxAngle;
  probability = options.probability;
  noiseScale = options.noiseScale;

  lines.length = 0;
  nodes.length = 0;
}

function draw() {
  const active = lines.some((l) => l.active);
  if (!active) {
    return [];
  }
  const res = [];
  for (const line of lines) {
    const points = line.getPoints();
    if (line.active) {
      const d = points[1].clone().sub(points[0]);
      const a = new ArrowHelper(
        d,
        points[0],
        d.length(),
        line.active ? 0xffff00 : line.color,
        0.1,
        0.1,
      );
      res.push(a);
    } else {
      const geometry = new BufferGeometry().setFromPoints(points);
      const material = new LineBasicMaterial({ color: line.color });

      const l = new LineMesh(geometry, material);
      l.frustumCulled = false;
      res.push(l);
    }
  }
  return res;
}

function calculateArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

function getEdges() {
  const edges = [];
  for (const line of lines) {
    edges.push({ id: line.id, from: line.startNode, to: line.endNode });
  }
  return edges;
}

function getVertices() {
  const vertices = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    vertices.push({ id: i, x: node.x, y: node.z });
  }
  return vertices;
}

function areActiveLines() {
  return lines.some((l) => l.active);
}

function createShape(shapePoints) {
  const shape = new Shape(shapePoints);
  const geometry = new ShapeGeometry(shape);

  const color = new Color();
  color.setHSL(
    Math.random(),
    Maf.randomInRange(0.5, 1),
    Maf.randomInRange(0.25, 0.75),
  );

  const material = new MeshBasicMaterial({
    color,
    side: DoubleSide,
    wireframe: true,
    // opacity: 0.5,
    // transparent: true,
  });

  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;

  return mesh;
}

function createOutline(points) {
  const material = new LineBasicMaterial({ color: 0xff00ff });
  const pts = points.map((v) => new Vector3(v.x, 0, v.y));
  pts.push(pts[0].clone());
  const geometry = new BufferGeometry().setFromPoints(pts);
  const line = new LineMesh(geometry, material);
  return line;
}

export function offsetPolygon(indices, vertexPool, offset) {
  const EMPTY = { indices: [], vertices: [] };
  if (!indices || indices.length < 3) return EMPTY;

  // ── 1. Build clean vertex path from indices ──
  let path = [];
  for (const idx of indices) {
    const v = vertexPool[idx];
    if (!v) continue;
    const pt = new Vector2(v.x, v.y);
    if (path.length > 0 && path[path.length - 1].distanceToSquared(pt) < 1e-8)
      continue;
    path.push(pt);
  }
  if (
    path.length > 2 &&
    path[0].distanceToSquared(path[path.length - 1]) < 1e-8
  )
    path.pop();

  // Remove collinear vertices (they produce degenerate zero-area edges)
  path = filterCollinear(path);
  if (path.length < 3) return EMPTY;

  // ── 2. Normalize to CCW ──
  const origArea = signedArea2D(path);
  if (Math.abs(origArea) < 1e-6) return EMPTY;
  const wasCW = origArea < 0;
  if (wasCW) path.reverse();
  const absArea = Math.abs(origArea);

  // ── 3. Feasibility checks ──
  // 3a. Inradius: approximate max inset before total collapse
  let perimeter = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i],
      b = path[(i + 1) % path.length];
    perimeter += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  }
  if (offset >= (2 * absArea) / perimeter) return EMPTY;

  // 3b. Per-edge: centroid must be further than offset from every edge
  const cx = path.reduce((s, p) => s + p.x, 0) / path.length;
  const cy = path.reduce((s, p) => s + p.y, 0) / path.length;
  for (let i = 0; i < path.length; i++) {
    const a = path[i],
      b = path[(i + 1) % path.length];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) continue;
    // Signed distance from centroid to edge line (positive = inward for CCW)
    const dist = ((cx - a.x) * -dy + (cy - a.y) * dx) / len;
    if (offset >= dist) return EMPTY;
  }

  // ── 4. Offset each edge inward by `offset` ──
  const n = path.length;
  const offEdges = [];
  for (let i = 0; i < n; i++) {
    const a = path[i],
      b = path[(i + 1) % n];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = (-dy / len) * offset,
      ny = (dx / len) * offset;
    offEdges.push({
      ax: a.x + nx,
      ay: a.y + ny,
      bx: b.x + nx,
      by: b.y + ny,
    });
  }

  // ── 5. Intersect consecutive offset edges → new vertices ──
  let result = [];
  for (let i = 0; i < n; i++) {
    const e1 = offEdges[(i - 1 + n) % n];
    const e2 = offEdges[i];
    const d1x = e1.bx - e1.ax,
      d1y = e1.by - e1.ay;
    const d2x = e2.bx - e2.ax,
      d2y = e2.by - e2.ay;
    const denom = d1x * d2y - d1y * d2x;

    if (Math.abs(denom) < 1e-10) {
      // Parallel edges → midpoint
      result.push(
        new Vector2((e1.bx + e2.ax) / 2, (e1.by + e2.ay) / 2),
      );
    } else {
      const t =
        ((e2.ax - e1.ax) * d2y - (e2.ay - e1.ay) * d2x) / denom;
      result.push(new Vector2(e1.ax + t * d1x, e1.ay + t * d1y));
    }
  }

  // ── 6. Remove self-intersections iteratively ──
  result = removeSelfIntersections(result);
  if (!result || result.length < 3) return EMPTY;

  // ── 7. Remove near-duplicate vertices ──
  result = dedup(result);
  if (result.length < 3) return EMPTY;

  // ── 8. Validate: winding preserved and area decreased ──
  const newArea = signedArea2D(result);
  if (newArea <= 0 || newArea > absArea) return EMPTY;

  // ── 9. Restore original winding ──
  if (wasCW) result.reverse();

  return { vertices: result, indices: result.map((_, i) => i) };
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function signedArea2D(pts) {
  let a = 0;
  for (let i = 0, len = pts.length; i < len; i++) {
    const j = (i + 1) % len;
    a += pts[i].x * pts[j].y;
    a -= pts[j].x * pts[i].y;
  }
  return a / 2;
}

function filterCollinear(pts) {
  const out = [];
  const len = pts.length;
  for (let i = 0; i < len; i++) {
    const prev = pts[(i - 1 + len) % len];
    const curr = pts[i];
    const next = pts[(i + 1) % len];
    const cross =
      (curr.x - prev.x) * (next.y - curr.y) -
      (curr.y - prev.y) * (next.x - curr.x);
    if (Math.abs(cross) > 1e-8) out.push(curr);
  }
  return out;
}

function dedup(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].distanceToSquared(out[out.length - 1]) > 1e-8) out.push(pts[i]);
  }
  if (
    out.length > 2 &&
    out[out.length - 1].distanceToSquared(out[0]) < 1e-8
  )
    out.pop();
  return out;
}

function segXseg(ax, ay, bx, by, cx, cy, dx, dy) {
  const abx = bx - ax,
    aby = by - ay;
  const cdx = dx - cx,
    cdy = dy - cy;
  const den = abx * cdy - aby * cdx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * cdy - (cy - ay) * cdx) / den;
  const u = ((cx - ax) * aby - (cy - ay) * abx) / den;
  // Strict interior of both segments (no endpoints)
  if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
    return new Vector2(ax + t * abx, ay + t * aby);
  }
  return null;
}

function removeSelfIntersections(pts) {
  let maxIter = 50;
  while (maxIter-- > 0) {
    const len = pts.length;
    if (len < 3) return null;

    let hit = null;
    let hi = -1,
      hj = -1;

    // Find the first self-intersection
    outer: for (let i = 0; i < len; i++) {
      const a = pts[i],
        b = pts[(i + 1) % len];
      for (let j = i + 2; j < len; j++) {
        if (i === 0 && j === len - 1) continue; // adjacent wrap
        const c = pts[j],
          d = pts[(j + 1) % len];
        hit = segXseg(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
        if (hit) {
          hi = i;
          hj = j;
          break outer;
        }
      }
    }

    if (!hit) break; // clean

    // Split into two loops at the intersection
    const loop1 = [];
    for (let k = 0; k <= hi; k++) loop1.push(pts[k]);
    loop1.push(hit);
    for (let k = hj + 1; k < len; k++) loop1.push(pts[k]);

    const loop2 = [hit];
    for (let k = hi + 1; k <= hj; k++) loop2.push(pts[k]);

    // Keep the CCW loop with the largest positive area.
    // A flipped/spike loop will be CW (negative area).
    const a1 = signedArea2D(loop1);
    const a2 = signedArea2D(loop2);

    if (a1 > 0 && a2 > 0) {
      pts = a1 >= a2 ? loop1 : loop2;
    } else if (a1 > 0) {
      pts = loop1;
    } else if (a2 > 0) {
      pts = loop2;
    } else {
      // Both CW — shape fully degenerate
      return null;
    }
  }
  return pts;
}

function extractFaces() {
  const edges = getEdges();
  const vertices = getVertices();

  if (vertices.length < 3 || edges.length < 3) return [];

  const adj = new Map();
  vertices.forEach((v) => adj.set(v.id, []));

  edges.forEach((e) => {
    const v1 = vertices.find((v) => v.id === e.from);
    const v2 = vertices.find((v) => v.id === e.to);
    if (!v1 || !v2) return;

    adj.get(v1.id)?.push({
      from: v1.id,
      to: v2.id,
      angle: Math.atan2(v2.y - v1.y, v2.x - v1.x),
      visited: false,
    });
    adj.get(v2.id)?.push({
      from: v2.id,
      to: v1.id,
      angle: Math.atan2(v1.y - v2.y, v1.x - v2.x),
      visited: false,
    });
  });

  adj.forEach((list) => {
    list.sort((a, b) => a.angle - b.angle);
  });

  const faces = [];

  adj.forEach((outEdges) => {
    outEdges.forEach((startEdge) => {
      if (startEdge.visited) return;

      const path = [];
      let currEdge = startEdge;

      while (!currEdge.visited) {
        currEdge.visited = true;
        path.push(currEdge.from);

        const nextU = currEdge.to;
        const nextUEdges = adj.get(nextU) || [];
        if (nextUEdges.length === 0) break;

        const reverseAngle = Math.atan2(
          (vertices.find((v) => v.id === currEdge.from)?.y || 0) -
            (vertices.find((v) => v.id === nextU)?.y || 0),
          (vertices.find((v) => v.id === currEdge.from)?.x || 0) -
            (vertices.find((v) => v.id === nextU)?.x || 0),
        );

        let revIdx = -1;
        const EPS = 0.00001;
        for (let i = 0; i < nextUEdges.length; i++) {
          if (Math.abs(nextUEdges[i].angle - reverseAngle) < EPS) {
            revIdx = i;
            break;
          }
        }

        if (revIdx === -1) break;

        const nextEdgeIdx = (revIdx + 1) % nextUEdges.length;
        currEdge = nextUEdges[nextEdgeIdx];

        if (path.length > vertices.length * 2) break;
      }

      if (path.length >= 3) {
        // Validate: skip paths with repeated vertex IDs (degenerate faces)
        const seen = new Set();
        let hasDupe = false;
        for (const id of path) {
          if (seen.has(id)) {
            hasDupe = true;
            break;
          }
          seen.add(id);
        }
        if (hasDupe) return;

        // Compute raw face area to skip the outer boundary face
        const facePoints = path
          .map((id) => vertices.find((v) => v.id === id))
          .filter(Boolean);
        if (facePoints.length < 3) return;
        const rawArea = calculateArea(facePoints);
        // Skip CW-wound faces (outer boundary) and tiny faces
        if (rawArea >= -0.01) return;

        const pts = path.map((p) => p);
        const p = offsetPolygon(pts, vertices, 0.1);
        const min = 0;
        if (p.vertices.length >= 3) {
          const bb = getBoundingBox(p.vertices);
          if (bb.width > min && bb.height > min) {
            const f = createOutline(p.vertices);
            faces.push(f);
          }
        }
      }
    });
  });

  return faces;
}

function addBoundary() {
  const r = radius;
  const origin = getNode(new Vector3(r * Math.cos(0), 0, r * Math.sin(0)));
  let a = origin;
  const sides = 36;
  for (let i = 1; i < sides; i++) {
    const angle = Maf.map(0, sides, 0, -2 * Math.PI, i);
    const nodePos = new Vector3(r * Math.cos(angle), 0, r * Math.sin(angle));
    const node = getNode(nodePos);
    const dir = new Vector3().subVectors(nodePos, nodes[a]);
    const line = new Line(a, dir);
    line.close(node);
    lines.push(line);
    a = node;
  }
  const dir = new Vector3().subVectors(nodes[origin], nodes[a]);
  const line = new Line(a, dir);
  line.close(origin);
  lines.push(line);
}

function getBoundingBox(points) {
  if (points.length < 2) {
    const p = points[0] || { x: 0, y: 0 };
    return { cx: p.x, cy: p.y, width: 0, height: 0, angle: 0 };
  }

  let bestArea = Infinity;
  let best = null;

  // Test OBB aligned to each edge of the polygon
  const len = points.length;
  for (let i = 0; i < len; i++) {
    const a = points[i];
    const b = points[(i + 1) % len];
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const el = Math.sqrt(ex * ex + ey * ey);
    if (el < 1e-10) continue;

    // Unit edge direction and perpendicular
    const ux = ex / el,
      uy = ey / el;
    const vx = -uy,
      vy = ux;

    // Project all points onto this frame
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const p of points) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;

    if (area < bestArea) {
      bestArea = area;
      const midU = (minU + maxU) / 2;
      const midV = (minV + maxV) / 2;
      best = {
        cx: midU * ux + midV * vx,
        cy: midU * uy + midV * vy,
        width: w,
        height: h,
        angle: Math.atan2(uy, ux),
      };
    }
  }

  return best;
}

export {
  start,
  update,
  draw,
  reset,
  extractFaces,
  areActiveLines,
  addBoundary,
  getBoundingBox,
};
