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
import { RoundedCylinderGeometry } from "modules/rounded-cylinder-geometry.js";
import {
  Scene,
  Mesh,
  Color,
  Vector3,
  HemisphereLight,
  CylinderGeometry,
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
  range: [0, 1],
  scale: 1,
  factor: 0,
  roughness: 0.15,
  metalness: 0.5,
};

const params = fromDefaults(defaults);
const progress = tweened(0, 1000);

const colorFrom = new Color(Maf.randomElement(rainbow));
const colorTo = new Color(Maf.randomElement(rainbow));

const gui = new GUI(
  "2. Twelve principles of animation",
  document.querySelector("#gui-container")
);
gui.addRangeSlider("Range", params.range, 0, 1, 0.01);
gui.addSlider("Scale", params.scale, 0.1, 2, 0.01);
gui.addSlider("Factor", params.factor, 0, 1, 0.01);
gui.addSlider("Roughness", params.roughness, 0, 1, 0.01);
gui.addSlider("Metalness", params.metalness, 0, 1, 0.01);
gui.addButton("Random", randomize);
gui.addSeparator();
gui.addText(
  "<p>Press R to randomize colors and shapes.</p><p>Press Space to toggle rotation.</p><p>Press Tab to toggle this GUI.</p>"
);
gui.show();

const vertexShader = `

uniform float start;
uniform float end;
uniform float scale;
uniform float meshLength;
uniform vec3 pathPoint0;
uniform vec3 pathPoint1;
uniform vec3 pathPoint2;
uniform vec3 pathPoint3;

const int INTEGRATION_STEPS = 25; 

vec3 getBezierPoint(float t, vec3 p0, vec3 p1, vec3 p2, vec3 p3) {
  float u = 1.0 - t;
  float tt = t * t;
  float uu = u * u;
  float uuu = uu * u;
  float ttt = tt * t;

  vec3 p = uuu * p0; 
  p += 3.0 * uu * t * p1; 
  p += 3.0 * u * tt * p2; 
  p += ttt * p3;
  return p;
}

vec3 getBezierTangent(float t, vec3 p0, vec3 p1, vec3 p2, vec3 p3) {
  float u = 1.0 - t;
  return normalize(3.0 * u * u * (p1 - p0) + 
                    6.0 * u * t * (p2 - p1) + 
                    3.0 * t * t * (p3 - p2));
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

void calculate(in vec3 position, out vec3 newPos, out vec3 newNormal) {
    
    float myT = (position.z / meshLength) + 0.5;
    myT = (end - start) * myT + start;
    myT = clamp(myT, 0.0, 1.0);

    vec3 currentPos = getBezierPoint(0.0, pathPoint0, pathPoint1, pathPoint2, pathPoint3);
    vec3 T = getBezierTangent(0.0, pathPoint0, pathPoint1, pathPoint2, pathPoint3);
    
    vec3 up = vec3(0.0, 1.0, 0.0);
    
    if (abs(dot(T, up)) > 0.999) up = vec3(0.0, 0.0, 1.0);
    
    vec3 B = normalize(cross(T, up));
    vec3 N = normalize(cross(B, T));

    if (myT > 0.0001) {
        float dt = myT / float(INTEGRATION_STEPS);
        
        for (int i = 1; i <= INTEGRATION_STEPS; i++) {
            float t_next = float(i) * dt;
            
            vec3 T_next = getBezierTangent(t_next, pathPoint0, pathPoint1, pathPoint2, pathPoint3);
            
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
        
        currentPos = getBezierPoint(myT, pathPoint0, pathPoint1, pathPoint2, pathPoint3);
    }

    newPos = currentPos + (N * position.x * scale) + (B * position.y * scale);

    mat3 frameRotation = mat3(N, B, T);
    newNormal = normalMatrix * (frameRotation * normal);
}
  
void modify(in vec3 position, out vec3 newPos, out vec3 normal) {
  calculate(position, newPos, normal);
}
  `;

const uniforms = {
  start: { value: 0.0 },
  end: { value: 1.0 },
  scale: { value: 1.0 },
  pathPoint0: { value: new Vector3(-1, 0, 0) },
  pathPoint1: { value: new Vector3(-0.5, 1.5, 0) },
  pathPoint2: { value: new Vector3(2, 1.5, 0) },
  pathPoint3: { value: new Vector3(1, 0, 0) },
  meshLength: { value: 100.0 },
};

const material = new MeshStandardMaterial({
  color: Maf.randomElement(rainbow),
  metalness: 0.2,
  roughness: 0.2,
  //wireframe: true,
});
renderer.setClearColor(material.color);

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
  shader.uniforms.start = uniforms.start;
  shader.uniforms.end = uniforms.end;
  shader.uniforms.scale = uniforms.scale;
  shader.uniforms.pathPoint0 = uniforms.pathPoint0;
  shader.uniforms.pathPoint1 = uniforms.pathPoint1;
  shader.uniforms.pathPoint2 = uniforms.pathPoint2;
  shader.uniforms.pathPoint3 = uniforms.pathPoint3;
  shader.uniforms.meshLength = uniforms.meshLength;
  shader.vertexShader = vertexShader + shader.vertexShader;

  shader.vertexShader = shader.vertexShader.replace(
    `#include <beginnormal_vertex>`,
    `
    #include <beginnormal_vertex>

    vec3 newPosition;
    modify(position, newPosition, objectNormal);
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
const mesh = new Mesh(
  new RoundedCylinderGeometry(0.2, 100, 0.01, 5, 32, 100),
  material
);
mesh.geometry.rotateX(Math.PI / 2);
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

camera.position.set(0, 0, 1).multiplyScalar(3);
camera.lookAt(0, 0, 0);

function randomize() {
  const mid = new Vector3(
    Maf.randomInRange(-1, 1),
    Maf.randomInRange(-1, 1),
    Maf.randomInRange(-1, 1)
  )
    .normalize()
    .multiplyScalar(1);

  const target = new Vector3(
    Maf.randomInRange(-1, 1),
    Maf.randomInRange(-1, 1),
    Maf.randomInRange(-1, 1)
  )
    .normalize()
    .multiplyScalar(2);

  const mid2 = new Vector3(
    Maf.randomInRange(-1, 1),
    Maf.randomInRange(-1, 1),
    Maf.randomInRange(-1, 1)
  )
    .normalize()
    .multiplyScalar(1);

  uniforms.pathPoint0.value.copy(uniforms.pathPoint3.value);
  uniforms.pathPoint2.value.copy(mid);

  uniforms.pathPoint2.value
    .copy(target)
    .multiplyScalar(Maf.randomInRange(0.1, 0.7));
  uniforms.pathPoint3.value.copy(target);

  progress.reset(0);
  progress.set(1, 100);
}

const sphere = new Mesh(
  new IcosahedronGeometry(2, 10),
  new MeshStandardMaterial({ wireframe: true })
);
// scene.add(sphere);

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") {
    randomize();
  }
});

render(() => {
  controls.update();

  const dt = clock.getDelta();

  params.factor.set(progress());

  const t = Easings.OutBounce(params.factor());
  const minLength = 0.01;
  const length = Math.max(minLength, Maf.parabola(t, 1) * 0.25);

  params.scale.set(1 - 0.7 * Maf.parabola(Easings.InOutCubic(t), 0.1));
  params.range.set([t * (1 - minLength), t + length]);

  uniforms.start.value = params.range()[0];
  uniforms.end.value = params.range()[1];
  uniforms.scale.value = params.scale();
  material.roughness = params.roughness();
  material.metalness = params.metalness();
  // material.color.lerpColors(colorFrom, colorTo, Easings.OutCubic(progress()));
  // renderer.setClearColor(material.color);

  if (running) {
    // mesh.rotation.x += 0.5 * dt;
    // mesh.rotation.y += 0.45 * dt;
    // mesh.rotation.z += 0.55 * dt;
  }

  renderer.render(scene, camera);
});
