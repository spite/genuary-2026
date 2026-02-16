import {
  Vector3,
  LineBasicMaterial,
  Line,
  Mesh,
  BoxGeometry,
  MeshNormalMaterial,
  BufferGeometry,
} from "three";
import {
  getColor,
  getAnglesOverCircle,
  getCoplanarSegmentIntersection,
} from "./utils.js";

const segmentMaterial = new LineBasicMaterial({ color: 0xffffff });

class Segment {
  constructor(a, b, parent) {
    this.id = crypto.randomUUID();
    this.parent = parent;

    this.a = a;
    this.b = b;
    this.from = parent.vertices[a];
    this.to = parent.vertices[b];
    const points = [this.from, this.to];
    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new LineBasicMaterial({ color: getColor() });
    this.line = new Line(geometry, material);
    this.line.frustumCulled = false;
  }

  splitAt(v) {
    this.b = v;
    this.to = this.parent.vertices[v];
    const p = this.line.geometry.attributes.position.array;
    p[3] = this.to.x;
    p[4] = this.to.y;
    p[5] = this.to.z;
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}

class Ray {
  constructor(a, dir, parent) {
    this.id = crypto.randomUUID();
    this.parent = parent;

    this.o = a;
    this.from = parent.vertices[a];
    this.to = this.from.clone();
    this.dir = dir.normalize();
    this.tmp = new Vector3();
    this.last = new Vector3();

    this.active = true;

    const points = [this.from, this.to];
    const geometry = new BufferGeometry().setFromPoints(points);
    this.line = new Line(geometry, segmentMaterial);
    this.line.frustumCulled = false;
  }

  update(dt) {
    if (!this.active) {
      return;
    }
    this.dir.setLength(dt);
    this.last.copy(this.to);
    this.to.add(this.dir);
  }

  draw() {
    const p = this.line.geometry.attributes.position.array;
    p[0] = this.from.x;
    p[1] = this.from.y;
    p[2] = this.from.z;
    p[3] = this.to.x;
    p[4] = this.to.y;
    p[5] = this.to.z;
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  stop() {
    this.active = false;
  }

  resetAt(v) {
    console.log(`Ray ${this.id} reset `);
    this.o = v;
    this.from = this.parent.vertices[v];
    this.to.copy(this.from);
    this.last.copy(this.to);
  }

  dispose() {
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}

const dotMesh = new Mesh(
  new BoxGeometry(0.1, 0.1, 0.1),
  new MeshNormalMaterial(),
);

const up = new Vector3(0, 0, 1);

class Graph {
  constructor() {
    this.vertices = [];
    this.segments = [];
    this.rays = [];

    this.vertexMap = new Map();
  }

  addBoundary(vertices, segments) {
    // this should genrate the new vertex ids, but we assume it's called at the very beginning
    for (const vertex of vertices) {
      this.addVertex(vertex);
    }
    for (const segment of segments) {
      this.addSegment(new Segment(segment[0], segment[1], this));
    }
  }

  start(x, y, lines) {
    const vId = this.addVertex(new Vector3(x, y, 0));
    const angles = getAnglesOverCircle(lines);
    for (let i = 0; i < lines; i++) {
      const a = angles[i];
      const dir = new Vector3(Math.cos(a), Math.sin(a), 0).normalize();
      this.addRay(new Ray(vId, dir, this));
    }
  }

  reset() {}

  update(dt = 0.1) {
    for (const ray of this.rays) {
      ray.update(dt);
      this.checkRay(ray);
      this.splitRay(ray);
    }
    for (let i = this.rays.length - 1; i >= 0; i--) {
      if (!this.rays[i].active) {
        this.removeRay(this.rays[i]);
      }
    }
  }

  splitRay(r) {
    if (!r.active) {
      return;
    }
    if (Math.random() > 0.99) {
      const vId = this.addVertex(r.to);

      const s = new Segment(r.o, vId, this);
      this.addSegment(s);

      const range = (0.9 * Maf.PI) / 2;
      const a = Maf.randomInRange(Maf.PI / 2 - range, Maf.PI / 2 + range);
      const dir = r.dir.clone().applyAxisAngle(up, a);
      const splitRay = new Ray(vId, dir, this);
      this.addRay(splitRay);

      r.resetAt(vId);

      if (Math.random() > 0.5) {
        const dir = r.dir.clone().applyAxisAngle(up, a + Maf.PI);
        const splitRay = new Ray(vId, dir, this);
        this.addRay(splitRay);
      }
    }
  }

  checkRay(r) {
    if (!r.active) {
      return;
    }

    const closest = {
      distance: Number.MAX_SAFE_INTEGER,
      point: null,
      ray: null,
      segment: null,
    };

    for (let segment of this.segments) {
      if (r === segment || r.o === segment.a || r.o === segment.b) {
        continue;
      }
      const res = getCoplanarSegmentIntersection(
        r.from,
        r.to,
        segment.from,
        segment.to,
      );
      if (res) {
        if (res.distance < closest.distance) {
          closest.distance = res.distance;
          closest.point = res.point;
          closest.segment = segment;
          closest.ray = null;
        }
      }
    }

    for (let ray of this.rays) {
      if (r === ray || r.o === ray.o || !ray.active) {
        continue;
      }
      const res = getCoplanarSegmentIntersection(
        r.from,
        r.to,
        ray.from,
        ray.to,
      );
      if (res) {
        if (res.distance < closest.distance) {
          closest.distance = res.distance;
          closest.point = res.point;
          closest.segment = null;
          closest.ray = ray;
        }
      }
    }

    if (closest.point) {
      if (closest.segment) {
        console.log(
          `Ray ${r.id} intersects segments ${closest.segment.id} at ${closest.distance} distance.`,
        );
        r.stop();
        const vId = this.addVertex(closest.point);
        const s = new Segment(r.o, vId, this);
        this.addSegment(s);

        const splitSegment = new Segment(vId, closest.segment.b, this);
        this.addSegment(splitSegment);

        closest.segment.splitAt(vId);
      }
      if (closest.ray) {
        console.log(
          `Ray ${r.id} intersects ray ${closest.ray.id} at ${closest.distance} distance.`,
        );
        r.stop();
        const vId = this.addVertex(closest.point);
        const s = new Segment(r.o, vId, this);
        this.addSegment(s);

        const raySegment = new Segment(closest.ray.o, vId, this);
        this.addSegment(raySegment);

        closest.ray.resetAt(vId);
      }
    }
  }

  addVertex(v) {
    const vertex = v.clone();
    this.vertices.push(vertex);
    const d = dotMesh.clone();
    d.position.copy(vertex);
    this.vertexMap.set(vertex, d);
    return this.vertices.length - 1;
  }

  addRay(ray) {
    this.rays.push(ray);
    console.log(`Added ray ${ray.id}`);
  }

  addSegment(segment) {
    this.segments.push(segment);
    console.log(`Added segment ${segment.id}`);
  }

  removeRay(r) {
    const index = this.rays.findIndex((ray) => r.id === ray.id);

    if (index > -1) {
      this.rays.splice(index, 1);
      console.log(`Removed ray ${r.id}`);
    } else {
      debugger;
    }
  }

  draw() {
    const segments = [];
    for (const segment of this.segments) {
      segments.push(segment.line);
    }
    const rays = [];
    for (const ray of this.rays) {
      ray.draw();
      rays.push(ray.line);
    }
    const vertices = [];
    for (const vertex of this.vertices) {
      vertices.push(this.vertexMap.get(vertex));
    }
    return { segments, rays, vertices };
  }

  dispose() {
    for (const segment of this.segments) {
      segment.dispose();
    }
    for (const ray of this.rays) {
      ray.dispose();
    }
    for (const dot of this.vertexMap.values()) {
      dot.geometry.dispose();
      dot.material.dispose();
    }
  }
}

export { Graph };
