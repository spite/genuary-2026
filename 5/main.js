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
  HemisphereLight,
  Box3,
  IcosahedronGeometry,
  Group,
  TorusGeometry,
  ExtrudeGeometry,
  DirectionalLight,
  MeshStandardMaterial,
  Shape,
  MeshNormalMaterial,
} from "three";
import { Material, loadEnvMap } from "modules/material.js";
import { RoundedCylinderGeometry } from "modules/rounded-cylinder-geometry.js";
import { GradientLinear } from "modules/gradient.js";

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
  "5. Write “Genuary”. Avoid using a font.",
  document.querySelector("#gui-container")
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
  "<p>Press R to shuffle the objects.</p><p>Press Space to toggle rotation.</p><p>Press Tab to toggle this GUI.</p>"
);
gui.show();

const color = rainbow[rainbow.length - 1];
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

const letters1 = {
  g: [
    [
      [4.5, 0],
      [0, 0],
      [0, 6],
      [4, 6],
      [4, 2],
      [2, 2],
      [2, 4.5],
    ],
  ],
  e: [
    [
      [4.5, 0],
      [0, 0],
      [0, 6],
      [4.5, 6],
    ],
    [
      [1.5, 2],
      [4, 2],
      [4, 4],
      [1.5, 4],
    ],
  ],
  n: [
    [
      [0, 6.5],
      [0, 0],
      [4, 0],
      [4, 4.5],
    ],
    [
      [2, 1.5],
      [2, 6],
      [6, 6],
      [6, -0.5],
    ],
  ],
  u: [
    [
      [0, -0.5],
      [0, 6],
      [4, 6],
      [4, -0.5],
    ],
    [
      [2, -0.5],
      [2, 4.5],
    ],
  ],
  a: [
    [
      [0, 6.5],
      [0, 0],
      [4, 0],
      [4, 6.5],
    ],
    [
      [2, 1.5],
      [2, 2.5],
    ],
    [
      [2, 3.5],
      [2, 6.5],
    ],
  ],
  r: [
    [
      [-0.5, 0],
      [4, 0],
      [4, 6.6],
    ],
    [
      [1.5, 4],
      [4, 4],
    ],
    [
      [0, 6.5],
      [0, 2],
      [2.5, 2],
    ],
    [
      [1.5, 6],
      [2.5, 6],
    ],
  ],
  y: [
    [
      [0, -0.5],
      [0, 4],
      [2.5, 4],
    ],
    [
      [2, -0.5],
      [2, 2.5],
    ],
    [
      [-0.5, 6],
      [4, 6],
      [4, -0.5],
    ],
  ],
};

const letters2 = {
  g: [
    [
      [6.5, 0],
      [0, 0],
      [0, 6],
      [6, 6],
      [6, 2],
      [2, 2],
      [2, 4],
      [4.5, 4],
    ],
  ],
  e: [
    [
      [6.5, 0],
      [0, 0],
      [0, 6],
      [6.5, 6],
    ],
    [
      [1.5, 2],
      [6, 2],
      [6, 4],
      [1.5, 4],
    ],
  ],
  n: [
    [
      [0, 6.5],
      [0, 0],
      [4, 0],
      [4, 4.5],
    ],
    [
      [2, 1.5],
      [2, 6],
      [6, 6],
      [6, -0.5],
    ],
  ],
  u: [
    [
      [0, -0.5],
      [0, 6],
      [6, 6],
      [6, -0.5],
    ],
    [
      [2, -0.5],
      [2, 4],
      [4, 4],
      [4, -0.5],
    ],
  ],
  a: [
    [
      [0, 6.5],
      [0, 0],
      [6, 0],
      [6, 6.5],
    ],
    [
      [1.5, 2],
      [4.5, 2],
    ],
    [
      [2, 6.5],
      [2, 4],
      [4, 4],
      [4, 6.5],
    ],
  ],
  r: [
    [
      [-0.5, 0],
      [6, 0],
      [6, 6.5],
    ],
    [
      [1.5, 4],
      [6, 4],
    ],
    [
      [0, 6.5],
      [0, 2],
      [4.5, 2],
    ],
    [
      [1.5, 6],
      [4.5, 6],
    ],
  ],
  y: [
    [
      [0, -0.5],
      [0, 4],
      [4.5, 4],
    ],
    [
      [2, -0.5],
      [2, 2],
      [4, 2],
      [4, -0.5],
    ],
    [
      [-0.5, 6],
      [6, 6],
      [6, -0.5],
    ],
  ],
  "*": [
    [
      [0, 2.5],
      [0, 0],
      [2.5, 0],
    ],
    [
      [3.5, 0],
      [6, 0],
      [6, 2.5],
    ],
    [
      [6, 3.5],
      [6, 6],
      [3.5, 6],
    ],
    [
      [0, 3.5],
      [0, 6],
      [2.5, 6],
    ],
  ],
};

function createThickPath(points, thickness) {
  const halfWidth = thickness / 2;
  const leftSide = [];
  const rightSide = [];

  const sub = (v1, v2) => [v1[0] - v2[0], v1[1] - v2[1]];
  const add = (v1, v2) => [v1[0] + v2[0], v1[1] + v2[1]];
  const scale = (v, s) => [v[0] * s, v[1] * s];
  const normalize = (v) => {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    return len === 0 ? [0, 0] : [v[0] / len, v[1] / len];
  };
  const perpendicular = (v) => [-v[1], v[0]];
  const dot = (v1, v2) => v1[0] * v2[0] + v1[1] * v2[1];

  for (let i = 0; i < points.length; i++) {
    const current = points[i];

    let dir1, dir2;

    if (i === 0) {
      const next = points[i + 1];
      dir2 = normalize(sub(next, current));
      dir1 = dir2;
    } else if (i === points.length - 1) {
      const prev = points[i - 1];
      dir1 = normalize(sub(current, prev));
      dir2 = dir1;
    } else {
      const prev = points[i - 1];
      const next = points[i + 1];
      dir1 = normalize(sub(current, prev));
      dir2 = normalize(sub(next, current));
    }

    const n1 = perpendicular(dir1);
    const n2 = perpendicular(dir2);

    let miter = normalize(add(n1, n2));

    const miterLength = halfWidth / dot(miter, n1);

    const offset = scale(miter, miterLength);

    leftSide.push(add(current, offset));
    rightSide.push(sub(current, offset));
  }

  return [...leftSide, ...rightSide.reverse()];
}

function generateStem(points) {
  const pts = createThickPath(points, 1.2);
  const shape = new Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    shape.lineTo(pt[0], pt[1]);
  }
  const geometry = new ExtrudeGeometry(shape, {
    bevelThickness: 0.2,
    bevelOffset: 0,
    bevelEnabled: true,
    bevelSteps: 1,
    curveSegments: 1,
    bevelSegments: 1,
    bevelSize: 0.1,
  });
  return geometry;
}

const letters = letters2;
const material = new MeshStandardMaterial({
  color: rainbow[5],
  roughness: 1,
  metalness: 0,
});
let offset = 0;
const bounds = new Box3();
const word = [
  ["g", [0, 0]],
  ["e", [1, 0]],
  ["n", [0, 1]],
  ["u", [1, 1]],
  ["a", [0, 2]],
  ["r", [1, 2]],
  ["y", [0, 3]],
  ["*", [1, 3]],
];
group.rotation.x = -Math.PI / 2;
for (const letter of word) {
  for (const stem of letters[letter[0]]) {
    const mesh = new Mesh(generateStem(stem), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.geometry.scale(0.1, 0.1, 0.1);
    mesh.rotation.x = Math.PI;
    mesh.position.set(letter[1][0], -letter[1][1] + 2, 0).multiplyScalar(0.8);
    group.add(mesh);
    bounds.expandByObject(mesh);
  }
  offset = bounds.max.x - bounds.min.x + 0.1;
}
group.position.x = -offset / 2;
scene.add(group);

function init() {}

init();

camera.position.set(0, 1, 1).multiplyScalar(10);
camera.lookAt(0, 0, 0);

function randomize() {}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});

render(() => {
  controls.update();

  const dt = clock.getDelta();

  renderer.render(scene, camera);
});
