import { Vector3 } from "three";

class PolygonInset {
  /**
   * Robust polygon deflation via edge offsetting.
   * 1. Move each edge inward by `offset` along its normal
   * 2. Intersect consecutive offset edges to find new vertices
   * 3. Resolve any self-intersections caused by narrow regions
   */
  static shrink(vertices, offset, miterLimit = 4.0) {
    if (vertices.length < 3) return null;

    const poly = vertices.map((v) => v.clone());

    const area = this.signedArea(poly);
    if (Math.abs(area) < 1e-8) return null;

    // Normalize to CCW
    const ccw = area > 0;
    if (!ccw) poly.reverse();

    const n = poly.length;

    // Step 1: Compute offset edges (each edge moved inward by offset)
    const offsetEdges = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = poly[j].x - poly[i].x;
      const dy = poly[j].y - poly[i].y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) {
        offsetEdges.push(null);
        continue;
      }
      // Inward normal for CCW polygon: (-dy, dx) normalized, scaled by offset
      const nx = (-dy / len) * offset;
      const ny = (dx / len) * offset;
      offsetEdges.push({
        p1: new Vector3(poly[i].x + nx, poly[i].y + ny, 0),
        p2: new Vector3(poly[j].x + nx, poly[j].y + ny, 0),
      });
    }

    // Step 2: Intersect consecutive offset edges to get new vertices
    const raw = [];
    for (let i = 0; i < n; i++) {
      const curr = offsetEdges[i];
      const next = offsetEdges[(i + 1) % n];

      if (!curr || !next) {
        // Degenerate edge — use the offset edge endpoint as fallback
        if (curr) raw.push(curr.p2.clone());
        else if (next) raw.push(next.p1.clone());
        continue;
      }

      const pt = this.lineIntersection(curr.p1, curr.p2, next.p1, next.p2);
      if (pt) {
        // Miter limit: if the new point is too far from the original vertex,
        // replace with a bevel (two points along the offset edges)
        const orig = poly[(i + 1) % n];
        const dist = Math.hypot(pt.x - orig.x, pt.y - orig.y);
        if (dist > offset * miterLimit) {
          raw.push(curr.p2.clone());
          raw.push(next.p1.clone());
        } else {
          raw.push(pt);
        }
      } else {
        // Parallel consecutive edges — use midpoint
        raw.push(
          new Vector3(
            (curr.p2.x + next.p1.x) / 2,
            (curr.p2.y + next.p1.y) / 2,
            0,
          ),
        );
      }
    }

    if (raw.length < 3) return null;

    // Step 3: Resolve self-intersections
    let result = this.resolveSelfIntersections(raw);
    if (!result || result.length < 3) return null;

    // Step 4: Validate winding and size
    const absOrigArea = Math.abs(area);
    const newArea = this.signedArea(result);
    if (newArea <= 0 || newArea >= absOrigArea) {
      console.warn(
        `Polygon invalid after deflate ` +
          `(area: ${absOrigArea.toFixed(4)} → ${newArea.toFixed(4)}, ` +
          `${n} verts). Discarding.`,
      );
      return null;
    }

    // Step 5: Clamp any escaped points back onto the nearest edge
    for (let i = 0; i < result.length; i++) {
      if (!this.pointInPolygon(result[i], poly)) {
        result[i] = this.closestPointOnPolygon(result[i], poly);
      }
    }

    if (!ccw) result.reverse();
    return result;
  }

  /**
   * Intersect two infinite lines (p1→p2) and (p3→p4).
   */
  static lineIntersection(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    return new Vector3(p1.x + t * d1x, p1.y + t * d1y, 0);
  }

  /**
   * Intersect two finite segments. Returns point or null.
   */
  static segmentIntersection(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

    const eps = 1e-6;
    if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
      return new Vector3(p1.x + t * d1x, p1.y + t * d1y, 0);
    }
    return null;
  }

  /**
   * Iteratively find and remove self-intersection loops.
   * At each crossing, two sub-loops are formed. The inverted one
   * (negative signed area) is discarded.
   */
  static resolveSelfIntersections(poly) {
    let pts = [...poly];

    for (let iter = 0; iter < pts.length * 2; iter++) {
      const n = pts.length;
      if (n < 3) return null;

      let found = false;

      for (let i = 0; i < n && !found; i++) {
        const i2 = (i + 1) % n;
        for (let j = i + 2; j < n && !found; j++) {
          const j2 = (j + 1) % n;
          if (j2 === i) continue;

          const pt = this.segmentIntersection(pts[i], pts[i2], pts[j], pts[j2]);
          if (!pt) continue;

          // Build two sub-loops from the crossing
          // Loop A: pt → pts[i+1] → ... → pts[j] → pt
          const loopA = [pt.clone()];
          for (let k = i + 1; k <= j; k++) loopA.push(pts[k]);

          // Loop B: pt → pts[j+1] → ... → pts[i] → pt  (wraps around)
          const loopB = [pt.clone()];
          for (let k = j + 1; k < n; k++) loopB.push(pts[k]);
          for (let k = 0; k <= i; k++) loopB.push(pts[k]);

          const areaA = this.signedArea(loopA);
          const areaB = this.signedArea(loopB);

          // Keep the sub-loop with positive area (correct CCW winding).
          // If both positive, keep the larger one.
          if (areaA > 0 && areaB > 0) {
            pts = areaA >= areaB ? loopA : loopB;
          } else if (areaA > 0) {
            pts = loopA;
          } else if (areaB > 0) {
            pts = loopB;
          } else {
            return null;
          }

          found = true;
        }
      }

      if (!found) break;
    }

    return pts;
  }

  /**
   * Project a point onto the nearest edge of the polygon.
   */
  static closestPointOnPolygon(pt, poly) {
    let bestDist = Infinity;
    let best = null;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const a = poly[i];
      const b = poly[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      const d = (pt.x - px) * (pt.x - px) + (pt.y - py) * (pt.y - py);
      if (d < bestDist) {
        bestDist = d;
        best = new Vector3(px, py, 0);
      }
    }
    return best;
  }

  /**
   * Ray-casting point-in-polygon test.
   */
  static pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      if (
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  static signedArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return area / 2;
  }
}

export { PolygonInset };
