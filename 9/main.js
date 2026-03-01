import {
  fromDefaults,
  renderer,
  camera,
  render,
  running,
  controls,
  onResize,
  clock,
} from "common";
import { effectRAF } from "reactive";
import GUI from "gui";
import { Scene, Vector2, DirectionalLight, HemisphereLight } from "three";
import { PhysarumSimulationPass } from "./physarum.js";
import { SceneParticles } from "./particles.js";
import { loadEnvMap } from "modules/material.js";

const maxDimension = renderer.capabilities.maxTextureSize;
const w = maxDimension / 8;

const physarumPass = new PhysarumSimulationPass(w, w / 2);
const sceneParticles = new SceneParticles(w, w / 2);

const envMap = await loadEnvMap(
  `../assets/spruit_sunrise_2k.hdr.jpg`,
  renderer,
);
sceneParticles.sphereMat.envMap = envMap;

const scene = new Scene();
scene.add(sceneParticles.group);
camera.position.set(0, 0, 4);

const light = new DirectionalLight(0xffffff, 3);
light.position.set(3, 6, 3);
scene.add(light);

const hemiLight = new HemisphereLight(0xffffff, 0xffffff, 2);
hemiLight.color.setHSL(0.6, 1, 0.6);
hemiLight.groundColor.setHSL(0.095, 1, 0.75);
hemiLight.position.set(0, 50, 0);
scene.add(hemiLight);

sceneParticles.syncMaterial(renderer, scene);

const simU = physarumPass.simPass.shader.uniforms;
const trailU = physarumPass.trailPass.shader.uniforms;
const depositU = physarumPass.depositMat.uniforms;
renderer.setClearColor(0xb70000, 1);

const defaults = {
  sensorAngle: 0.71,
  sensorDist: 28.0,
  turnSpeed: 25.6,
  moveSpeed: 89.0,
  lifeDecay: 0.23,
  decayRate: 0.1,
  diffuseRate: 0.41,
  pointSize: 1.0,
  displacementOffset: -0.5,
  blurRadius: 70,
  normalBlurRadius: 2,
  trailScale: 100.0,
  sssStrength: 0.15,
  sssDensity: 0.05,
  sssPower: 3.0,
  sssMix: 0.5,
  debugView: "none",
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
  sceneParticles.sphereMat.uniforms.displacementOffset.value =
    params.displacementOffset();
  const r = Math.round(params.blurRadius());
  sceneParticles.blurHMat.uniforms.blurRadius.value = r;
  sceneParticles.blurVMat.uniforms.blurRadius.value = r;
  const nr = Math.round(params.normalBlurRadius());
  sceneParticles.normalBlurHMat.uniforms.blurRadius.value = nr;
  sceneParticles.normalBlurVMat.uniforms.blurRadius.value = nr;
  const ts = params.trailScale();
  sceneParticles.sphereMat.uniforms.trailScale.value = ts;
  sceneParticles.debugMat.uniforms.trailScale.value = ts;
  sceneParticles.sphereMat.uniforms.sssStrength.value = params.sssStrength();
  sceneParticles.sphereMat.uniforms.sssDensity.value = params.sssDensity();
  sceneParticles.sphereMat.uniforms.sssPower.value = params.sssPower();
  sceneParticles.sphereMat.uniforms.sssMix.value = params.sssMix();
  const dv = params.debugView();
  if (dv === "none") sceneParticles.setDebugView(null);
  else if (dv === "trail") sceneParticles.setDebugView(0);
  else sceneParticles.setDebugView(1);
});

const gui = new GUI(
  "9. Crazy automaton. Cellular automata with crazy rules.",
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
gui.addSlider("Displacement", params.displacementOffset, -1, 1, 0.01);
gui.addSlider("Blur Radius", params.blurRadius, 1, 100, 1);
gui.addSlider("Normal Blur", params.normalBlurRadius, 1, 30, 1);
gui.addSlider("Trail Scale", params.trailScale, 1, 500, 1);
// gui.addSlider("SSS Strength", params.sssStrength, 0, 0.5, 0.005);
// gui.addSlider("SSS Density", params.sssDensity, 0, 0.2, 0.005);
// gui.addSlider("SSS Power", params.sssPower, 1, 16, 0.1);
// gui.addSlider("SSS Mix", params.sssMix, 0, 1, 0.01);

gui.addSeparator();
// gui.addSelect("Debug View", params.debugView, [
//   ["none", "PBR"],
//   ["trail", "Trail Map"],
//   ["blurred", "Blurred Trail"],
// ]);
gui.addButton("Randomize", randomize);
gui.show();

function randomize() {
  params.sensorAngle.set(Maf.randomInRange(0.1, 1.5));
  params.sensorDist.set(Maf.randomInRange(5, 50));
  params.turnSpeed.set(Maf.randomInRange(1, 30));
  params.moveSpeed.set(Maf.randomInRange(20, 150));
  params.lifeDecay.set(Maf.randomInRange(0.01, 0.3));
  params.decayRate.set(Maf.randomInRange(0.01, 0.15));
  params.diffuseRate.set(Maf.randomInRange(0.1, 0.9));
  // params.displacementOffset.set(Maf.randomInRange(-1, 1));
}

onResize(() => {
  // physarumPass.setSize(renderer, window.innerWidth, window.innerHeight);
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

  const dt = clock.getDelta();

  if (running) {
    physarumPass.render(renderer);

    sceneParticles.group.rotation.y += dt / 20;
  }

  sceneParticles.update(
    physarumPass.simPass.texture,
    physarumPass.trailPass.texture,
  );
  sceneParticles.renderBlur(renderer);

  physarumPass.displayPass.render(renderer, true);
  renderer.render(scene, camera);
});
