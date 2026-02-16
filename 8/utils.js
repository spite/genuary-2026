import { Vector2, Vector3, ShapeUtils, Color } from "three";

function getColor() {
  const color = new Color();

  const hue = Math.random();
  const saturation = 1.0;
  const lightness = 0.5;

  color.setHSL(hue, saturation, lightness);
  return color;
}

function getAnglesOverCircle(n) {
  const angles = [];
  const step = (Math.PI * 2) / n;

  for (let i = 0; i < n; i++) {
    const start = i * step;
    const angle = start + Math.random() * step;
    angles.push(angle);
  }

  return angles;
}

const getSegmentSegmentIntersection = (() => {
  // Reuse these variables to avoid Garbage Collection
  const _u = new Vector3();
  const _v = new Vector3();
  const _w = new Vector3();
  const _p1 = new Vector3(); // Result point on seg 1
  const _p2 = new Vector3(); // Result point on seg 2

  return function (start1, end1, start2, end2, threshold = 1e-4) {
    // Algorithm based on finding the shortest distance between two skew lines
    _u.subVectors(end1, start1);
    _v.subVectors(end2, start2);
    _w.subVectors(start1, start2);

    const a = _u.dot(_u); // squared length of seg1
    const b = _u.dot(_v);
    const c = _v.dot(_v); // squared length of seg2
    const d = _u.dot(_w);
    const e = _v.dot(_w);
    const D = a * c - b * b; // denominator

    let sc, tc; // sc = s parameter (seg1), tc = t parameter (seg2)

    // Compute the line parameters of the two closest points
    if (D < 1e-8) {
      // The lines are almost parallel
      sc = 0.0;
      tc = b > c ? d / b : e / c; // use the largest denominator
    } else {
      sc = (b * e - c * d) / D;
      tc = (a * e - b * d) / D;
    }

    // Clamp sc to segment 1 [0, 1]
    // If we clamp s, we must re-calculate t to find the closest point on seg 2 given the new s
    if (sc < 0.0) {
      sc = 0.0;
      tc = e / c;
    } else if (sc > 1.0) {
      sc = 1.0;
      tc = (e + b) / c;
    }

    // Clamp tc to segment 2 [0, 1]
    if (tc < 0.0) {
      tc = 0.0;
      // re-calculate sc?
      // usually strictly sufficient to just clamp here for intersection checks
      if (-d < 0) sc = 0.0;
      else if (-d > a) sc = 1.0;
      else sc = -d / a;
    } else if (tc > 1.0) {
      tc = 1.0;
      if (-d + b < 0) sc = 0;
      else if (-d + b > a) sc = 1;
      else sc = (-d + b) / a;
    }

    // Compute actual points
    _p1.copy(_u).multiplyScalar(sc).add(start1);
    _p2.copy(_v).multiplyScalar(tc).add(start2);

    // Calculate squared distance
    const distSq = _p1.distanceToSquared(_p2);

    // Check intersection
    if (distSq !== 0 && distSq < threshold * threshold) {
      // It's a hit. Return the midpoint or just p1
      return {
        distance: distSq,
        point: _p1.clone(),
      }; // Return a clone so the user owns the point
    }

    return null; // No intersection
  };
})();

function createPolygonSampler(vertices, segments) {
  // --- Step 1: Order the segments into a consecutive path ---
  // We need a list of vertex indices in order: [0, 1, 2, 3...]
  const orderedIndices = orderSegments(segments);

  // --- Step 2: Project 3D points to 2D for Triangulation ---
  // We assume the polygon is roughly planar. We drop the axis with the least variance.
  const points2D = [];
  const axis = findDominantAxis(vertices, orderedIndices);

  orderedIndices.forEach((idx) => {
    const v = vertices[idx];
    // If mainly flat on Y (ground), we use X and Z
    if (axis === "y") points2D.push(new Vector2(v.x, v.z));
    else if (axis === "x") points2D.push(new Vector2(v.y, v.z));
    else points2D.push(new Vector2(v.x, v.y));
  });

  // --- Step 3: Triangulate ---
  // Returns array of indices [ [i1, i2, i3], [i1, i3, i4]... ] relative to points2D
  const trianglesIndices = ShapeUtils.triangulateShape(points2D, []);

  // --- Step 4: Calculate Areas & Prepare Weighted List ---
  const triangles = [];
  let totalArea = 0;

  trianglesIndices.forEach((tri) => {
    // Get the actual 3D vertices for this triangle
    const a = vertices[orderedIndices[tri[0]]];
    const b = vertices[orderedIndices[tri[1]]];
    const c = vertices[orderedIndices[tri[2]]];

    // Calculate area of this triangle (half the length of the cross product)
    const _v1 = new Vector3().subVectors(b, a);
    const _v2 = new Vector3().subVectors(c, a);
    const area = _v1.cross(_v2).length() * 0.5;

    totalArea += area;

    triangles.push({
      a,
      b,
      c,
      cumulativeArea: totalArea, // Used for weighted random selection
    });
  });

  // --- Step 5: The Sampling Function ---
  return function getRandomPoint() {
    // 1. Pick a triangle based on area size
    const r = Math.random() * totalArea;

    // Binary search is faster, but linear is fine for <100 triangles
    const selectedTri =
      triangles.find((t) => r <= t.cumulativeArea) ||
      triangles[triangles.length - 1];

    // 2. Select a random point INSIDE that triangle
    // Formula: P = (1 - sqrt(r1)) * A + (sqrt(r1) * (1 - r2)) * B + (sqrt(r1) * r2) * C
    const r1 = Math.random();
    const r2 = Math.random();
    const sqrtR1 = Math.sqrt(r1);

    const wA = 1 - sqrtR1;
    const wB = sqrtR1 * (1 - r2);
    const wC = sqrtR1 * r2;

    const point = new Vector3();
    point.addScaledVector(selectedTri.a, wA);
    point.addScaledVector(selectedTri.b, wB);
    point.addScaledVector(selectedTri.c, wC);

    return point;
  };
}

// --- Helpers ---

// Sorts unordered segments [[0,1], [4,2], [1,4]...] into a loop [0, 1, 4, 2...]
function orderSegments(segments) {
  // Build adjacency map
  const map = {};
  segments.forEach(([start, end]) => {
    map[start] = end;
  });

  const path = [];
  let current = segments[0][0]; // Start at the first point of the first segment

  // Walk the map
  for (let i = 0; i < segments.length; i++) {
    path.push(current);
    current = map[current];
    if (current === undefined)
      throw new Error("Segments do not form a closed loop");
  }
  return path;
}

// Determines if the polygon is facing Up (Y), Sideways (X), or Forward (Z)
function findDominantAxis(vertices, indices) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);

  indices.forEach((idx) => {
    min.min(vertices[idx]);
    max.max(vertices[idx]);
  });

  const size = new Vector3().subVectors(max, min);
  if (size.y < size.x && size.y < size.z) return "y"; // Flat on ground
  if (size.x < size.y && size.x < size.z) return "x"; // Flat on wall
  return "z";
}

export {
  getColor,
  getAnglesOverCircle,
  getSegmentSegmentIntersection,
  createPolygonSampler,
};
