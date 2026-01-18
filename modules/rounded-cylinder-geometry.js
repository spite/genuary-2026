import { Path, LatheGeometry } from "three";

function RoundedCylinderGeometry(
  radius = 1,
  height = 1,
  bevelRadius = 0.1,
  bevelSegments = 3,
  radialSegments = 32,
  heightSegments = 1
) {
  const finalRadius = radius;
  const finalHeight = height;
  const halfHeight = finalHeight / 2;
  const straightRadius = finalRadius - bevelRadius;
  const straightHeight = halfHeight - bevelRadius;

  if (bevelRadius > finalRadius || bevelRadius > halfHeight) {
    console.warn("RoundedCylinderGeometry: Bevel is too large for dimensions.");
    return new LatheGeometry();
  }

  const path = new Path();

  path.moveTo(0, halfHeight);

  path.lineTo(straightRadius, halfHeight);

  path.absarc(
    straightRadius,
    straightHeight,
    bevelRadius,
    Math.PI / 2,
    0,
    true
  );

  const segmentSize = (straightHeight * 2) / Math.max(1, heightSegments);
  for (let i = 1; i <= heightSegments; i++) {
    const y = straightHeight - i * segmentSize;
    path.lineTo(finalRadius, y);
  }

  path.absarc(
    straightRadius,
    -straightHeight,
    bevelRadius,
    0,
    -Math.PI / 2,
    true
  );

  path.lineTo(0, -halfHeight);

  const points = path.getPoints(bevelSegments * 4).reverse();

  const geometry = new LatheGeometry(points, radialSegments);

  return geometry;
}

export { RoundedCylinderGeometry };
