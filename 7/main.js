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
  Color,
  Vector3,
  Vector2,
  Matrix4,
  Group,
  HemisphereLight,
  DirectionalLight,
  Plane,
  Raycaster,
} from "three";
import { loadEnvMap } from "modules/material.js";
import { VolumeRenderer } from "modules/volume_renderer.js";
import { MarchingCubes, getMaxGridSize } from "modules/marching_cubes.js";

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

const maxGridSize = getMaxGridSize(renderer);
console.log(maxGridSize);

const size = Math.min(64, maxGridSize.maxSize);

const volumeRenderer = new VolumeRenderer(size);
volumeRenderer.setTextureMode("atlas");

const marchingCubes = new MarchingCubes({
  size,
  textureSize: size,
  isoLevel: 0.5,
  volumeRenderer: volumeRenderer,
});
marchingCubes.setTextureMode("atlas");
marchingCubes.setIsoLevel(0.5);
marchingCubes.setNormalMode("tetrahedron");

// Load env map
const envMap = await loadEnvMap(
  `../assets/spruit_sunrise_2k.hdr.jpg`,
  renderer,
);
marchingCubes.setEnvMap(envMap);

const c = new Color(Maf.randomElement(rainbow));
marchingCubes.setBaseColor(c.r, c.g, c.b);
marchingCubes.setEnvMapIntensity(0.2);

const defaults = {
  seed: 1337,
  roughness: 0.2,
  metalness: 0,
  dodecahedron: true,
  torus: true,
  spheres: true,
  mouseSphere: true,
};

const params = fromDefaults(defaults);

const gui = new GUI(
  "7. Boolean algebra",
  document.querySelector("#gui-container"),
);
gui.addCheckbox("Dodecahedron", params.dodecahedron);
gui.addCheckbox("Torus", params.torus);
gui.addCheckbox("Spheres", params.spheres);
gui.addCheckbox("Mouse sphere", params.mouseSphere);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
gui.addButton("Random", randomize);
gui.addSeparator();
gui.addText(
  "<p>Press R to shuffle the objects.</p><p>Press Space to toggle rotation.</p><p>Press Tab to toggle this GUI.</p>",
);
gui.show();

const color = rainbow[rainbow.length - 1];
renderer.setClearColor(new Color(color));
marchingCubes.setAmbientColor(color);

const scene = new Scene();
const group = new Group();
scene.add(group);

marchingCubes.mesh.scale.set(0.1, 0.1, 0.1).multiplyScalar(64 / size);
group.add(marchingCubes.mesh);

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

function init() {}

init();

camera.position.set(0, 0, 1).multiplyScalar(10);
camera.lookAt(0, 0, 0);

function randomize() {
  marchingCubes.mesh.material.wireframe =
    !marchingCubes.mesh.material.wireframe;
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});
document.querySelector("#randomize-button")?.addEventListener("click", () => {
  randomize();
});

const raycaster = new Raycaster();
const mouseNDC = new Vector2();
const intersectPlane = new Plane();
const mouseWorldPos = new Vector3();
const mouseLocalPos = new Vector3();
const mouseGridPos = new Vector3(0, 0, 0);
const smoothedMouseGridPos = new Vector3(0, 0, 0);
const cameraDirection = new Vector3();
const meshWorldPos = new Vector3();
const inverseMatrixWorld = new Matrix4();

window.addEventListener("mousemove", (e) => {
  if (e.target.closest("#gui-container")) {
    return;
  }
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

function updateMousePosition() {
  camera.getWorldDirection(cameraDirection);
  marchingCubes.mesh.getWorldPosition(meshWorldPos);
  intersectPlane.setFromNormalAndCoplanarPoint(cameraDirection, meshWorldPos);
  raycaster.setFromCamera(mouseNDC, camera);

  const intersected = raycaster.ray.intersectPlane(
    intersectPlane,
    mouseWorldPos,
  );

  if (intersected) {
    inverseMatrixWorld.copy(marchingCubes.mesh.matrixWorld).invert();
    mouseLocalPos.copy(mouseWorldPos).applyMatrix4(inverseMatrixWorld);

    mouseGridPos.copy(mouseLocalPos);
  }
}

let time = 0;
render(() => {
  controls.update();

  updateMousePosition();
  smoothedMouseGridPos.lerp(mouseGridPos, 0.1);
  volumeRenderer.setMouse(
    smoothedMouseGridPos.x,
    smoothedMouseGridPos.y,
    smoothedMouseGridPos.z,
  );
  volumeRenderer.setShapesEnabled({
    dodecahedron: params.dodecahedron(),
    torus: params.torus(),
    spheres: params.spheres(),
    mouseSphere: params.mouseSphere(),
  });

  const dt = clock.getDelta();
  if (running) {
    time += dt;
  }

  marchingCubes.setRoughness(params.roughness());
  marchingCubes.setMetalness(params.metalness());

  volumeRenderer.update(renderer, time);
  renderer.render(scene, camera);
});
