import {
  fromDefaults,
  renderer,
  camera,
  controls,
  render,
  composer,
  running,
  clock,
} from "common";
import GUI from "gui";
import {
  Scene,
  CanvasTexture,
  Mesh,
  Color,
  GLSL3,
  Vector2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  RawShaderMaterial,
  RepeatWrapping,
  DirectionalLight,
} from "three";
import { Material, loadEnvMap } from "modules/material.js";
import { ShaderTexture } from "modules/ShaderTexture.js";
import { shader as heightMapToNormal } from "shaders/heightmap-to-normal.js";
import { shader as triplanar } from "shaders/triplanar.js";
import { shader as raymarch } from "shaders/raymarch.js";
import { shader as sdfs } from "shaders/sdfs.js";
import { shader as easings } from "shaders/easings.js";
import { tweened, effect, effectRAF } from "reactive";
import { shader as perlin } from "shaders/perlinClassic3D.js";
import { Easings } from "easings";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

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
  fingerprints: 100,
  scale: 1,
  roughness: 0.25,
  metalness: 0.5,
  lights: true,
};

const blendFactor = tweened(0, 1000);
const lightsFactor = tweened(0, 100);

const colorFrom = new Color(Maf.randomElement(rainbow));
const colorTo = new Color(Maf.randomElement(rainbow));

const params = fromDefaults(defaults);

const gui = new GUI(
  "6. Lights on/off",
  document.querySelector("#gui-container")
);
gui.addCheckbox("Lights", params.lights);
gui.addSlider("Fingerprints", params.fingerprints, 0, 1000, 1);
gui.addSlider("Scale", params.scale, 0.1, 2, 0.01);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
gui.addButton("Random", randomize);
gui.addSeparator();
gui.addText(
  "<p>Press R to randomize the object.</p><p>Press Space to toggle UV light.</p><p>Press Tab to toggle this GUI.</p>"
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

const fingerprints = new Image();
fingerprints.src = "../assets/fingerprints.jpg";
await new Promise((resolve, reject) => {
  fingerprints.addEventListener("load", (e) => {
    resolve();
  });
});

function generateMap() {
  console.log("MAP");
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "0"; //#808080";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const fingerprintWidth = fingerprints.width / 4;
  const fingerPrintHeight = fingerprints.height / 2;

  for (let i = 0; i < params.fingerprints(); i++) {
    const srcX = Maf.intRandomInRange(0, 4) * fingerprintWidth;
    const srcY = Maf.intRandomInRange(0, 4) * fingerPrintHeight;
    const posX = Maf.randomInRange(0, canvas.width);
    const posY = Maf.randomInRange(0, canvas.height);
    const rot = Maf.randomInRange(0, Maf.TAU);

    const s = Maf.randomInRange(0.2, 0.5) * 2 * params.scale();
    const w = fingerprintWidth * s;
    const h = fingerPrintHeight * s;

    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = "lighten";
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        ctx.save();
        ctx.translate(posX + x * canvas.width, posY + y * canvas.height);
        ctx.rotate(rot);
        ctx.drawImage(
          fingerprints,
          srcX,
          srcY,
          fingerprintWidth,
          fingerPrintHeight,
          -0.5 * w,
          -0.5 * h,
          w,
          h
        );
        ctx.restore();
      }
    }
  }

  return canvas;
}

function createNormalMap(albedo) {
  const vs = `precision highp float;
in vec3 position;
in vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec2 vUv;
out vec3 vPosition;

void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vPosition = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}`;

  const fs = `precision highp float;

uniform sampler2D depth;

in vec2 vUv;

out vec4 fragColor;

${heightMapToNormal}

void main() {
  vec4 n = heightToNormal(depth, vUv, 1., 1., 1., 1., 0);
  fragColor = n;
}`;

  const shader = new RawShaderMaterial({
    uniforms: {
      depth: { value: albedo },
    },
    vertexShader: vs,
    fragmentShader: fs,
    glslVersion: GLSL3,
  });
  return new ShaderTexture(renderer, shader, 1, 1);
}

const vertexShader = `
precision highp float;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec3 vPosition;
out vec3 vViewPosition;
out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUv;

${sdfs}
${easings}
${perlin}

uniform int shapeFrom;
uniform int shapeTo;
uniform float factor;

float bias(float t, float b) {
    return t / ((1.0 / b - 2.0) * (1.0 - t) + 1.0);
}

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

  float d = .1 + .9 * ( cnoise(p / 1.) * .5 + .5 );
  float f = bias(factor, d);

  return mix(a, b, elasticOut(f, 7., 13.));
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

void main() {
    vUv = uv;
    vec3 p = modify(position);
    vec3 n = getNormal(p);
    vPosition = p;
    vec4 worldPos = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPos.xyz;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormal = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * mvPosition;
} `;

const main = `
${triplanar}

uniform bool lights_on;
uniform vec3 uvColor;
uniform float uvLightIntensity;

void main() { 

    mat3 viewMatrixInverse = mat3(inverse(viewMatrix));
    vec3 worldNormal = normalize(viewMatrixInverse * vNormal);

    if(lights_on) {
      float r = roughness;
      float m = metalness;

      if (hasNormalMap) {
          vec3 mapN = triplanarTexture(vPosition, worldNormal, normalMap, 1.).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          worldNormal = perturbNormal2Arb(vWorldPosition, worldNormal, vUv, mapN);
      } 
      if (hasRoughnessMap) {
          vec4 texColor = triplanarTexture(vPosition, worldNormal, roughnessMap, 1.);
          r += texColor.r;
      }
      if (hasMetalnessMap) {
          vec4 texColor = triplanarTexture(vPosition, worldNormal, metalnessMap, 1.);
          m += texColor.r;
      }
      vec4 diffuseColor = vec4(color, 1.0);
      if (hasMap) {
          vec4 texColor = triplanarTexture(vPosition, worldNormal, map, 1.);
          texColor = pow(texColor, vec4(2.2)); 
          diffuseColor *= texColor;
      }

      vec3 outgoingLight = shade(vWorldPosition, worldNormal, vUv, diffuseColor, r, m) ;
      outgoingLight = ACESFilmicToneMapping(outgoingLight);
      fragColor = linearToSRGB(vec4(outgoingLight, 1.0));
  } else {
      vec4 diffuseColor = vec4(uvColor, 1.0);
      vec3 outgoingLight = diffuseColor.rgb * triplanarTexture(vPosition, worldNormal, map, 1.).rgb * 10. * uvLightIntensity;
      outgoingLight = pow(outgoingLight, vec3(2.2)); 
      outgoingLight = ACESFilmicToneMapping(outgoingLight);
      fragColor = linearToSRGB(vec4(outgoingLight, 1.0));
  }
}
`;

let mesh;

const material = new Material({
  vertexShader,
  main,
  uniforms: {
    color: new Color(rainbow[2]),
    roughness: 0.2,
    metalness: 0.5,
    map: null,
    hasMap: false,
    normalMap: null,
    hasNormalMap: false,
    normalScale: new Vector2(0.5, 0.5),
    roughnessMap: null,
    hasRoughnessMap: false,
    metalnessMap: null,
    hasMetalnessMap: false,
  },
  customUniforms: {
    lights_on: { value: true },
    shapeFrom: { value: 0 },
    shapeTo: { value: 1 },
    factor: { value: 0 },
    uvColor: { value: new Color(rainbow[5]) },
    uvLightIntensity: { value: 0 },
  },
});

async function init() {
  const envMap = await loadEnvMap(
    `../assets/spruit_sunrise_2k.hdr.jpg`,
    renderer
  );

  material.envMap = envMap;
  material.syncLights(scene);
  material.syncRenderer(renderer);

  mesh = new Mesh(new IcosahedronGeometry(2, 50), material);
  scene.add(mesh);
}

init();

camera.position.set(1, 0.6, 1).multiplyScalar(2);
camera.lookAt(0, 0, 0);

function randomize() {
  colorFrom.copy(colorTo);
  do {
    colorTo.set(Maf.randomElement(rainbow));
  } while (colorTo.equals(colorFrom));
  mesh.material.uniforms.shapeFrom.value = mesh.material.uniforms.shapeTo.value;
  do {
    mesh.material.uniforms.shapeTo.value = Maf.intRandomInRange(0, 5);
  } while (
    mesh.material.uniforms.shapeTo.value ===
    mesh.material.uniforms.shapeFrom.value
  );
  blendFactor.reset(0);
  blendFactor.set(1, 1000);

  params.fingerprints.set(Maf.intRandomInRange(100, 500));
  params.scale.set(Maf.randomInRange(0.8, 1.2));
}

effect(() => {
  const l = params.lights();
  if (l) {
    lightsFactor.set(1, 100);
  } else {
    lightsFactor.set(0, 100);
  }
});

effectRAF(() => {
  const albedo = generateMap();
  const map = new CanvasTexture(albedo);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const normalMap = createNormalMap(map);
  normalMap.setSize(albedo.width, albedo.height);
  normalMap.render();
  normalMap.fbo.texture.wrapS = normalMap.fbo.texture.wrapT = RepeatWrapping;
  normalMap.fbo.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  material.uniforms.map.value = map;
  material.uniforms.hasMap.value = false;

  material.uniforms.normalMap.value = normalMap.fbo.texture;
  material.uniforms.hasNormalMap.value = true;

  material.uniforms.roughnessMap.value = map;
  material.uniforms.hasRoughnessMap.value = true;
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
  if (e.code === "Space") {
    params.lights.set(!params.lights());
  }
});
document.querySelector("#randomize-button")?.addEventListener("click", () => {
  randomize();
});

const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
  new Vector2(window.innerWidth, window.innerHeight),
  0,
  0,
  0
);
bloomPass.threshold = 0;
bloomPass.strength = 0.5;
bloomPass.radius = 0.1;

const outputPass = new OutputPass();

composer.addPass(renderScene);
composer.addPass(bloomPass);
composer.addPass(outputPass);

const black = new Color(0);
const bkgColor = new Color();

render(() => {
  controls.update();

  const dt = clock.getDelta();

  if (mesh) {
    mesh.material.uniforms.factor.value = blendFactor();
    mesh.material.uniforms.lights_on.value = params.lights();
    mesh.material.uniforms.roughness.value = params.roughness();
    mesh.material.uniforms.metalness.value = params.metalness();
    mesh.material.uniforms.color.value.lerpColors(
      colorFrom,
      colorTo,
      Easings.OutCubic(blendFactor())
    );
    renderer.setClearColor(
      params.lights() ? mesh.material.uniforms.color.value : black
    );
    mesh.material.uniforms.uvLightIntensity.value = 1 - lightsFactor();
  }

  bloomPass.radius = 0.1;
  bloomPass.strength = 0.5;

  if (params.lights()) {
    renderer.render(scene, camera);
  } else {
    composer.render();
  }
});
