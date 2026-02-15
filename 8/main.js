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
  HemisphereLight,
  IcosahedronGeometry,
  TorusGeometry,
  DirectionalLight,
} from "three";
import { Material, loadEnvMap } from "modules/material.js";
import { RoundedCylinderGeometry } from "modules/rounded-cylinder-geometry.js";
import { GradientLinear } from "modules/gradient.js";
import {
  Graph,
  offsetPolygon,
  randomPointInFace,
  getBoundingBox,
  createOutline,
  createShape,
} from "./graph.js";
import { effectRAF } from "reactive";

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

const blockGraphs = [];

const graph = new Graph({
  minDistance: params.minDistance(),
  minTwistDistance: params.minTwistDistance(),
  minAngle: params.angle()[0],
  maxAngle: params.angle()[1],
  probability: params.probability(),
  noiseScale: params.noiseScale(),
  onComplete: (g) => {
    blockGraphs.length = 0;
    while (groupFaces.children.length) {
      groupFaces.children[0].geometry?.dispose();
      groupFaces.remove(groupFaces.children[0]);
    }
    const blocks = g.extractFaces();
    const vertexPool = {};
    for (const block of blocks) {
      for (const v of block.vertices) {
        vertexPool[v.id] = v;
      }
    }
    for (const block of blocks) {
      const offset = offsetPolygon(block.path, vertexPool, 0.2);
      if (offset.vertices.length >= 3) {
        const blockPts = offset.vertices.map((v) => ({ x: v.x, y: v.y }));
        const bb = getBoundingBox(blockPts);
        const blockSize = Math.min(bb.width, bb.height);

        const f = new Graph({
          minDistance: Math.max(0.1, blockSize * 0.2),
          minTwistDistance: 1000,
          minAngle: 1.45,
          maxAngle: 1.55,
          noiseScale: 0,
          probability: 0.1,

          onComplete: (b) => {
            const faces = b.extractFaces();
            for (const face of faces) {
              const pts = face.vertices.map((v) => new Vector2(v.x, v.y));
              const mesh = createShape(pts);
              if (mesh) groupFaces.add(mesh);
            }
            // Remove completed graph
            const idx = blockGraphs.indexOf(b);
            if (idx !== -1) blockGraphs.splice(idx, 1);
          },
        });

        f.addBoundaryFromPoints(blockPts);
        const offsetFace = { vertices: blockPts };
        const p = randomPointInFace(offsetFace);
        f.start(p.x, p.y, Maf.intRandomInRange(2, 5));

        blockGraphs.push(f);
      }
    }
  },
});

function init() {
  graph.addBoundary();
  for (let i = 0; i < params.seeds(); i++) {
    const r = 5;
    graph.start(
      Maf.randomInRange(-r, r),
      Maf.randomInRange(-r, r),
      params.linesPerSeed(),
    );
  }
}
init();

effectRAF(() => {
  blockGraphs.length = 0;
  while (groupFaces.children.length) {
    groupFaces.children[0].geometry?.dispose();
    groupFaces.remove(groupFaces.children[0]);
  }
  graph.reset({
    minDistance: params.minDistance(),
    minTwistDistance: params.minTwistDistance(),
    minAngle: params.angle()[0],
    maxAngle: params.angle()[1],
    probability: params.probability(),
    noiseScale: params.noiseScale(),
  });
  init();
});

function randomize() {
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
    for (const block of blockGraphs) {
      block.update();
    }
  }

  const lines = graph.draw();
  if (lines.length) {
    while (groupLines.children.length) {
      groupLines.children[0].geometry?.dispose();
      groupLines.remove(groupLines.children[0]);
    }
    for (const line of lines) {
      groupLines.add(line);
    }
  }

  const dt = clock.getDelta();

  renderer.render(scene, camera);
});
