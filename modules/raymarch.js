import { Vector3, Vector2 } from "three";

const EPSILON = 0.001;
const MAXSTEPS = 100;
const MAXDIST = 100;
const tmp = new Vector3();
const tmp2 = new Vector2();

Vector3.prototype.abs = function () {
  return new Vector3(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z));
};

Vector3.prototype.max = function (v) {
  return new Vector3(
    Math.max(this.x, v.x),
    Math.max(this.y, v.y),
    Math.max(this.z, v.z)
  );
};

const zero = new Vector3(0, 0, 0);

function sdRoundBox(p, b, r) {
  const q = p.clone().abs().sub(b);
  const l =
    q.max(zero).length() + Math.min(Math.max(q.x, Math.max(q.y, q.z)), 0.0) - r;

  return l;
}

function sdSphere(p, r) {
  return p.length() - r;
}

function sdRoundedCylinder(p, ra, rb, h) {
  const l = tmp2.set(p.x, p.z).length();
  tmp2.set(l - ra + rb, Math.abs(p.y) - h + rb);

  return (
    Math.min(Math.max(tmp2.x, tmp2.y), 0.0) +
    new Vector2(Math.max(tmp2.x, 0.0), Math.max(tmp2.y, 0.0)).length() -
    rb
  );
}

function sdCappedCylinder(p, r, h) {
  const l = Math.sqrt(p.x * p.x + p.z * p.z);
  tmp.set(Math.abs(l) - r, Math.abs(p.y) - h);
  return Math.min(Math.max(tmp.x, tmp.y), 0.0) + tmp.max(zero).length();
}

function sdTorus(p, t) {
  const q = new Vector2(new Vector2(p.x, p.z).length() - t.x, p.y);
  return q.length() - t.y;
}

class Util {
  constructor(p, r, e) {
    this.p = p;
    this.d = 0;
    this.r = r;
    this.e = e;

    const PI = Math.PI;
    const PHI = 1.618033988749895;
    const TAU = 2 * Math.PI;
    this.Vector3 = new Vector3(1, 1, 1).normalize();
    this.Vector4 = new Vector3(-1, 1, 1).normalize();
    this.Vector5 = new Vector3(1, -1, 1).normalize();
    this.Vector6 = new Vector3(1, 1, -1).normalize();
    this.Vector7 = new Vector3(0, 1, PHI + 1).normalize();
    this.Vector8 = new Vector3(0, -1, PHI + 1).normalize();
    this.Vector9 = new Vector3(PHI + 1, 0, 1).normalize();
    this.Vector10 = new Vector3(-PHI - 1, 0, 1).normalize();
    this.Vector11 = new Vector3(1, PHI + 1, 0).normalize();
    this.Vector12 = new Vector3(-1, PHI + 1, 0).normalize();
    this.Vector13 = new Vector3(0, PHI, 1).normalize();
    this.Vector14 = new Vector3(0, -PHI, 1).normalize();
    this.Vector15 = new Vector3(1, 0, PHI).normalize();
    this.Vector16 = new Vector3(-1, 0, PHI).normalize();
    this.Vector17 = new Vector3(PHI, 1, 0).normalize();
    this.Vector18 = new Vector3(-PHI, 1, 0).normalize();
  }

  begin() {
    this.d = 0;
  }

  add(v) {
    if (this.e) {
      this.d += Math.pow(Math.abs(this.p.dot(v)), this.e);
    } else {
      this.d = Math.max(this.d, Math.abs(this.p.dot(v)));
    }
  }

  end() {
    if (this.e) {
      return Math.pow(this.d, 1 / this.e) - this.r;
    } else {
      return this.d - this.r;
    }
  }
}

function clamp(v, minVal, maxVal) {
  return Math.min(maxVal, Math.max(minVal, v));
}

function sdOctahedron(p, s) {
  p = p.abs();
  const m = p.x + p.y + p.z - s;
  const q = new Vector3();
  if (3.0 * p.x < m) q.set(p.x, p.y, p.z);
  else if (3.0 * p.y < m) q.set(p.y, p.z, p.x);
  else if (3.0 * p.z < m) q.set(p.z, p.x, p.y);
  else return m * 0.57735027;

  const k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
  return new Vector3(q.x, q.y - s + k, q.z - k).length();
}

function opRound(d, rad) {
  return d - rad;
}

function sdIcosahedron(p, r, e) {
  const u = new Util(p, r, e);
  u.begin();
  u.add(u.Vector3);
  u.add(u.Vector4);
  u.add(u.Vector5);
  u.add(u.Vector6);
  u.add(u.Vector7);
  u.add(u.Vector8);
  u.add(u.Vector9);
  u.add(u.Vector10);
  u.add(u.Vector11);
  u.add(u.Vector12);
  return u.end();
}

function sdDodecahedron(p, r, e) {
  const u = new Util(p, r, e);
  u.begin();
  u.add(u.Vector13);
  u.add(u.Vector14);
  u.add(u.Vector15);
  u.add(u.Vector16);
  u.add(u.Vector17);
  u.add(u.Vector18);
  return u.end();
}

function march(ro, rd, map, d = EPSILON) {
  let t = 0.0;
  for (let i = 0; i < MAXSTEPS; ++i) {
    tmp.copy(rd).multiplyScalar(d).add(ro);
    t = map(tmp);
    if (t < EPSILON || d >= MAXDIST) break;
    d += t;
  }
  return d;
}

const getNormal = (function () {
  const tmp = new Vector3();
  const normal = new Vector3();

  function fn(p, map) {
    const eps = 0.0001;

    tmp.copy(p).setX(p.x + eps);
    const valX1 = map(tmp);
    tmp.copy(p).setX(p.x - eps);
    const valX2 = map(tmp);

    tmp.copy(p).setY(p.y + eps);
    const valY1 = map(tmp);
    tmp.copy(p).setY(p.y - eps);
    const valY2 = map(tmp);

    tmp.copy(p).setZ(p.z + eps);
    const valZ1 = map(tmp);
    tmp.copy(p).setZ(p.z - eps);
    const valZ2 = map(tmp);

    return normal
      .set(valX1 - valX2, valY1 - valY2, valZ1 - valZ2)
      .normalize()
      .clone();
  }

  return fn;
})();

function getClosestPoint(p, map, offset = 0, iterations = 1) {
  let currentPos = p.clone();

  for (let i = 0; i < iterations; i++) {
    const dist = map(currentPos) + offset;

    if (Math.abs(dist) < 0.0001) break;

    const normal = getNormal(currentPos, map);

    const step = normal.multiplyScalar(dist);
    currentPos.sub(step);
  }

  return currentPos;
}

export {
  march,
  getNormal,
  getClosestPoint,
  sdSphere,
  opRound,
  sdRoundBox,
  sdTorus,
  sdRoundedCylinder,
  sdOctahedron,
  sdIcosahedron,
  sdDodecahedron,
  sdCappedCylinder,
};
