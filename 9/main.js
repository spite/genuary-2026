import {
  fromDefaults,
  renderer,
  camera,
  render,
  running,
  controls,
  onResize,
} from "common";
import { effectRAF } from "reactive";
import GUI from "gui";
import { Scene, Vector2 } from "three";
import { PhysarumSimulationPass } from "./physarum.js";
import { SceneParticles } from "./particles.js";

const physarumPass = new PhysarumSimulationPass(1024, 1024);
const sceneParticles = new SceneParticles(
  1024,
  1024,
  window.innerWidth,
  window.innerHeight,
);

const scene = new Scene();
scene.add(sceneParticles.mesh);
camera.position.set(0, 0, 3);

const simU = physarumPass.simPass.shader.uniforms;
const trailU = physarumPass.trailPass.shader.uniforms;
const depositU = physarumPass.depositMat.uniforms;
renderer.setClearColor(0x000000, 1);

const defaults = {
  sensorAngle: 0.4,
  sensorDist: 15.0,
  turnSpeed: 10.0,
  moveSpeed: 100.0,
  lifeDecay: 0.05,
  decayRate: 0.05,
  diffuseRate: 0.5,
  pointSize: 1.0,
  startPosType: "1",
};

const params = fromDefaults(defaults);

effectRAF(() => {
  simU.sensorAngle.value = params.sensorAngle();
  simU.sensorDist.value = params.sensorDist();
  simU.turnSpeed.value = params.turnSpeed();
  simU.moveSpeed.value = params.moveSpeed();
  simU.lifeDecay.value = params.lifeDecay();
  trailU.decayRate.value = params.decayRate();
  trailU.diffuseRate.value = params.diffuseRate();
  depositU.pointSize.value = params.pointSize();
  sceneParticles.mat.uniforms.pointSize.value = params.pointSize();
  simU.startPosType.value = parseInt(params.startPosType());
});

const gui = new GUI(
  "Physarum Simulation",
  document.querySelector("#gui-container"),
);

gui.addSlider("Sensor Angle", params.sensorAngle, 0, 1.5, 0.01);
gui.addSlider("Sensor Dist", params.sensorDist, 1, 100, 1);
gui.addSlider("Turn Speed", params.turnSpeed, 0, 50, 0.1);
gui.addSlider("Move Speed", params.moveSpeed, 0, 200, 1);
gui.addSlider("Life Decay", params.lifeDecay, 0, 0.5, 0.01);
gui.addSlider("Decay Rate", params.decayRate, 0, 0.2, 0.001);
gui.addSlider("Diffuse Rate", params.diffuseRate, 0, 1, 0.01);
gui.addSlider("Point Size", params.pointSize, 0.1, 5, 0.1);
gui.addSelect("Spawn", params.startPosType, [
  ["0", "Circle"],
  ["1", "Full Plane"],
]);
gui.addSeparator();
gui.addButton("Randomize", randomize);
gui.show();

const mouse = new Vector2(0.5, 0.5);

renderer.domElement.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX / window.innerWidth;
  mouse.y = 1.0 - e.clientY / window.innerHeight;
  simU.mousePos.value.copy(mouse);
  simU.mouseSpawn.value = e.buttons === 1;
});
renderer.domElement.addEventListener(
  "mousedown",
  () => (simU.mouseSpawn.value = true),
);
renderer.domElement.addEventListener(
  "mouseup",
  () => (simU.mouseSpawn.value = false),
);

const rnd = (min, max, dec = 2) =>
  parseFloat((min + Math.random() * (max - min)).toFixed(dec));

function randomize() {
  params.sensorAngle.set(rnd(0.1, 1.5));
  params.sensorDist.set(rnd(5, 50, 0));
  params.turnSpeed.set(rnd(1, 30, 1));
  params.moveSpeed.set(rnd(20, 150, 0));
  params.lifeDecay.set(rnd(0.01, 0.3));
  params.decayRate.set(rnd(0.01, 0.15, 3));
  params.diffuseRate.set(rnd(0.1, 0.9));
}

onResize(() => {
  sceneParticles.setSize(renderer, window.innerWidth, window.innerHeight);
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") randomize();
});
document
  .querySelector("#randomize-button")
  ?.addEventListener("click", randomize);

render(() => {
  controls.update();

  if (running) {
    physarumPass.render(renderer);
    sceneParticles.update(physarumPass.simPass.texture);
  }
  physarumPass.displayPass.render(renderer, true);
  renderer.render(scene, camera);
});
