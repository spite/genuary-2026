import { BoxGeometry, Vector3 } from "three";

function createNormalizedCubeSphere(radius, segments) {
  const geometry = new BoxGeometry(1, 1, 1, segments, segments, segments);

  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  const vertex = new Vector3();

  for (let i = 0; i < positions.count; i++) {
    let x = positions.getX(i) * 2;
    let y = positions.getY(i) * 2;
    let z = positions.getZ(i) * 2;

    const x2 = x * x;
    const y2 = y * y;
    const z2 = z * z;

    const newX = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
    const newY = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
    const newZ = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);

    vertex.set(newX, newY, newZ);

    const u = Math.atan2(vertex.x, vertex.z) / (2 * Math.PI) + 0.5;
    const v = Math.asin(vertex.y) / Math.PI + 0.5;

    uvs.setXY(i, u, v);

    vertex.multiplyScalar(radius);
    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

export { createNormalizedCubeSphere };
