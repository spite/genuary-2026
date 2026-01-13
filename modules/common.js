import { WebGLRenderer, PerspectiveCamera, OrthographicCamera } from "three";
import { OrbitControls } from "OrbitControls";
import { signal } from "reactive";

console.log("Common module loaded");

// UI stuff

function fromDefaults(defaults) {
  const params = {};
  for (const key in defaults) {
    params[key] = signal(defaults[key]);
  }
  return params;
}

// Rendering stuff

const initialFov = 35;
const cameras = [];
const resizeFns = [];

function getWebGLRenderer() {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);
  return renderer;
}

const renderer = getWebGLRenderer();
resize();

function getCamera(fov) {
  const camera = new PerspectiveCamera(
    fov ? fov : initialFov,
    renderer.domElement.width / renderer.domElement.height,
    0.1,
    100
  );
  cameras.push(camera);
  resize();
  return camera;
}

window.addEventListener("resize", () => {
  resize();
});

function onResize(fn) {
  resizeFns.push(fn);
  resize();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);

  for (const fn of resizeFns) {
    fn(w, h);
  }

  for (const camera of cameras) {
    if (camera instanceof PerspectiveCamera) {
      camera.aspect = w / h;
      if (w < h) {
        const initialAspect = 1;
        const horizontalFOV =
          2 *
          Math.atan(Math.tan((initialFov * Math.PI) / 180 / 2) * initialAspect);
        const newVFovRad =
          2 * Math.atan(Math.tan(horizontalFOV / 2) / camera.aspect);
        const newVFovDeg = newVFovRad * (180 / Math.PI);
        camera.fov = newVFovDeg;
      } else {
        camera.fov = initialFov;
      }
      camera.updateProjectionMatrix();
    }
    if (camera instanceof OrthographicCamera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
}

function render(fn) {
  requestAnimationFrame(() => render(fn));
  fn();
}

const camera = getCamera();
const controls = new OrbitControls(camera, renderer.domElement);

export {
  fromDefaults,
  getWebGLRenderer,
  getCamera,
  onResize,
  renderer,
  camera,
  controls,
  render,
};
