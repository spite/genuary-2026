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
  points: 1,
  range: [0, 0.25],
  scale: 1,
  roughness: 0.5,
  metalness: 0.25,
  offsetAngle: 0,
  offsetDistance: 0,
};

const params = fromDefaults(defaults);

const gui = new GUI(
  "3. Fibonacci forever",
  document.querySelector("#gui-container")
);
gui.addSlider("Points", params.points, 1, 250, 1);
gui.addRangeSlider("Range", params.range, 0, 1, 0.01);
gui.addSlider("Scale", params.scale, 0.1, 2, 0.01);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
gui.addSlider("Offset Angle", params.offsetAngle, 0, Math.PI * 2, 0.01);
gui.addSlider("Offset Distance", params.offsetDistance, 0, 2, 0.01);
gui.addButton("Random", randomize);
gui.addSeparator();
gui.addText(
  "<p>Press R to shuffle the objects.</p><p>Press Space to toggle rotation.</p><p>Press Tab to toggle this GUI.</p>"
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

const int INTEGRATION_STEPS = 25; 
const float TAU = 6.28318530718;

vec3 getPoint(float t) {
  float r = 1.;
  float a = t * TAU + offset;
  vec3 basePos = vec3(r * cos(a), r * sin(a), 0.);
  
  vec3 tangent = normalize(vec3(-sin(a), cos(a), 0.));
  vec3 binormal = vec3(0., 0., 1.); // Z-up for circle in XY plane
  vec3 normal = cross(binormal, tangent);
  
  float b = offsetAngle + a * frequency;
  vec3 offset = offsetDistance * (cos(b) * normal + sin(b) * binormal);
  
  return basePos + offset;
}

vec3 getTangent(float t) {
  float e = 0.0001;
  vec3 p1 = getPoint(t - e);
  vec3 p2 = getPoint(t + e);
  return normalize(p2 - p1);
}

mat3 axisAngleMatrix(vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    float t = 1.0 - c;
    
    return mat3(
        t * axis.x * axis.x + c,           t * axis.x * axis.y - axis.z * s,  t * axis.x * axis.z + axis.y * s,
        t * axis.x * axis.y + axis.z * s,  t * axis.y * axis.y + c,           t * axis.y * axis.z - axis.x * s,
        t * axis.x * axis.z - axis.y * s,  t * axis.y * axis.z + axis.x * s,  t * axis.z * axis.z + c
    );
}

vec3 deformPosition(vec3 pos) {
    float myT = (pos.z / meshLength) + 0.5;
    myT = (end - start) * myT + start;
    myT = clamp(myT, 0.0, 1.0);

    vec3 currentPos = getPoint(0.0);
    vec3 T = getTangent(0.0);
    
    vec3 up = vec3(0.0, 1.0, 0.0);
    
    if (abs(dot(T, up)) > 0.999) up = vec3(0.0, 0.0, 1.0);
    
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
                axis = normalize(axis);
                float dotVal = clamp(dot(T, T_next), -1.0, 1.0);
                float angle = acos(dotVal);
                
                mat3 rotMat = axisAngleMatrix(axis, angle);
                
                N = rotMat * N;
                B = rotMat * B;
            }

            N = N - dot(N, T_next) * T_next;
            N = normalize(N);            
            B = cross(T_next, N);
            
            T = T_next;
        }
        
        currentPos = getPoint(myT);
    }

    return currentPos + (N * pos.x * scale) + (B * pos.y * scale);
}

void calculate(in vec3 position, out vec3 newPos, out vec3 newNormal) {
    newPos = deformPosition(position);
    
    float e = 0.001;
    
    vec3 origNormal = normalize(normal);
    vec3 tangent1;
    if (abs(origNormal.x) < 0.9) {
        tangent1 = normalize(cross(origNormal, vec3(1.0, 0.0, 0.0)));
    } else {
        tangent1 = normalize(cross(origNormal, vec3(0.0, 1.0, 0.0)));
    }
    vec3 tangent2 = normalize(cross(origNormal, tangent1));
    
    vec3 p1 = deformPosition(position + tangent1 * e);
    vec3 p2 = deformPosition(position - tangent1 * e);
    vec3 p3 = deformPosition(position + tangent2 * e);
    vec3 p4 = deformPosition(position - tangent2 * e);
    
    vec3 deformedTangent1 = (p1 - p2) / (2.0 * e);
    vec3 deformedTangent2 = (p3 - p4) / (2.0 * e);
    
    newNormal = normalMatrix * normalize(cross(deformedTangent1, deformedTangent2));
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
  // const geometry = new RoundedCylinderGeometry(0.1, 100, 0.1, 5, 32, 100);
  // material.uniforms.meshLength.value = 100;
  // const geometry = new IcosahedronGeometry(0.1, res);
  // material.uniforms.meshLength.value = 0.2;
  // geometry.scale(1, 1, 1);
  const geometry = new TorusGeometry(0.1, 0.05, 64, 200);
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
  const levels = 7;
  const parts = 3;
  let d = 0;
  for (let i = 1; i < levels; i++) {
    const strands = fibonacci(i);
    const size = Maf.map(1, levels, 0.5, 0.5, i);
    const startAngle = Maf.PI / strands;
    const frequency = Maf.map(1, levels, 1, 2, i);
    const res = Math.round(Maf.map(1, levels, 10, 100, i));
    const offset = Maf.randomInRange(0, 1);
    for (let j = 0; j < strands; j++) {
      for (let k = 0; k < parts; k++) {
        const start = Maf.map(0, parts, 0, 1, k);
        const strand = generateStrand(
          d,
          startAngle + Maf.map(0, strands, 0, Maf.TAU, j),
          size,
          frequency,
          0, //start,
          0.25, //start + 1 / (2 * parts),
          gradient.getAt(Maf.map(1, levels - 1, 0, 1, i)),
          Maf.randomInRange(0, Maf.TAU),
          res
        );
        strandObjects.push({ strand });
      }
    }
    d += size / 5;
  }
}

// loadEnvironment();
init();

camera.position.set(0, 0, 1).multiplyScalar(10);
camera.lookAt(0, 0, 0);

function randomize() {}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});

render(() => {
  controls.update();

  const dt = clock.getDelta();
  // material.uniforms`.roughness.value = params.roughness();
  // material.uniforms.metalness.value = params.metalness();
  // material.uniforms.offsetAngle.value = params.offsetAngle();
  // material.uniforms.offsetDistance.value = params.offsetDistance();
  // material.uniforms.scale.value = params.scale();
  // material.uniforms.start.value = params.range()[0];
  // material.uniforms`.end.value = params.range()[1];

  if (running) {
    for (const strand of strandObjects) {
      const material = strand.strand.material;
      material.uniforms.offset.value += dt;

      material.uniforms.roughness.value = params.roughness();
      material.uniforms.metalness.value = params.metalness();
    }
  }

  renderer.render(scene, camera);
});
