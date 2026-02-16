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

// Gemini did these:

function getCoplanarSegmentIntersection(
  start1,
  end1,
  start2,
  end2,
  includeEndPoints = true,
) {
  const EPSILON = 1e-6;

  // Calculate the direction vectors
  // Ray A: P + t * r
  // Ray B: Q + u * s

  // r = end1 - start1
  const rx = end1.x - start1.x;
  const ry = end1.y - start1.y;

  // s = end2 - start2
  const sx = end2.x - start2.x;
  const sy = end2.y - start2.y;

  // Cross product of r and s (2D analog: rx * sy - ry * sx)
  // This tells us if the lines are parallel.
  const rxs = rx * sy - ry * sx;

  // Q - P (vector from start1 to start2)
  const qpx = start2.x - start1.x;
  const qpy = start2.y - start1.y;

  // If rxs is zero, lines are parallel
  if (Math.abs(rxs) < EPSILON) {
    // Optional: Check for Collinear Overlap here if needed.
    // For standard point intersection, parallel lines (even overlapping)
    // usually result in null because the intersection is a segment, not a point.
    return null;
  }

  // Solve for t and u
  // t = (q - p) x s / (r x s)
  const qpxs = qpx * sy - qpy * sx;
  const t = qpxs / rxs;

  // u = (q - p) x r / (r x s)
  const qpxr = qpx * ry - qpy * rx;
  const u = qpxr / rxs;

  // Check if t and u are within the segment bounds [0, 1]
  // We use EPSILON to handle floating point errors at the exact endpoints
  const lower = includeEndPoints ? -EPSILON : EPSILON;
  const upper = includeEndPoints ? 1 + EPSILON : 1 - EPSILON;

  if (t >= lower && t <= upper && u >= lower && u <= upper) {
    // We have an intersection.
    // Point = start1 + t * r
    return {
      distance: t,
      point: new Vector3(start1.x + t * rx, start1.y + t * ry, 0),
    };
  }

  return null;
}

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
  getCoplanarSegmentIntersection,
  createPolygonSampler,
};
