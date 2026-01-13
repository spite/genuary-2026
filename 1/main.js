import { fromDefaults, renderer, camera, controls, render } from "common";
import GUI from "gui";

import { Scene, Mesh, BoxGeometry, MeshNormalMaterial } from "three";

const defaults = {
  seed: 1337,
  scale: 1,
};

const params = fromDefaults(defaults);

const gui = new GUI(
  "1. One color, one shape",
  document.querySelector("#gui-container")
);
gui.addSlider("scale", params.scale, 0.1, 1, 0.01);

gui.show();

const scene = new Scene();
const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshNormalMaterial());
scene.add(mesh);

camera.position.set(1, 1, 1);
camera.lookAt(0, 0, 0);

render(() => {
  controls.update();
  renderer.render(scene, camera);
});
