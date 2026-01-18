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
import { UltraHDRLoader } from "third_party/UltraHDRLoader.js";
import {
  Scene,
  Mesh,
  Color,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  DirectionalLight,
  MeshStandardMaterial,
  EquirectangularReflectionMapping,
  FloatType,
} from "three";
import { Boing } from "./boing.js";
import { pointsOnSphere } from "modules/points-sphere.js";

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
  points: 50,
  scale: 1,
  roughness: 0.15,
  metalness: 0.5,
};

const params = fromDefaults(defaults);

const gui = new GUI(
  "2. Twelve principles of animation",
  document.querySelector("#gui-container")
);
gui.addSlider("Points", params.points, 1, 250, 1, () => {
  generate();
  randomize();
});
gui.addSlider("Scale", params.scale, 0.1, 2, 0.01, (scale) => {
  for (const boing of boings) {
    boing.globalScale = scale;
  }
});
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01, (roughness) => {
  for (const boing of boings) {
    boing.material.roughness = roughness;
  }
});
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01, (metalness) => {
  for (const boing of boings) {
    boing.material.metalness = metalness;
  }
});
gui.addButton("Random", randomize);
gui.addSeparator();
gui.addText(
  "<p>Press R to shuffle the objects.</p><p>Press Space to toggle rotation.</p><p>Press Tab to toggle this GUI.</p>"
);
gui.show();

renderer.setClearColor(new Color(rainbow[0]));

const scene = new Scene();
const group = new Group();
scene.add(group);
const boings = [];

let POINTS = params.points();

function generate() {
  POINTS = params.points();
  const seeds = pointsOnSphere(POINTS, 1);
  for (const boing of boings) {
    group.remove(boing.mesh);
  }
  boings.length = 0;
  for (let i = 0; i < POINTS; i++) {
    const boing = new Boing(envMap, Maf.randomElement(rainbow));
    boing.globalScale = params.scale();
    boing.material.roughness = params.roughness();
    boing.material.metalness = params.metalness();
    boings.push(boing);
    boing.mesh.position.copy(seeds[i]);
    group.add(boing.mesh);
  }
}

const loader = new UltraHDRLoader();
loader.setDataType(FloatType);

let envMap;
function loadEnvironment(resolution = "2k", type = "HalfFloatType") {
  loader.load(
    `../assets/spruit_sunrise_${resolution}.hdr.jpg`,
    function (texture) {
      envMap = texture;
      envMap.mapping = EquirectangularReflectionMapping;
      envMap.needsUpdate = true;

      init();
    }
  );
}

function init() {
  generate();
}

loadEnvironment();

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

camera.position.set(0, 0, 1).multiplyScalar(10);
camera.lookAt(0, 0, 0);

function randomize() {
  for (let i = 0; i < boings.length; i++) {
    boings[i].randomize();
  }
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});

render(() => {
  controls.update();

  const dt = clock.getDelta();

  for (const boing of boings) {
    boing.mesh.material.globalScale = params.scale();
    boing.update(running ? dt : 0);
    // group.rotation.x += 0.5 * dt;
    // group.rotation.y += 0.45 * dt;
    // group.rotation.z += 0.55 * dt;
  }

  renderer.render(scene, camera);
});
