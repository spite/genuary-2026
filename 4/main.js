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
  PCFShadowMap,
  Data3DTexture,
  Vector2,
  LinearFilter,
  FloatType,
  RedFormat,
  Vector3,
  BoxGeometry,
  Matrix4,
  RawShaderMaterial,
  BackSide,
  GLSL3,
  DynamicDrawUsage,
  Object3D,
  EquirectangularReflectionMapping,
  NearestFilter,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  TorusGeometry,
  MeshStandardMaterial,
  InstancedMesh,
  DirectionalLight,
} from "three";
// import { Material, loadEnvMap } from "modules/material.js";
// import { RoundedCylinderGeometry } from "modules/rounded-cylinder-geometry.js";
import { GradientLinear } from "modules/gradient.js";
import { ImprovedNoise } from "third_party/ImprovedNoise.js";
import { RoundedBoxGeometry } from "third_party/three-rounded-box.js";
import { UltraHDRLoader } from "third_party/UltraHDRLoader.js";
import { sdTorus, sdIcosahedron } from "modules/raymarch.js";
import { TrefoilSDF } from "modules/TrefoilSDF.js";

const LEVELS = 7;

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
  shape: "perlin",
  geometry: "box",
  range: [0, LEVELS],
  gap: 0.02,
  speed: 1,
  roughness: 0.2,
  metalness: 0.5,
};

const params = fromDefaults(defaults);
const shapes = [
  { id: "perlin", name: "Perlin noise" },
  { id: "torus", name: "Torus" },
];
const geometries = [
  { id: "box", name: "Box" },
  { id: "rounded-box", name: "Rounded Box" },
  { id: "sphere", name: "Sphere" },
];

const gui = new GUI("4. Lowres", document.querySelector("#gui-container"));
gui.addSelect(
  "Shape",
  shapes.map((s) => [s.id, s.name]),
  params.shape
);
gui.addSelect(
  "Geometry",
  geometries.map((s) => [s.id, s.name]),
  params.geometry
);
gui.addRangeSlider("Range", params.range, 0, LEVELS, 1);
gui.addSlider("Gap", params.gap, 0, 0.5, 0.01);
gui.addSlider("Speed", params.speed, 0, 2, 0.01);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
gui.addButton("Random", randomize);
gui.addSeparator();
gui.addText(
  "<p>Press R to shuffle the objects.</p><p>Press Space to toggle rotation.</p><p>Press Tab to toggle this GUI.</p>"
);
gui.show();

const color = rainbow[rainbow.length - 1];
renderer.setClearColor(new Color(color));

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();
const group = new Group();
scene.add(group);

const light = new DirectionalLight(0xffffff, 3);
light.position.set(3, 6, 3);
light.castShadow = true;
light.shadow.camera.top = 1;
light.shadow.camera.bottom = -1;
light.shadow.camera.right = 1;
light.shadow.camera.left = -1;
light.shadow.mapSize.set(4096, 4096);
scene.add(light);

const hemiLight = new HemisphereLight(0xffffff, 0xffffff, 2);
hemiLight.color.setHSL(0.6, 1, 0.6);
hemiLight.groundColor.setHSL(0.095, 1, 0.75);
hemiLight.position.set(0, 50, 0);
scene.add(hemiLight);

const loader = new UltraHDRLoader();
loader.setDataType(FloatType);

function loadEnvironment(resolution = "2k", type = "HalfFloatType") {
  return new Promise((resolve) => {
    loader.load(
      `../assets/spruit_sunrise_${resolution}.hdr.jpg`,
      function (texture) {
        texture.mapping = EquirectangularReflectionMapping;
        texture.needsUpdate = true;

        resolve(texture);
      }
    );
  });
}

const envMap = await loadEnvironment();
const trefoil = new TrefoilSDF();

function blend(v) {
  const k = 9.5;
  const sum = v.reduce((ac, v) => ac + Math.exp(-k * v), 0);
  return -Math.log(sum) / k;
}

function sdSphere(p, r) {
  return p.length() - r;
}

const spheres = [];
const tmp = new Vector3();

function generateSpheres() {
  spheres.length = 0;
  for (let i = 0; i < 10; i++) {
    const s = 0.7;
    const radius = Maf.randomInRange(0.1, 0.3);
    const center = new Vector3(
      Maf.randomInRange(-s, s),
      Maf.randomInRange(-s, s),
      Maf.randomInRange(-s, s)
    );
    spheres.push({ center, radius });
  }
}
generateSpheres();

function generateBlob(p, offset) {
  const res = [];
  for (const sphere of spheres) {
    const c = sphere.center;
    tmp.copy(p).sub(c);
    res.push(sdSphere(tmp, sphere.radius + offset));
  }

  const d = blend(res);
  return d;
}

function blobMap(offset) {
  return (p) => {
    return generateBlob(p, offset);
  };
}
const fn = blobMap(0);

function createData(size, time) {
  let i = 0;
  const perlin = new ImprovedNoise();
  const vector = new Vector3();
  const data = [];
  const t = new Vector2(0.7, 0.25);
  const s = 2;
  const rot = new Matrix4().makeRotationZ(time);
  const rot2 = new Matrix4().makeRotationX(time * 0.8);
  rot.multiply(rot2);
  const e = 0.5 / size;
  for (let z = 0; z < size; z++) {
    data[z] = [];
    for (let y = 0; y < size; y++) {
      data[z][y] = [];
      for (let x = 0; x < size; x++) {
        data[z][y][x] = 0;
        vector
          .set(x, y, z)
          .divideScalar(size)
          .subScalar(0.5)
          .multiplyScalar(2)
          .applyMatrix4(rot);

        switch (params.shape()) {
          case "perlin": {
            const d = perlin.noise(
              vector.x * s + time,
              vector.y * s,
              vector.z * s
            );
            data[z][y][x] = d > 0 ? 1 : 0;
            break;
          }
          case "torus": {
            const d = sdTorus(vector, t);
            data[z][y][x] = d < e ? 1 : 0;
            break;
          }
        }
        // const d = fn(vector);
        // data[z][y][x] = d < e ? 1 : 0;

        // const d = trefoil.getDistance(vector.clone().multiplyScalar(3.5)) / 3.5;
        // data[z][y][x] = d < e ? 1 : 0;

        // const d = sdIcosahedron(vector, 0.9, 50);
        // data[z][y][x] = d < e ? 1 : 0;
      }
    }
  }
  return data;
}

class Level {
  constructor(level, size, color) {
    this.level = level;
    this.size = size;
    this.side = 2 ** (level - 1);
    this.cubes = this.side ** 3;

    const material = new MeshStandardMaterial({
      color,
      roughness: params.roughness(),
      metalness: params.metalness(),
      envMap: envMap,
      envMapIntensity: 1.0,
      flatShading: true,
    });

    this.scale = 1;

    const geometry = new BoxGeometry(this.size, this.size, this.size);
    const mesh = new InstancedMesh(geometry, material, this.cubes);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.mesh = mesh;
    mesh.position.set(
      -((this.side - 1) * this.size) / 2,
      -((this.side - 1) * this.size) / 2,
      -((this.side - 1) * this.size) / 2
    );

    const dummy = new Object3D();
    let i = 0;
    for (let z = 0; z < this.side; z++) {
      for (let y = 0; y < this.side; y++) {
        for (let x = 0; x < this.side; x++) {
          dummy.position.set(x, y, z).multiplyScalar(this.size);
          dummy.updateMatrix();
          mesh.setMatrixAt(i++, dummy.matrix);
        }
      }
    }
  }

  set gap(value) {
    const minSize = 1 / 2 ** (LEVELS - 1);
    this.scale = Math.max(0, 1 - (value * minSize) / this.size);
    const s = this.size * this.scale;
    let geometry;
    switch (params.geometry()) {
      case "box": {
        geometry = new BoxGeometry(s, s, s);
        this.mesh.material.flatShading = true;
        break;
      }
      case "rounded-box": {
        geometry = new RoundedBoxGeometry(s, s, s, 1, 0.0025);
        this.mesh.material.flatShading = true;
        break;
      }
      case "sphere": {
        geometry = new IcosahedronGeometry(s / 2, LEVELS + 1 - this.level);
        this.mesh.material.flatShading = false;
        break;
      }
    }

    this.mesh.material.needsUpdate = true;
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
  }

  sync(data) {
    const dummy = new Object3D();
    const valid = [];
    for (let z = 0; z < this.side; z++) {
      for (let y = 0; y < this.side; y++) {
        for (let x = 0; x < this.side; x++) {
          const value = data[z][y][x];
          if (value > 0) {
            valid.push({ x, y, z });
          }
        }
      }
    }
    let i = 0;
    for (const p of valid) {
      const { x, y, z } = p;
      dummy.position.set(x, y, z).multiplyScalar(this.size);
      // dummy.scale.set(this.scale, this.scale, this.scale);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i++, dummy.matrix);
    }
    this.mesh.count = valid.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function pyramid(data, size) {
  const newSize = size / 2;
  const res = [];
  for (let z = 0; z < newSize; z++) {
    res[z] = [];
    for (let y = 0; y < newSize; y++) {
      res[z][y] = [];
      for (let x = 0; x < newSize; x++) {
        const z0 = z * 2,
          z1 = z * 2 + 1;
        const y0 = y * 2,
          y1 = y * 2 + 1;
        const x0 = x * 2,
          x1 = x * 2 + 1;

        const v =
          data[z0][y0][x0] &&
          data[z0][y0][x1] &&
          data[z0][y1][x0] &&
          data[z0][y1][x1] &&
          data[z1][y0][x0] &&
          data[z1][y0][x1] &&
          data[z1][y1][x0] &&
          data[z1][y1][x1]
            ? 1
            : 0;

        res[z][y][x] = v;

        if (v > 0) {
          data[z0][y0][x0] = 0;
          data[z0][y0][x1] = 0;
          data[z0][y1][x0] = 0;
          data[z0][y1][x1] = 0;
          data[z1][y0][x0] = 0;
          data[z1][y0][x1] = 0;
          data[z1][y1][x0] = 0;
          data[z1][y1][x1] = 0;
        }
      }
    }
  }
  return res;
}

const size = 2 ** (LEVELS - 1);
const data = createData(size);
const pyramidData = [data];
let currentData = data;
let currentSize = size;
for (let level = LEVELS; level >= 2; level--) {
  currentData = pyramid(currentData, currentSize);
  currentSize /= 2;
  pyramidData.push(currentData);
}

const gradient = new GradientLinear(rainbow);
const levels = [];
for (let level = LEVELS; level >= 1; level--) {
  const levelObject = new Level(
    level,
    1 / 2 ** (level - 1),
    gradient.getAt(level / 8)
  );
  levelObject.sync(pyramidData[LEVELS - level]);
  group.add(levelObject.mesh);
  levels.push(levelObject);
}

function init() {}

init();

camera.position.set(1, 1, 1).multiplyScalar(3);
camera.lookAt(0, 0, 0);

function randomize() {}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});

let time = performance.now() / 1000;
render(() => {
  controls.update();

  const dt = clock.getDelta();

  if (running) {
    time += dt * params.speed();
    const data = createData(size, time);
    const pyramidData = [data];
    let currentData = data;
    let currentSize = size;
    for (let level = LEVELS; level >= 2; level--) {
      currentData = pyramid(currentData, currentSize);
      currentSize /= 2;
      pyramidData.push(currentData);
    }

    for (let level = LEVELS; level >= 1; level--) {
      const levelObject = levels[LEVELS - level];
      levelObject.sync(pyramidData[LEVELS - level]);
    }
  }

  for (const level of levels) {
    level.mesh.visible =
      level.level <= params.range()[1] && level.level >= params.range()[0];
    level.gap = params.gap();
  }

  renderer.render(scene, camera);
});
