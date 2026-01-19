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
  Vector3,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  TorusGeometry,
  DirectionalLight,
} from "three";
import { Material, loadEnvMap } from "modules/material.js";
import { RoundedCylinderGeometry } from "modules/rounded-cylinder-geometry.js";
import { GradientLinear } from "modules/gradient.js";

const levels = 8;

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

const ocean = [
  "#e0f2fe",
  "#bae6fd",
  "#7dd3fc",
  "#38bdf8",
  "#0ea5e9",
  "#0284c7",
  "#0369a1",
  "#075985",
  "#0c4a6e",
  "#1e3a8a",
];

const defaults = {
  seed: 1337,
  levels: levels,
  innerSize: 0.5,
  outerSize: 0.5,
  innerStart: 0,
  outerStart: 0,
  innerLength: 0.5,
  outerLength: 0.5,
  innerFrequency: 1,
  outerFrequency: 2,
  roughness: 0.1,
  metalness: 0.7,
  offsetAngle: 0,
  offsetDistance: 0,
};

const params = fromDefaults(defaults);

const gui = new GUI(
  "3. Fibonacci forever",
  document.querySelector("#gui-container")
);
gui.addSlider("Levels", params.levels, 1, levels, 1, (levels) => {
  for (const strand of strandObjects) {
    strand.mesh.visible = strand.level <= levels;
  }
});
gui.addSlider("Inner size", params.innerSize, 0.1, 2, 0.01);
gui.addSlider("Outer size", params.outerSize, 0.1, 2, 0.01);
gui.addSlider("Inner start", params.innerStart, 0, 0.5, 0.01);
gui.addSlider("Outer start", params.outerStart, 0, 0.5, 0.01);
gui.addSlider("Inner length", params.innerLength, 0.01, 0.5, 0.01);
gui.addSlider("Outer length", params.outerLength, 0.01, 0.5, 0.01);
gui.addSlider("Inner frequency", params.innerFrequency, 0, 5, 0.01);
gui.addSlider("Outer frequency", params.outerFrequency, 0, 5, 0.01);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
// gui.addSlider("Offset Angle", params.offsetAngle, 0, Math.PI * 2, 0.01);
// gui.addSlider("Offset Distance", params.offsetDistance, 0, 2, 0.01);
gui.addButton("Random", randomize);
gui.addSeparator();
gui.addText(
  "<p>Press <b>R</b> to randomize the parameters.</p><p>Press <b>Space</b> to toggle the animation.</p><p>Press <b>Tab</b> to toggle this GUI.</p>"
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

const vertexShader = `
precision highp float;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec3 vViewPosition;
out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUv;

uniform float start;
uniform float end;
uniform float scale;
uniform float meshLength;
uniform vec3 pathPoint0;
uniform vec3 pathPoint1;
uniform vec3 pathPoint2;
uniform vec3 pathPoint3;
uniform float offsetAngle;
uniform float offsetDistance;
uniform float frequency;
uniform float offset;

const int INTEGRATION_STEPS = 12;
const float TAU = 6.28318530718;

vec3 getPoint(float t) {
  float a = t * TAU + offset;
  float ca = cos(a);
  float sa = sin(a);
  vec3 basePos = vec3(ca, sa, 0.);
  
  vec3 tangent = vec3(-sa, ca, 0.);
  vec3 n = vec3(ca, sa, 0.);  // normal points outward from circle center
  
  float b = offsetAngle + a * frequency;
  vec3 off = offsetDistance * (cos(b) * n + sin(b) * vec3(0., 0., 1.));
  
  return basePos + off;
}

vec3 getTangent(float t) {
  float e = 0.0001;
  return normalize(getPoint(t + e) - getPoint(t - e));
}

// mat3 axisAngleMatrix(vec3 axis, float angle) {
//     float c = cos(angle);
//     float s = sin(angle);
//     float t = 1.0 - c;
    
//     return mat3(
//         t * axis.x * axis.x + c,           t * axis.x * axis.y - axis.z * s,  t * axis.x * axis.z + axis.y * s,
//         t * axis.x * axis.y + axis.z * s,  t * axis.y * axis.y + c,           t * axis.y * axis.z - axis.x * s,
//         t * axis.x * axis.z - axis.y * s,  t * axis.y * axis.z + axis.x * s,  t * axis.z * axis.z + c
//     );
// }

vec3 rotateAround(vec3 v, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

vec3 deformWithFrame(vec3 pos, out vec3 outN, out vec3 outB) {
    float myT = (pos.z / meshLength) + 0.5;
    myT = (end - start) * myT + start;
    // myT = clamp(myT, 0.0, 1.0);
    myT = mod(myT, 1.0);

    vec3 T = getTangent(0.0);
    
    vec3 up = vec3(0.0, 0.0, 1.0);
    if (abs(dot(T, up)) > 0.999) up = vec3(0.0, 1.0, 0.0);
    
    vec3 B = normalize(cross(T, up));
    vec3 N = normalize(cross(B, T));

    if (myT > 0.0001) {
        float dt = myT / float(INTEGRATION_STEPS);
        
        for (int i = 1; i <= INTEGRATION_STEPS; i++) {
            float t_next = float(i) * dt;
            vec3 T_next = getTangent(t_next);
            
            vec3 axis = cross(T, T_next);
            float len = length(axis);
            
            if (len > 0.00001) {
                axis /= len;  // normalize
                float angle = asin(clamp(len, -1.0, 1.0));  // small angle: asin(len) ≈ angle
                
                N = rotateAround(N, axis, angle);
                B = rotateAround(B, axis, angle);
            }

            N = normalize(N - dot(N, T_next) * T_next);
            B = cross(T_next, N);
            T = T_next;
        }
    }

    outN = N;
    outB = B;
    return getPoint(myT) + (N * pos.x * scale) + (B * pos.y * scale);
}

void calculate(in vec3 position, out vec3 newPos, out vec3 newNormal) {
    vec3 N, B;
    newPos = deformWithFrame(position, N, B);
    vec3 origNormal = normalize(normal);
    newNormal = normalMatrix * normalize(origNormal.x * N + origNormal.y * B);
}

void main() {
    vUv = uv;
    
    vec3 newPos;
    vec3 newNormal;
    calculate(position, newPos, newNormal);
    
    vec4 worldPos = modelMatrix * vec4(newPos, 1.0);
    vWorldPosition = worldPos.xyz;
    vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormal = normalize(newNormal);
    gl_Position = projectionMatrix * mvPosition;
} `;

const envMap = await loadEnvMap(
  `../assets/spruit_sunrise_2k.hdr.jpg`,
  renderer
);

function generateStrand(
  distance,
  angle,
  size,
  frequency,
  start,
  end,
  color,
  offset,
  res
) {
  const material = new Material({
    vertexShader,
    uniforms: { color: new Color(color), roughness: 0.2, metalness: 0.5 },
    customUniforms: {
      scale: { value: size },
      start: { value: start },
      end: { value: end },
      meshLength: { value: 1 },
      offset: { value: offset },
      offsetAngle: { value: angle },
      offsetDistance: { value: distance },
      frequency: { value: frequency },
    },
  });
  material.envMap = envMap;
  material.syncLights(scene);
  material.syncRenderer(renderer);
  // const geometry = new IcosahedronGeometry(
  //   0.1,
  //   Math.round(Maf.map(0, 1, 1, 20, res))
  // );
  // material.uniforms.meshLength.value = 0.2;
  // geometry.scale(1, 1, 1);
  const geometry = new TorusGeometry(
    0.1,
    0.05,
    64,
    Math.round(Maf.map(0, 1, 100, 300, res))
  );
  geometry.scale(1.5, 1, 1);
  material.uniforms.meshLength.value = 0.3;
  geometry.rotateX(Math.PI / 2);

  const mesh = new Mesh(geometry, material);
  scene.add(mesh);

  return mesh;
}

function fibonacci(num) {
  if (num <= 1) return 1;
  return fibonacci(num - 1) + fibonacci(num - 2);
}

const strandObjects = [];

function init() {
  const gradient = new GradientLinear(rainbow);
  let d = 0;
  for (let i = 1; i < levels; i++) {
    const strands = fibonacci(i);
    const size = Maf.map(1, levels, 0.5, 0.5, i);
    const startAngle = Maf.PI / strands;
    const frequency = Maf.map(1, levels, 1, 2, i);
    const res = Maf.map(1, levels, 0, 1, i);
    for (let j = 0; j < strands; j++) {
      const strand = generateStrand(
        d,
        startAngle + Maf.map(0, strands, 0, Maf.TAU, j),
        size,
        frequency,
        0,
        0.1,
        gradient.getAt(Maf.map(1, levels - 1, 0, 1, i)),
        Maf.randomInRange(0, Maf.TAU),
        res
      );
      strandObjects.push({ mesh: strand, level: i, strand: j });
    }
    d += size / 5;
  }
}

init();

function updateParams() {
  for (const strand of strandObjects) {
    const scale = Maf.map(
      1,
      levels,
      params.innerSize(),
      params.outerSize(),
      strand.level
    );
    strand.mesh.material.uniforms.scale.value = scale;

    const start = Maf.map(
      1,
      levels,
      params.innerStart(),
      params.outerStart(),
      strand.level
    );
    strand.mesh.material.uniforms.start.value = start;

    const length = Maf.map(
      1,
      levels,
      params.innerLength(),
      params.outerLength(),
      strand.level
    );
    strand.mesh.material.uniforms.end.value = start + length;

    const frequency = Maf.map(
      1,
      levels,
      params.innerFrequency(),
      params.outerFrequency(),
      strand.level
    );
    strand.mesh.material.uniforms.frequency.value = frequency;
  }
}

camera.position.set(0.5, -0.5, 1).multiplyScalar(5);
camera.lookAt(0, 0, 0);

function randomize() {
  params.innerSize.set(Maf.randomInRange(0.1, 2));
  params.outerSize.set(Maf.randomInRange(0.1, 2));
  params.innerStart.set(Maf.randomInRange(0, 0.5));
  params.outerStart.set(Maf.randomInRange(0, 0.5));
  params.innerLength.set(Maf.randomInRange(0.1, 0.5));
  params.outerLength.set(Maf.randomInRange(0.1, 0.5));
  params.innerFrequency.set(Math.round(Maf.randomInRange(0, 5)));
  params.outerFrequency.set(Math.round(Maf.randomInRange(0, 5)));
  params.offsetAngle.set(Maf.randomInRange(0, Maf.TAU));
  params.offsetDistance.set(Maf.randomInRange(0, 1));
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});

render(() => {
  controls.update();

  const dt = clock.getDelta();
  updateParams();

  for (const strand of strandObjects) {
    const material = strand.mesh.material;
    if (running) {
      material.uniforms.offset.value += dt;
    }

    material.uniforms.roughness.value = params.roughness();
    material.uniforms.metalness.value = params.metalness();
  }

  renderer.render(scene, camera);
});
