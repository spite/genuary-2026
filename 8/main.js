import {
  fromDefaults,
  renderer,
  camera,
  controls,
  render,
  running,
  clock,
} from "common";
import GUI from "gui";
import {
  Scene,
  Mesh,
  Color,
  Vector3,
  Group,
  Shape,
  ShapeGeometry,
  ExtrudeGeometry,
  MeshStandardMaterial,
  HemisphereLight,
  DirectionalLight,
  PCFSoftShadowMap,
  BufferAttribute,
} from "three";
import { mergeGeometries } from "third_party/BufferGeometryUtils.js";
import { Graph } from "./graph.js";
import { effectRAF } from "reactive";
import { createPolygonSampler, getColor } from "./utils.js";
import { GraphRegionExtractor } from "./extractor.js";
import { PolygonInset } from "./shrink.js";
import { Easings } from "easings";

const rainbow = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
];

const defaults = {
  seed: 1337,
  boundarySides: 20,
  seeds: 3,
  linesPerSeed: 5,
  minDistance: 1.68,
  minTwistDistance: 2,
  angle: [1.42, 1.66],
  probability: 0.13,
  splitDirection: "random",
  noiseScale: 1,
  noiseRotation: 0.2,
  offset: 0.05,
  greenness: 0.2,
  showLines: true,
  showFaces: !true,
};

const params = fromDefaults(defaults);

const gui = new GUI(
  "8. A City. Create a generative metropolis.",
  document.querySelector("#gui-container"),
);
gui.addSlider("Boundary sides", params.boundarySides, 3, 20, 1);
gui.addSlider("Seeds", params.seeds, 1, 5, 1);
gui.addSlider("Lines per seed", params.linesPerSeed, 1, 10, 1);
gui.addSlider("Min. split distance", params.minDistance, 0.1, 2, 0.01);
gui.addSlider("Min. twist distance", params.minTwistDistance, 0.1, 2, 0.01);
gui.addRangeSlider("Split angle range", params.angle, 0, Math.PI, 0.01);
gui.addSlider("Split probability", params.probability, 0, 1, 0.001);
gui.addSelect("Split direction", params.splitDirection, [
  ["random", "Random"],
  ["clockwise", "Clockwise"],
  ["counterclockwise", "Counterclockwise"],
  ["both", "Both"],
]);
gui.addSlider("Offset", params.offset, 0, 0.3, 0.001);
gui.addSlider("Noise scale", params.noiseScale, 0, 10, 0.001);
gui.addSlider("Noise rotation", params.noiseRotation, 0, 1, 0.01);
gui.addSlider("Greenness", params.greenness, 0, 1, 0.001);
gui.addCheckbox("Show lines", params.showLines, (e) => {
  groupLines.visible = e;
});
gui.addCheckbox(
  "Show faces",
  params.showFaces,
  (e) => (groupFaces.visible = e),
);
gui.addButton("Random", randomize);
gui.addSeparator();
gui.addText(
  "<p>Press R to shuffle the objects.</p><p>Press Space to toggle rotation.</p><p>Press Tab to toggle this GUI.</p>",
);
gui.show();

const color = 0; //rainbow[rainbow.length - 1];
renderer.setClearColor(new Color(color));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
const group = new Group();
const groupFaces = new Group();
groupFaces.visible = params.showFaces();
const groupLines = new Group();
groupLines.visible = params.showLines();
const groupCity = new Group();
group.add(groupFaces);
group.add(groupLines);
scene.add(groupCity);
scene.add(group);
group.rotation.x = -Math.PI / 2;
groupCity.rotation.x = -Math.PI / 2;

const light = new DirectionalLight(0xffffff, 3);
light.position.set(15, 15, 30);
light.castShadow = true;
light.shadow.camera.top = 16;
light.shadow.camera.bottom = -16;
light.shadow.camera.right = 16;
light.shadow.camera.left = -16;
light.shadow.camera.near = 0.1;
light.shadow.camera.far = 80;
light.shadow.mapSize.set(4096, 4096);
light.shadow.camera.updateProjectionMatrix();
scene.add(light);

const hemiLight = new HemisphereLight(0xffffff, 0xffffff, 2);
hemiLight.color.setHSL(0.6, 1, 0.6);
hemiLight.groundColor.setHSL(0.095, 1, 0.75);
hemiLight.position.set(0, 50, 0);
scene.add(hemiLight);

camera.position.set(1, 1, 1).multiplyScalar(20);
camera.lookAt(0, 0, 0);
camera.near = 0.1;
camera.far = 200;
camera.updateProjectionMatrix();

let graph;
let faceMeshes = [];
let merged = false;

function init() {
  const vertices = [];
  const segments = [];
  const r = 10;
  const steps = params.boundarySides();
  for (let i = 0; i < steps; i++) {
    const a = Maf.map(0, steps, 0, Maf.TAU, i);
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    vertices.push(new Vector3(x, y, 0));
    segments.push([i, (i + 1) % steps]);
  }
  graph.addBoundary(vertices, segments);
  const sampler = createPolygonSampler(vertices, segments);
  for (let i = 0; i < params.seeds(); i++) {
    const r = 5;
    const p = sampler();
    graph.start(p.x, p.y, params.linesPerSeed());
  }
}

let subGraphs = [];
let linesOpacity = 0;
let linesTargetOpacity = 1;

const SUBDIVIDE_THRESHOLD = 4;

function subdivideBlock(shape) {
  const localSegments = shape.map((_, i) => [i, (i + 1) % shape.length]);
  const offset = params.offset();

  const subGraph = new Graph({
    minDistance: 0.1,
    minTwistDistance: 1000,
    minAngle: 1.45,
    maxAngle: 1.55,
    probability: 0.5,
    splitDirection: params.splitDirection(),
    noiseScale: 0,
    onComplete: (g) => {
      const extractor = new GraphRegionExtractor(
        g.vertices,
        g.segments.map((s) => [s.a, s.b]),
      );
      const regions = extractor.solve();
      for (const region of regions) {
        const regionShape = region.map((i) => g.vertices[i]);
        const area = Math.abs(PolygonInset.signedArea(regionShape));
        if (area > SUBDIVIDE_THRESHOLD) {
          // const shape =
          //   offset > 0 ? PolygonInset.shrink(regionShape, offset, 2.5) : v;
          // if (!shape) {
          //   continue;
          // }
          const shape = regionShape;
          subdivideBlock(shape);
          continue;
        }
        const polygonShape = new Shape(regionShape);
        const height = Math.min(Math.random() * Math.sqrt(area) * 2 + 0.1, 5);
        const geometry = new ExtrudeGeometry(polygonShape, {
          depth: height,
          bevelEnabled: true,
          bevelThickness: 0.05,
          bevelSize: 0.05,
          bevelSegments: 1,
        });
        const material = new MeshStandardMaterial({ color: 0xffffff });
        const polygonMesh = new Mesh(geometry, material);
        polygonMesh.castShadow = true;
        polygonMesh.receiveShadow = true;
        polygonMesh.userData.t = 0;
        polygonMesh.userData.speed = Maf.randomInRange(0.9, 1.1);
        polygonMesh.userData.height = height;
        groupCity.add(polygonMesh);
        faceMeshes.push(polygonMesh);
      }
    },
  });
  subGraph.addBoundary(shape, localSegments);
  try {
    const sampler = createPolygonSampler(shape, localSegments);
    const p = sampler();
    subGraph.start(p.x, p.y, 2);
    subGraphs.push(subGraph);
  } catch (e) {
    console.error("Error sampling polygon, discarding subgraph.", e);
  }
}

function tryMergeCityMeshes() {
  if (merged) return;
  if (!graph || !graph.completed) return;
  for (const sg of subGraphs) {
    if (!sg.completed) return;
  }
  for (const mesh of faceMeshes) {
    if (mesh.userData.t < 1) return;
  }

  const buildingGeos = [];
  const lawnGeos = [];

  for (const mesh of faceMeshes) {
    // Ground mesh has speed === 0 and was added last — skip it
    if (mesh.userData.speed === 0) continue;
    const color = mesh.material.color;
    if (color.getHex() === 0xffffff) {
      buildingGeos.push(mesh.geometry);
    } else {
      // Lawn: bake color into vertex colors on a clone
      const geo = mesh.geometry.clone();
      const count = geo.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geo.setAttribute("color", new BufferAttribute(colors, 3));
      lawnGeos.push(geo);
    }
  }

  // Remove all animated meshes before adding merged replacements
  for (const mesh of faceMeshes) {
    if (mesh.userData.speed === 0) continue;
    groupCity.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  faceMeshes = faceMeshes.filter((m) => m.userData.speed === 0);

  if (buildingGeos.length > 0) {
    const geo = mergeGeometries(buildingGeos);
    const mesh = new Mesh(geo, new MeshStandardMaterial({ color: 0xffffff }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.t = 1;
    mesh.userData.speed = 0;
    groupCity.add(mesh);
    faceMeshes.push(mesh);
  }

  if (lawnGeos.length > 0) {
    const geo = mergeGeometries(lawnGeos);
    const mesh = new Mesh(
      geo,
      new MeshStandardMaterial({ vertexColors: true }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.t = 1;
    mesh.userData.speed = 0;
    groupCity.add(mesh);
    faceMeshes.push(mesh);
    for (const g of lawnGeos) g.dispose();
  }

  merged = true;
}

effectRAF(() => {
  const greenness = params.greenness();
  const offset = params.offset();
  linesOpacity = 0;
  linesTargetOpacity = 1;
  merged = false;

  if (graph) {
    graph.dispose();
  }
  for (const subGraph of subGraphs) {
    subGraph.dispose();
  }
  subGraphs = [];
  for (const mesh of faceMeshes) {
    groupCity.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  faceMeshes = [];
  graph = new Graph({
    minDistance: params.minDistance(),
    minTwistDistance: params.minTwistDistance(),
    minAngle: params.angle()[0],
    maxAngle: params.angle()[1],
    probability: params.probability(),
    splitDirection: params.splitDirection(),
    noiseScale: params.noiseScale(),
    noiseRotation: params.noiseRotation(),
    onComplete: (g) => {
      linesTargetOpacity = 0;
      const extractor = new GraphRegionExtractor(
        graph.vertices,
        graph.segments.map((s) => [s.a, s.b]),
      );
      const regions = extractor.solve();
      for (const region of regions) {
        const v = region.map((i) => graph.vertices[i]);
        const shape = offset > 0 ? PolygonInset.shrink(v, offset, 2.5) : v;
        if (!shape) {
          continue;
        }

        if (Math.random() < greenness) {
          const height = Maf.randomInRange(0.1, 0.2);
          const polygonShape = new Shape(shape);
          const geometry = new ExtrudeGeometry(polygonShape, {
            depth: height,
            bevelEnabled: true,
            bevelThickness: 0.05,
            bevelSize: 0.05,
            bevelSegments: 1,
          });
          const hue = Maf.randomInRange(0.28, 0.38);
          const material = new MeshStandardMaterial({
            color: new Color().setHSL(hue, 0.6, 0.35),
          });
          const lawn = new Mesh(geometry, material);
          lawn.castShadow = true;
          lawn.receiveShadow = true;
          lawn.userData.t = 0;
          lawn.userData.speed = Maf.randomInRange(0.9, 1.1);
          lawn.userData.height = height;
          groupCity.add(lawn);
          faceMeshes.push(lawn);
          continue;
        }

        subdivideBlock(shape);
      }
    },
  });
  init();

  const groundR = 10 + 0.5;
  const groundSteps = params.boundarySides();
  const groundPoints = [];
  for (let i = 0; i < groundSteps; i++) {
    const a = Maf.map(0, groundSteps, 0, Maf.TAU, i);
    groundPoints.push(
      new Vector3(groundR * Math.cos(a), groundR * Math.sin(a), 0),
    );
  }
  const groundMesh = new Mesh(
    new ShapeGeometry(new Shape(groundPoints)),
    new MeshStandardMaterial({ color: 0x4a4a4e }),
  );
  groundMesh.receiveShadow = true;
  groundMesh.userData.t = 1;
  groundMesh.userData.speed = 0;
  groupCity.add(groundMesh);
  faceMeshes.push(groundMesh);
});

function randomize() {
  params.boundarySides.set(Maf.intRandomInRange(3, 20));
  params.minDistance.set(Maf.randomInRange(1, 2));
  params.minTwistDistance.set(Maf.randomInRange(0.2, 2));
  const d = Maf.randomInRange(0, 0.5);
  params.angle.set([Math.PI / 2 - d, Math.PI / 2 + d]);
  params.probability.set(Maf.randomInRange(0, 0.7));
  params.noiseScale.set(Maf.randomInRange(0, 10));
  params.greenness.set(Maf.randomInRange(0.2, 0.8));
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});
document.querySelector("#randomize-button")?.addEventListener("click", () => {
  randomize();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyN") {
    graph.update();
  }
});

render(() => {
  const dt = clock.getDelta();
  controls.update();

  graph.update();

  for (const subGraph of subGraphs) {
    subGraph.update();
  }

  if (!merged) {
    for (const mesh of faceMeshes) {
      mesh.userData.t += dt * mesh.userData.speed * 2;
      mesh.scale.z = Easings.OutBounce(Maf.clamp(mesh.userData.t, 0, 1));
    }
    tryMergeCityMeshes();
  }

  linesOpacity += (linesTargetOpacity - linesOpacity) * 0.05;

  const lines = graph.draw();
  if (lines.segments) {
    while (group.children.length) {
      group.remove(group.children[0]);
    }
    for (const line of lines.segments) {
      group.add(line);
    }
    for (const ray of lines.rays) {
      group.add(ray);
    }
    for (const vertex of lines.vertices) {
      group.add(vertex);
    }
  }
  for (const child of group.children) {
    if (child.material) {
      child.material.transparent = true;
      child.material.opacity = linesOpacity;
    }
  }

  if (running) {
    groupCity.rotation.z += dt / 10;
    group.rotation.z += dt / 10;
  }

  renderer.render(scene, camera);
});
