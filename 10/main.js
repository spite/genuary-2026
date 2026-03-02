import {
  fromDefaults,
  renderer,
  camera,
  controls,
  render,
  running,
  clock,
  onResize,
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
  RawShaderMaterial,
  GLSL3,
  Vector2,
} from "three";
import { ShaderPass } from "modules/shader-pass.js";
import { getFBO } from "modules/fbo.js";

const polarHalftoneVertexShader = `
precision highp float;

in vec3 position;
in vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const polarHalftoneFragmentShader = `
precision highp float;

in vec2 vUv;

uniform sampler2D uTexture;
uniform float uRingThickness;
uniform float uMinContiguous;
uniform float uPhaseJitter;
uniform float uGrayscale;
uniform bool uRoundedCaps;
uniform float ucolorLevels;
uniform float uBrightness;
uniform float uContrast;
uniform float uTime;

out vec4 fragColor;

#define PI 3.14159265359
#define TAU 6.28318530718

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float getBrightness(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

vec3 getSample(float phi, float ringCenter, float segmentAngle, float aspect, vec2 center, float phaseOffset) {
  float phiIndex = floor((phi - phaseOffset + PI + 0.00001) / segmentAngle);
  float phiCenter = (phiIndex + 0.5) * segmentAngle - PI + phaseOffset;

  vec2 sampleP = vec2(cos(phiCenter), sin(phiCenter)) * ringCenter;
  sampleP.x /= aspect;
  vec2 sampleUv = sampleP + center;
  sampleUv = clamp(sampleUv, 0.0, 1.0);

  vec4 texColor = texture(uTexture, sampleUv);

  vec3 color;
  if (uGrayscale > 0.5) {
    color = texColor.rgb;
  } else {
    color = vec3(getBrightness(texColor.rgb));
  }

  color = (color - 0.5) * uContrast + 0.5 + uBrightness;
  color = clamp(color, 0.0, 1.0);

  if (ucolorLevels > 1.0) {
    color = floor(color * (ucolorLevels - 1.0) + 0.5) / (ucolorLevels - 1.0);
  }
  return color;
}

void main() {
  vec2 resolution = vec2(textureSize(uTexture, 0));
  vec2 uv = vUv;
  vec2 center = vec2(.5);
  float aspect = resolution.x / resolution.y;
  vec2 p = (uv - center);
  p.x *= aspect;

  float r = length(p);
  float phi = atan(p.y, p.x);

  float ringThicknessNorm = uRingThickness / resolution.y;
  float ringIndex = floor(r / ringThicknessNorm);
  float ringCenter = (ringIndex + 0.5) * ringThicknessNorm;

  float circumference = TAU * ringCenter;
  float targetSegmentLength = max(uRingThickness, uMinContiguous);
  float numSegments = max(1., floor(circumference / (targetSegmentLength / resolution.y)));
  float segmentAngle = TAU / numSegments;

  float phaseOffset = hash(ringIndex) * TAU * uPhaseJitter + uTime / 10.;
  float currentPhiIndex = floor((phi - phaseOffset + PI + 0.00001) / segmentAngle);
  vec3 finalColor = vec3(0.0);
  float maxAlpha = 0.0;

  for (int i = -1; i <= 1; i++) {
    float j = currentPhiIndex + float(i);
    float phiCenterOffset = (j + 0.5) * segmentAngle - PI + phaseOffset;

    vec3 col = getSample(phiCenterOffset, ringCenter, segmentAngle, aspect, center, phaseOffset);
    if (length(col) <= 0.) continue;

    float distArc = phi - phiCenterOffset;
    if (distArc > PI) distArc -= TAU;
    if (distArc < -PI) distArc += TAU;
    distArc *= ringCenter;

    float circleRadius = ringThicknessNorm * 0.5;
    float halfCircleLen = (segmentAngle * ringCenter) * 0.5;
    float dr = abs(r - ringCenter);
    float dist;

    if (uRoundedCaps) {
      vec3 colPrev = getSample(phiCenterOffset - segmentAngle, ringCenter, segmentAngle, aspect, center, phaseOffset);
      vec3 colNext = getSample(phiCenterOffset + segmentAngle, ringCenter, segmentAngle, aspect, center, phaseOffset);

      float hNeg = 0.;
      float hPos = 0.;

      if (distance(col, colPrev) > 0.001) {
        hNeg = max(0., -distArc - (halfCircleLen - circleRadius));
      } else {
        hNeg = max(0., -distArc - halfCircleLen);
      }

      if (distance(col, colNext) > 0.001) {
        hPos = max(0., distArc - (halfCircleLen - circleRadius));
      } else {
        hPos = max(0., distArc - halfCircleLen);
      }

      float h = max(hNeg, hPos);
      dist = length(vec2(dr, h)) - circleRadius;
    } else {
      dist = max(dr - ringThicknessNorm * .5, abs(distArc) - halfCircleLen);
    }

    float pixelSize = 1. / resolution.y;
    float alpha = 1. - smoothstep(-pixelSize, pixelSize, dist);

    if (alpha > maxAlpha) {
      maxAlpha = alpha;
      finalColor = col * alpha;
    }
  }

  fragColor = vec4(finalColor, 1.);
}
`;

const polarHalftoneUniforms = {
  uTexture: { value: null },
  uRingThickness: { value: 8.0 },
  uMinContiguous: { value: 8.0 },
  uPhaseJitter: { value: 0.5 },
  uGrayscale: { value: 1.0 },
  uRoundedCaps: { value: true },
  ucolorLevels: { value: 1.0 },
  uBrightness: { value: 0.0 },
  uContrast: { value: 1.0 },
  uTime: { value: 0 },
};

const polarHalftoneMaterial = new RawShaderMaterial({
  uniforms: polarHalftoneUniforms,
  vertexShader: polarHalftoneVertexShader,
  fragmentShader: polarHalftoneFragmentShader,
  glslVersion: GLSL3,
  depthTest: false,
});

const sceneFBO = getFBO(window.innerWidth, window.innerHeight, {
  depthBuffer: true,
});
const polarHalftonePass = new ShaderPass(polarHalftoneMaterial, {
  depthBuffer: false,
});

onResize((w, h) => {
  sceneFBO.setSize(w, h);
  polarHalftonePass.setSize(w, h);
});

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
  ringThickness: 8,
  minContiguous: 8,
  phaseJitter: 0.5,
  grayscale: true,
  roundedCaps: true,
  colorLevels: 1,
  brightness: 0.0,
  contrast: 1.0,
};

const params = fromDefaults(defaults);
const blendFactor = tweened(0, 1000);
const scaleFactor = tweened(0, 1000);

const colorFrom = new Color(Maf.randomElement(rainbow));
const colorTo = new Color(Maf.randomElement(rainbow));

const gui = new GUI(
  "10. Polar coordinates",
  document.querySelector("#gui-container"),
);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
gui.addSlider("Ring Thickness", params.ringThickness, 2, 40, 1);
gui.addSlider("Min Contiguous", params.minContiguous, 2, 400, 1);
// gui.addSlider("Phase Jitter", params.phaseJitter, 0, 1, 0.01);
gui.addCheckbox("Color", params.grayscale);
gui.addCheckbox("Rounded Caps", params.roundedCaps);
gui.addSlider("Color Levels", params.colorLevels, 1, 100, 1);
gui.addSlider("Brightness", params.brightness, -0.5, 0.5, 0.01);
gui.addSlider("Contrast", params.contrast, 0.1, 3, 0.01);
gui.addSeparator();
gui.addButton("Random", randomize);
gui.addText(
  "<p>Press <b>R</b> or <b>click</b> on screen to randomize colors and shapes.</p><p>Press <b>Space</b> to toggle rotation.</p><p>Press <b>Tab</b> to toggle this GUI.</p>",
);
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

  return mix(a, b, elasticOut(factor, 7., 13.));
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

      scaleFactor.set(1, 1000);
    },
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
    `,
  );

  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `
    #include <begin_vertex>
    
    transformed = newPosition;
    `,
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

  params.ringThickness.set(Maf.randomInRange(2, 20));
  params.minContiguous.set(Maf.randomInRange(2, 100));
  // params.phaseJitter.set(Math.random());
  params.grayscale.set(Math.random() < 0.85);
  params.roundedCaps.set(Math.random() < 0.5);
  params.colorLevels.set(Maf.intRandomInRange(10, 60));
  params.brightness.set(Maf.randomInRange(-0.25, 0.25));
  params.contrast.set(Maf.randomInRange(1, 2));
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});
document.querySelector("#randomize-button")?.addEventListener("click", () => {
  randomize();
});

let clickOnPlace = false;
const canvas = renderer.domElement;
canvas.addEventListener("pointerdown", () => {
  clickOnPlace = true;
});
canvas.addEventListener("pointermove", () => {
  clickOnPlace = false;
});
canvas.addEventListener("pointerup", () => {
  if (clickOnPlace) {
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
    Easings.OutCubic(blendFactor()),
  );
  uniforms.factor.value = blendFactor();

  mesh.scale.setScalar(Easings.OutElastic(scaleFactor()));

  if (running) {
    mesh.rotation.x += 0.5 * dt;
    mesh.rotation.y += 0.45 * dt;
    mesh.rotation.z += 0.55 * dt;
  }

  renderer.setClearColor(material.color);
  renderer.setRenderTarget(sceneFBO);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  polarHalftoneUniforms.uTexture.value = sceneFBO.texture;
  polarHalftoneUniforms.uRingThickness.value = params.ringThickness();
  polarHalftoneUniforms.uMinContiguous.value = params.minContiguous();
  polarHalftoneUniforms.uPhaseJitter.value = params.phaseJitter();
  polarHalftoneUniforms.uGrayscale.value = params.grayscale() ? 1.0 : 0.0;
  polarHalftoneUniforms.uRoundedCaps.value = params.roundedCaps();
  polarHalftoneUniforms.ucolorLevels.value = params.colorLevels();
  polarHalftoneUniforms.uBrightness.value = params.brightness();
  polarHalftoneUniforms.uContrast.value = params.contrast();
  // polarHalftoneUniforms.uTime.value += dt;
  polarHalftonePass.render(renderer, true);
});
