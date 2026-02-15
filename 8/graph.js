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
  if (!indices || indices.length < 3) return { indices: [], vertices: [] };

  const EMPTY = { indices: [], vertices: [] };
  const EPS_SQ = 1e-8;

  // 1. Dereference indices to Vector2 points, skip near-duplicate neighbors
  let path = [];
  for (let i = 0; i < indices.length; i++) {
    const v = vertexPool[indices[i]];
    if (!v) continue;
    const pt = new Vector2(v.x, v.y);
    if (path.length > 0 && path[path.length - 1].distanceToSquared(pt) < EPS_SQ)
      continue;
    path.push(pt);
  }
  // Remove last if it duplicates first
  if (
    path.length > 2 &&
    path[0].distanceToSquared(path[path.length - 1]) < EPS_SQ
  )
    path.pop();

  // Also remove collinear points — they cause zero-length normals
  path = removeCollinear(path);

  if (path.length < 3) return EMPTY;

  // 2. Ensure CCW winding for predictable inward offset direction
  const origArea = signedArea2D(path);
  if (Math.abs(origArea) < 1e-6) return EMPTY;
  const isCCW = origArea > 0;
  if (!isCCW) path.reverse();

  // 3. Compute miter offset
  let newPath = miterOffset(path, offset);
  if (!newPath) return EMPTY;

  // 4. Remove self-intersections (critical for sharp/thin polygons)
  newPath = cleanSelfIntersections(newPath);
  if (!newPath || newPath.length < 3) return EMPTY;

  // 5. Discard if area collapsed or winding flipped (thin shape inverted)
  const newArea = signedArea2D(newPath);
  if (newArea < 1e-4) return EMPTY; // path was CCW (positive); flipped or tiny → discard

  // 6. Restore original winding
  if (!isCCW) newPath.reverse();

  return {
    vertices: newPath,
    indices: newPath.map((_, i) => i),
  };
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function signedArea2D(pts) {
  let area = 0;
  for (let i = 0, len = pts.length; i < len; i++) {
    const j = (i + 1) % len;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return area / 2;
}

function removeCollinear(pts) {
  const out = [];
  const len = pts.length;
  for (let i = 0; i < len; i++) {
    const prev = pts[(i - 1 + len) % len];
    const curr = pts[i];
    const next = pts[(i + 1) % len];
    // Cross product of (curr-prev) x (next-curr)
    const cross =
      (curr.x - prev.x) * (next.y - curr.y) -
      (curr.y - prev.y) * (next.x - curr.x);
    if (Math.abs(cross) > 1e-8) {
      out.push(curr);
    }
  }
  return out;
}

function miterOffset(points, offset) {
  const count = points.length;
  if (count < 3) return null;

  // 1. Build offset edges: for each edge, shift both endpoints along inward normal
  const offsetEdges = [];
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % count];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) {
      offsetEdges.push(null);
      continue;
    }
    // Inward normal for CCW polygon: rotate edge direction 90° CCW
    const nx = -dy / len,
      ny = dx / len;
    offsetEdges.push({
      ax: a.x + nx * offset,
      ay: a.y + ny * offset,
      bx: b.x + nx * offset,
      by: b.y + ny * offset,
    });
  }

  // 2. For each vertex i (between edge i-1 and edge i), intersect the two offset edges
  const result = [];
  for (let i = 0; i < count; i++) {
    const prevEdge = offsetEdges[(i - 1 + count) % count];
    const currEdge = offsetEdges[i];

    if (!prevEdge || !currEdge) {
      // Degenerate edge — fall back to simple normal offset from original point
      const curr = points[i];
      const next = points[(i + 1) % count];
      const dx = next.x - curr.x,
        dy = next.y - curr.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      result.push(
        new Vector2(
          curr.x + (-dy / len) * offset,
          curr.y + (dx / len) * offset,
        ),
      );
      continue;
    }

    // Intersect line (prevEdge.a → prevEdge.b) with line (currEdge.a → currEdge.b)
    const d1x = prevEdge.bx - prevEdge.ax,
      d1y = prevEdge.by - prevEdge.ay;
    const d2x = currEdge.bx - currEdge.ax,
      d2y = currEdge.by - currEdge.ay;
    const denom = d1x * d2y - d1y * d2x;

    if (Math.abs(denom) < 1e-10) {
      // Parallel offset edges (collinear original edges) — use midpoint of the two edge endpoints
      result.push(
        new Vector2(
          (prevEdge.bx + currEdge.ax) / 2,
          (prevEdge.by + currEdge.ay) / 2,
        ),
      );
      continue;
    }

    const t =
      ((currEdge.ax - prevEdge.ax) * d2y - (currEdge.ay - prevEdge.ay) * d2x) /
      denom;
    const ix = prevEdge.ax + t * d1x;
    const iy = prevEdge.ay + t * d1y;

    // Cap: if the intersection is too far from the original vertex, the angle
    // is very acute and creates a miter spike. Clamp along the direction
    // from original vertex to intersection point.
    const curr = points[i];
    const dx = ix - curr.x,
      dy = iy - curr.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Get lengths of the two adjacent edges
    const prev = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const e1 = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
    const e2 = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2);
    const maxDist = Math.min(e1, e2) * 0.45;

    if (dist > maxDist && dist > 1e-10) {
      // Clamp to maxDist along the same direction
      const scale = maxDist / dist;
      result.push(new Vector2(curr.x + dx * scale, curr.y + dy * scale));
    } else {
      result.push(new Vector2(ix, iy));
    }
  }

  return result;
}

function segIntersect2D(ax, ay, bx, by, cx, cy, dx, dy) {
  const abx = bx - ax,
    aby = by - ay;
  const cdx = dx - cx,
    cdy = dy - cy;
  const denom = abx * cdy - aby * cdx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((cx - ax) * cdy - (cy - ay) * cdx) / denom;
  const u = ((cx - ax) * aby - (cy - ay) * abx) / denom;
  if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
    return new Vector2(ax + t * abx, ay + t * aby);
  }
  return null;
}

function cleanSelfIntersections(points) {
  let pts = points;
  let maxIter = pts.length * 2;

  while (maxIter-- > 0) {
    const len = pts.length;
    if (len < 3) return null;

    let found = false;

    for (let i = 0; i < len && !found; i++) {
      const a = pts[i],
        b = pts[(i + 1) % len];

      for (let j = i + 2; j < len; j++) {
        // Skip adjacent edge pair (closing edge vs first edge)
        if (i === 0 && j === len - 1) continue;

        const c = pts[j],
          d = pts[(j + 1) % len];
        const hit = segIntersect2D(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);

        if (hit) {
          // Two candidate loops:
          // loop1: [0..i, hit, j+1..end]  (skip the bulge between i+1..j)
          // loop2: [i+1..j, hit]           (the bulge itself)
          // Keep the one with larger area
          const loop1 = [];
          for (let k = 0; k <= i; k++) loop1.push(pts[k]);
          loop1.push(hit);
          for (let k = j + 1; k < len; k++) loop1.push(pts[k]);

          const loop2 = [hit];
          for (let k = i + 1; k <= j; k++) loop2.push(pts[k]);

          const a1 = Math.abs(signedArea2D(loop1));
          const a2 = Math.abs(signedArea2D(loop2));

          pts = a1 >= a2 ? loop1 : loop2;
          found = true;
          break;
        }
      }
    }

    if (!found) break;
  }

  // Final: remove any near-duplicate points that slipped through
  const cleaned = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].distanceToSquared(cleaned[cleaned.length - 1]) > 1e-8) {
      cleaned.push(pts[i]);
    }
  }

  return cleaned.length >= 3 ? cleaned : null;
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
        const min = 0.5;
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
