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
  Vector2,
  Vector3,
  Group,
  Shape,
  ShapeGeometry,
  MeshBasicMaterial,
  DoubleSide,
  HemisphereLight,
  IcosahedronGeometry,
  TorusGeometry,
  DirectionalLight,
} from "three";
import { Material, loadEnvMap } from "modules/material.js";
import { RoundedCylinderGeometry } from "modules/rounded-cylinder-geometry.js";
import { GradientLinear } from "modules/gradient.js";
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
  noiseScale: 1,
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
gui.addSlider("Noise scale", params.noiseScale, 0, 10, 0.001);
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

const scene = new Scene();
const group = new Group();
const groupFaces = new Group();
groupFaces.visible = params.showFaces();
const groupLines = new Group();
groupLines.visible = params.showLines();
group.add(groupFaces);
group.add(groupLines);
scene.add(group);

const light = new DirectionalLight(0xffffff, 3);
light.position.set(3, 6, 3);
light.castShadow = true;
light.shadow.camera.top = 3;
light.shadow.camera.bottom = -3;
light.shadow.camera.right = 3;
light.shadow.camera.left = -3;
light.shadow.mapSize.set(4096, 4096);
scene.add(light);

const hemiLight = new HemisphereLight(0xffffff, 0xffffff, 2);
hemiLight.color.setHSL(0.6, 1, 0.6);
hemiLight.groundColor.setHSL(0.095, 1, 0.75);
hemiLight.position.set(0, 50, 0);
scene.add(hemiLight);

camera.position.set(1, 1, 1).multiplyScalar(20);
camera.lookAt(0, 0, 0);

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

effectRAF(() => {
  if (graph) {
    graph.dispose();
  }
  for (const mesh of faceMeshes) {
    scene.remove(mesh);
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
    noiseScale: params.noiseScale(),
    onComplete: (g) => {
      const extractor = new GraphRegionExtractor(
        graph.vertices,
        graph.segments.map((s) => [s.a, s.b]),
      );
      const regions = extractor.solve();
      for (const region of regions) {
        const v = region.map((i) => graph.vertices[i]);
        const shape = PolygonInset.shrink(v, 0.1, 2.5);

        const polygonShape = new Shape(shape);
        const geometry = new ShapeGeometry(polygonShape);
        const material = new MeshBasicMaterial({
          color: getColor(),
          side: DoubleSide,
          wireframe: !true,
        });
        const polygonMesh = new Mesh(geometry, material);
        scene.add(polygonMesh);
        faceMeshes.push(polygonMesh);
      }
    },
  });
  init();
});

function randomize() {
  params.boundarySides.set(Maf.intRandomInRange(3, 20));
  params.minDistance.set(Maf.randomInRange(0.2, 2));
  params.minTwistDistance.set(Maf.randomInRange(0.2, 2));
  params.angle.set([
    Maf.randomInRange(0, Math.PI / 2),
    Maf.randomInRange(Math.PI / 2, Math.PI),
  ]);
  params.probability.set(Maf.randomInRange(0, 0.8));
  params.noiseScale.set(Maf.randomInRange(0, 10));
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

  if (running) {
    graph.update();
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

  renderer.render(scene, camera);
});
