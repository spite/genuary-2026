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
  HemisphereLight,
  IcosahedronGeometry,
  TorusGeometry,
  DirectionalLight,
} from "three";
import { Material, loadEnvMap } from "modules/material.js";
import { RoundedCylinderGeometry } from "modules/rounded-cylinder-geometry.js";
import { GradientLinear } from "modules/gradient.js";
import {
  start,
  update,
  draw,
  reset,
  areActiveLines,
  extractFaces,
} from "./graph.js";

function init() {
  for (let i = 0; i < 3; i++) {
    start(Maf.randomInRange(-2, 2), Maf.randomInRange(-2, 2), 5);
  }
}
init();

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
  points: 1,
  range: [0, 0.25],
  scale: 1,
  roughness: 0.25,
  metalness: 0.5,
  offsetAngle: 0,
  offsetDistance: 0,
};

const params = fromDefaults(defaults);

const gui = new GUI(
  "8. A City. Create a generative metropolis.",
  document.querySelector("#gui-container"),
);
gui.addSlider("Points", params.points, 1, 250, 1);
gui.addRangeSlider("Range", params.range, 0, 1, 0.01);
gui.addSlider("Scale", params.scale, 0.1, 2, 0.01);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
gui.addSlider("Offset Angle", params.offsetAngle, 0, Math.PI * 2, 0.01);
gui.addSlider("Offset Distance", params.offsetDistance, 0, 2, 0.01);
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

function randomize() {
  facesExtracted = false;
  reset({
    minDistance: Maf.randomInRange(0.5, 2),
    minAngle: Maf.randomInRange(0, Math.PI / 2),
    maxAngle: Maf.randomInRange(Math.PI / 2, Math.PI),
    probability: Maf.randomInRange(0.9, 0.99),
  });
  init();
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
    update();
  }
});

let facesExtracted = false;

render(() => {
  controls.update();

  if (running) {
    update(10);
  }

  if (!areActiveLines() && !facesExtracted) {
    const faces = extractFaces();
    for (const face of faces) {
      group.add(face);
    }
    facesExtracted = true;
  }

  const lines = draw();
  if (lines.length) {
    while (group.children.length) {
      group.children[0].geometry?.dispose();
      group.remove(group.children[0]);
    }
    for (const line of lines) {
      group.add(line);
    }
  }

  const dt = clock.getDelta();

  renderer.render(scene, camera);
});
