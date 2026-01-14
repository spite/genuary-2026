import {
  fromDefaults,
  renderer,
  camera,
  controls,
  render,
  running,
  clock,
} from "common";
import { tweened } from "reactive";
import GUI from "gui";
import { UltraHDRLoader } from "third_party/UltraHDRLoader.js";
import { shader as raymarch } from "shaders/raymarch.js";
import { shader as sdfs } from "shaders/sdfs.js";
import { shader as easings } from "shaders/easings.js";
import { Easings } from "easings";
import {
  Scene,
  Mesh,
  Color,
  HemisphereLight,
  IcosahedronGeometry,
  DirectionalLight,
  MeshStandardMaterial,
  EquirectangularReflectionMapping,
  FloatType,
} from "three";

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
  roughness: 0.15,
  metalness: 0.5,
};

const params = fromDefaults(defaults);
const blendFactor = tweened(0, 1000);

const colorFrom = new Color(Maf.randomElement(rainbow));
const colorTo = new Color(Maf.randomElement(rainbow));

const gui = new GUI(
  "1. One color, one shape",
  document.querySelector("#gui-container")
);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
gui.addButton("Random", randomize);
gui.show();

const vertexShader = `

uniform int shapeFrom;
uniform int shapeTo;
uniform float factor;

${sdfs}
${easings}

float map(in vec3 p) {
  float a;
  float b;

  float r = .1;

  if(shapeFrom == 0 ) {
    a = sdRoundBox(p, vec3(0.4), r);
  } else if(shapeFrom == 1) {
    a = fDodecahedron(p, .6, 48.);
  } else if(shapeFrom == 2) {
    a = fIcosahedron(p, .6, 48.);
  } else if(shapeFrom == 3) {
    a = sdOctahedron(p, .7) - r;
  } else if(shapeFrom == 4) {
    a = sdTetrahedron(p, .4, r);
  }

   if(shapeTo == 0 ) {
    b = sdRoundBox(p, vec3(0.4), r);
  } else if(shapeTo == 1) {
    b = fDodecahedron(p, .6, 48.);
  } else if(shapeTo == 2) {
    b = fIcosahedron(p, .6, 48.);
  } else if(shapeTo == 3) {
    b = sdOctahedron(p, .7) - r;
  } else if(shapeTo == 4) {
    b = sdTetrahedron(p, .4, r);
  }

  return mix(a, b, elasticOut(factor, 5.));
}

${raymarch}

vec3 getNormal(vec3 p) {
  float d = map(p);
  vec2 e = vec2(.05, 0.0);
  
  vec3 n = d - vec3(
    map(p - e.xyy),
    map(p - e.yxy),
    map(p - e.yyx)
  );
  
  return normalize(n);
}

vec3 modify(vec3 position) {
  vec3 dir = normalize(position) * -1.;
  float d = march(position, dir);
  vec3 p = position + d * dir;
  return p;
}
  `;

const uniforms = {
  factor: { value: 0.0 },
  shapeFrom: { value: 0 },
  shapeTo: { value: 1 },
};

const material = new MeshStandardMaterial({
  color: Maf.randomElement(rainbow),
  metalness: 0.2,
  roughness: 0.2,
});

const loader = new UltraHDRLoader();
loader.setDataType(FloatType);

function loadEnvironment(resolution = "2k", type = "HalfFloatType") {
  loader.load(
    `../assets/spruit_sunrise_${resolution}.hdr.jpg`,
    function (texture) {
      texture.mapping = EquirectangularReflectionMapping;
      texture.needsUpdate = true;

      material.envMap = texture;
      material.envMapIntensity = 1.0;
      material.needsUpdate = true;
    }
  );
}

loadEnvironment();

material.onBeforeCompile = (shader) => {
  shader.uniforms.factor = uniforms.factor;
  shader.uniforms.shapeFrom = uniforms.shapeFrom;
  shader.uniforms.shapeTo = uniforms.shapeTo;
  shader.vertexShader = vertexShader + shader.vertexShader;

  shader.vertexShader = shader.vertexShader.replace(
    `#include <beginnormal_vertex>`,
    `
    #include <beginnormal_vertex>

    vec3 newPosition = modify(position);
    objectNormal = getNormal(newPosition);
    `
  );

  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `
    #include <begin_vertex>
    
    transformed = newPosition;
    `
  );
};

const scene = new Scene();
const mesh = new Mesh(new IcosahedronGeometry(2, 30), material);
scene.add(mesh);

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

camera.position.set(1, 1, 1).multiplyScalar(2);
camera.lookAt(0, 0, 0);

function randomize() {
  colorFrom.copy(colorTo);
  do {
    colorTo.set(Maf.randomElement(rainbow));
  } while (colorTo.equals(colorFrom));
  uniforms.shapeFrom.value = uniforms.shapeTo.value;
  do {
    uniforms.shapeTo.value = Maf.intRandomInRange(0, 5);
  } while (uniforms.shapeTo.value === uniforms.shapeFrom.value);
  blendFactor.reset(0);
  blendFactor.set(1, 1000);
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});

render(() => {
  controls.update();

  const dt = clock.getDelta();

  material.roughness = params.roughness();
  material.metalness = params.metalness();
  material.color.lerpColors(
    colorFrom,
    colorTo,
    Easings.OutCubic(blendFactor())
  );
  renderer.setClearColor(material.color);
  uniforms.factor.value = blendFactor();

  if (running) {
    mesh.rotation.x += 0.5 * dt;
    mesh.rotation.y += 0.45 * dt;
    mesh.rotation.z += 0.55 * dt;
  }

  renderer.render(scene, camera);
});
