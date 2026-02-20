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
  ExtrudeGeometry,
  MeshStandardMaterial,
  HemisphereLight,
  DirectionalLight,
  PCFSoftShadowMap,
} from "three";
import { Graph } from "./graph.js";
import { effectRAF } from "reactive";
import { createPolygonSampler, getColor } from "./utils.js";
import { GraphRegionExtractor } from "./extractor.js";
import { PolygonInset } from "./shrink.js";

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

const SUBDIVIDE_THRESHOLD = 3.0;

function subdivideBlock(shape) {
  const localSegments = shape.map((_, i) => [i, (i + 1) % shape.length]);

  const subGraph = new Graph({
    minDistance: 1,
    minTwistDistance: 1000,
    minAngle: 1.45,
    maxAngle: 1.55,
    probability: 0.9,
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
          subdivideBlock(regionShape);
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

effectRAF(() => {
  const greenness = params.greenness();
  const offset = params.offset();

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
          const polygonShape = new Shape(shape);
          const geometry = new ExtrudeGeometry(polygonShape, {
            depth: Maf.randomInRange(0.1, 0.2),
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
          groupCity.add(lawn);
          faceMeshes.push(lawn);
          continue;
        }

        subdivideBlock(shape);
      }
    },
  });
  init();
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
  controls.update();

  graph.update();

  for (const subGraph of subGraphs) {
    subGraph.update();
  }

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

  const dt = clock.getDelta();
  if (running) {
    groupCity.rotation.z += dt / 10;
    group.rotation.z += dt / 10;
  }

  renderer.render(scene, camera);
});
