import {
  Vector2,
  Vector3,
  LineBasicMaterial,
  Line as LineMesh,
  BufferGeometry,
  ArrowHelper,
  Group,
} from "three";

const lines = [];

const nodes = [];
const edges = [];

const dt = 0.01;

function getNode(p) {
  const id = nodes.length;
  nodes.push(p);
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
  constructor(startNode, direction, parent = null) {
    this.id = lines.length;
    this.startNode = startNode;
    this.endNode = null;
    this.start = new Vector3().copy(nodes[this.startNode]);
    this.end = this.start.clone();
    this.direction = direction;
    this.direction.normalize().multiplyScalar(dt);
    this.active = true;
    this.parent = parent;
    this.color = (Math.random() * 0xffffff) | 0;
  }

  grow() {
    if (!this.active) {
      return;
    }

    this.end.add(this.direction);

    const intersects = this.intersects();
    if (intersects.length) {
      const end = getNode(intersects[0].clone());
      this.close(end);
      return;
    }

    const l = this.end.distanceTo(this.start);
    if (l > 2 && Math.random() > 0.9) {
      this.split();
    }

    if (this.end.length() > 10) {
      const node = getNode(this.end.clone());
      this.close(node);
    }
  }

  intersects() {
    const res = [];
    for (const line of lines) {
      if (
        line.id !== this.id &&
        line.parent !== this.id &&
        this.parent !== line.id &&
        line.parent !== this.parent
      ) {
        const i = getSegmentIntersection(
          this.start,
          this.end,
          line.start,
          line.end,
          false,
        );
        if (i) {
          res.push(i);
        }
      }
    }
    res.sort(
      (a, b) =>
        this.start.distanceToSquared(a) - this.start.distanceToSquared(b),
    );
    if (res.length > 1) {
      debugger;
    }
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

  split() {
    const newStart = getNode(this.end.clone());

    const old = new Line(this.startNode, this.direction.clone(), this.parent);
    old.close(newStart);
    lines.push(old);

    this.parent = old.id;
    this.restart(newStart);

    const s = Math.random() > 0.5 ? 1 : -1;
    const dir = this.direction
      .clone()
      .applyAxisAngle(up, (s * Math.PI) / 2 + Maf.randomInRange(-1, 1));
    const line = new Line(this.startNode, dir, old.id);
    lines.push(line);
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

function update() {
  for (const line of lines) {
    line.grow();
  }
  console.log(lines.length);
}

const material = new LineBasicMaterial({ color: 0x000000 });

function draw() {
  const active = lines.some((l) => l.active);
  if (!active) {
    return [];
  }
  const res = [];
  for (const line of lines) {
    const points = line.getPoints();
    // points[0].lerp(points[1], 0.01);
    // points[1].lerp(points[0], 0.01);
    // const geometry = new BufferGeometry().setFromPoints(points);
    // const l = new LineMesh(geometry, material);
    // l.frustumCulled = false;
    // res.push(l);
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
  }
  return res;
}

export { start, update, draw };
