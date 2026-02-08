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

class SpatialGrid {
  constructor(cellSize = 1) {
    this.cellSize = cellSize;
    this.cells = {};
  }

  _cellKey(ix, iz) {
    return `${ix},${iz}`;
  }

  clear() {
    this.cells = {};
  }

  insert(line) {
    const x1 = Math.min(line.start.x, line.end.x);
    const x2 = Math.max(line.start.x, line.end.x);
    const z1 = Math.min(line.start.z, line.end.z);
    const z2 = Math.max(line.start.z, line.end.z);

    const ix0 = Math.floor(x1 / this.cellSize);
    const ix1 = Math.floor(x2 / this.cellSize);
    const iz0 = Math.floor(z1 / this.cellSize);
    const iz1 = Math.floor(z2 / this.cellSize);

    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = this._cellKey(ix, iz);
        if (!this.cells[key]) this.cells[key] = [];
        this.cells[key].push(line.id);
      }
    }
  }

  build(lines) {
    this.clear();
    for (const line of lines) {
      this.insert(line);
    }
  }

  querySegment(start, end) {
    const x1 = Math.min(start.x, end.x);
    const x2 = Math.max(start.x, end.x);
    const z1 = Math.min(start.z, end.z);
    const z2 = Math.max(start.z, end.z);

    const ix0 = Math.floor(x1 / this.cellSize);
    const ix1 = Math.floor(x2 / this.cellSize);
    const iz0 = Math.floor(z1 / this.cellSize);
    const iz1 = Math.floor(z2 / this.cellSize);

    const set = Object.create(null);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = this._cellKey(ix, iz);
        const arr = this.cells[key];
        if (!arr) continue;
        for (const id of arr) set[id] = true;
      }
    }

    return Object.keys(set).map((s) => Number(s));
  }
}

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

  grow(grid = null) {
    if (!this.active) {
      return;
    }

    this.stepsSinceLastSplit++;
    this.stepsSinceLastTwist++;
    this.end.add(this.direction);

    const intersects = this.intersects(grid);
    if (intersects.length) {
      const end = getNode(intersects[0].point.clone());
      this.close(end);

      const other = lines[intersects[0].id];
      const closed = new Line(other.startNode, other.direction);
      closed.close(end);
      lines.push(closed);

      other.startNode = end;
      other.start.copy(intersects[0].point);

      return;
    }

    const l = this.end.distanceTo(this.start);
    if (
      this.stepsSinceLastSplit * dt > minDistance &&
      Math.random() > probability
    ) {
      this.split();
    }

    if (this.stepsSinceLastTwist * dt > minTwistDistance) {
      this.twist();
    }

    // if (this.end.length() > radius) {
    //   const node = getNode(this.end.clone());
    //   this.close(node);
    // }
  }

  intersects(grid = null) {
    const res = [];

    let candidateIds = null;
    if (grid) {
      candidateIds = grid.querySegment(this.start, this.end);
    }

    if (candidateIds && candidateIds.length) {
      const seen = Object.create(null);
      for (const id of candidateIds) {
        if (id === this.id) continue;
        if (seen[id]) continue;
        seen[id] = true;
        const line = lines[id];
        const i = getSegmentIntersection(
          this.start,
          this.end,
          line.start,
          line.end,
          false,
        );
        if (i) res.push({ id: line.id, point: i });
      }
    } else {
      for (const line of lines) {
        if (line.id !== this.id) {
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

    // if (Math.random() > 0.5) {
    //   const dir2 = this.direction
    //     .clone()
    //     .applyAxisAngle(up, angle * s + Math.PI);
    //   const line = new Line(this.startNode, dir2, old.id);
    //   lines.push(line);
    // }
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
  addBoundary();

  const id = getNode(new Vector3(x, 0, y));

  for (let i = 0; i < numLines; i++) {
    const line = new Line(id, getRandomDirection(), null);
    lines.push(line);
  }
}

function update(n = 1) {
  for (let i = 0; i < n; i++) {
    const grid = new SpatialGrid(0.5);
    grid.build(lines);

    for (const line of lines) {
      line.grow(grid);
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
    // wireframe: true,
    // opacity: 0.5,
    // transparent: true,
  });

  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;

  return mesh;
}

function offsetPolygon(points, distance) {
  const newPoints = [];
  const len = points.length;

  for (let i = 0; i < len; i++) {
    const prevIndex = (i - 1 + len) % len;
    const nextIndex = (i + 1) % len;

    const pPrev = points[prevIndex];
    const pCurr = points[i];
    const pNext = points[nextIndex];

    const v1 = { x: pCurr.x - pPrev.x, y: pCurr.y - pPrev.y };
    const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };

    const l1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y) || 0.00001;
    const l2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y) || 0.00001;

    const n1 = { x: v1.x / l1, y: v1.y / l1 };
    const n2 = { x: v2.x / l2, y: v2.y / l2 };

    const perp1 = { x: -n1.y, y: n1.x };
    const perp2 = { x: -n2.y, y: n2.x };

    const dot = n1.x * n2.x + n1.y * n2.y;

    if (dot > 0.99) {
      newPoints.push({
        x: pCurr.x + perp1.x * distance,
        y: pCurr.y + perp1.y * distance,
      });
      continue;
    }

    const tangent = { x: perp1.x + perp2.x, y: perp1.y + perp2.y };

    const q = 2 / (1 + dot);
    const miterScale = Math.sqrt(q);

    const limit = 3.0;
    const scale = miterScale > limit ? limit : miterScale;

    const tangentLen = Math.sqrt(tangent.x * tangent.x + tangent.y * tangent.y);

    newPoints.push({
      x: pCurr.x + (tangent.x / tangentLen) * (distance * scale),
      y: pCurr.y + (tangent.y / tangentLen) * (distance * scale),
    });
  }
  return newPoints;
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
        const points = path
          .map((id) => vertices.find((v) => v.id === id))
          .filter(Boolean);
        const area = calculateArea(points);

        if (area < -0.01) {
          // faces.push({
          //   id: `face-${Math.random().toString(36).substr(2, 9)}`,
          //   vertexIds: path,
          //   points,
          //   area: Math.abs(area),
          //   isOuter: false,
          //   //color: getRandomColor(),
          // });
          faces.push(createShape(offsetPolygon(points, -0.01)));
          // faces.push(createShape(points));
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
    const node = getNode(
      new Vector3(r * Math.cos(angle), 0, r * Math.sin(angle)),
    );
    const line = new Line(a, new Vector3());
    line.close(node);
    lines.push(line);
    a = node;
  }
  const line = new Line(a, new Vector3());
  line.close(origin);
  lines.push(line);
}

export { start, update, draw, reset, extractFaces, areActiveLines };
