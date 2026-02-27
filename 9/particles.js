import {
  RawShaderMaterial,
  GLSL3,
  Vector2,
  InstancedMesh,
  PlaneGeometry,
  Object3D,
  Mesh,
  IcosahedronGeometry,
  Color,
  HalfFloatType,
  RepeatWrapping,
} from "three";
import { Material } from "modules/material.js";
import { ShaderPass } from "modules/shader-pass.js";
import { shader as orthoVS } from "shaders/ortho-vs.js";

const fragmentShader = `
precision highp float;

in vec2 vDisc;
in float vTrail;
in float vDepth;
in vec2 vUv;
in float vLife;

out vec4 fragColor;

void main() {
  float dist = length(vDisc);
  if(dist > 1.) {
    discard;
  }

  // float fw = fwidth(dist);
  // float alpha = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, dist);
  float fade = vDepth;//.1 + .9 * smoothstep(0.0, 1.0, vDepth);
  // if (alpha < 0.001) discard;
  fragColor = vec4(vec3(fade ) , 1.);
}
`;

const vertexShader = `
precision highp float;
precision highp sampler2D;
precision highp int;

in vec3 position;
in vec2 uv;

uniform sampler2D positions;
uniform sampler2D tTrail;
uniform float pointSize;
uniform vec2 resolution;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec2 vDisc;
out float vTrail;
out float vDepth;
out float vLife;
out vec2 vUv;

float parabola(float x) {
  return 4.0 * x * (1.0 - x);
}

void main() {
  ivec2 texSize = ivec2(textureSize(positions, 0));
  float tx = float(gl_InstanceID % texSize.x) / float(texSize.x);
  float ty = float(gl_InstanceID / texSize.x) / float(texSize.y);
  vec2 tuv = vec2(tx, ty) + 0.5 / vec2(texSize);

  vec4 data = texture(positions, tuv);
  vec2 agentPos = data.xy;
  float life = data.w;

  float lon = agentPos.x * 6.28318530;
  float lat = (agentPos.y - 0.5) * 3.14159265;
  vec3 worldPos = life > 0.0
    ? vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon))
    : vec3(1000.0);

  vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
  float centerZ = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;

  vec3 localPos = mat3(modelViewMatrix) * worldPos;
  vDepth = (localPos.z + 1.) * .5;

  vTrail = clamp(texture(tTrail, agentPos).r / 20.0, 0.0, 5.0);

  vec4 clip = projectionMatrix * mvPos;
  vec2 ndcOffset = position.xy * pointSize * parabola(life) * vTrail * 2.0 / resolution;
  vDisc = position.xy;
  vUv = uv;
  vLife = life;
  gl_Position = vec4(clip.xy + ndcOffset * clip.w, clip.z, clip.w);
}
`;

const blurFS = `
precision highp float;

uniform sampler2D tInput;
uniform int blurRadius;
uniform vec2 blurDir;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 texSize = vec2(textureSize(tInput, 0));
  float sigma = float(blurRadius) * 0.5;
  vec4 color = vec4(0.0);
  float total = 0.0;
  for (int i = -blurRadius; i <= blurRadius; i++) {
    float fi = float(i);
    float w = exp(-fi * fi / (2.0 * sigma * sigma));
    color += texture(tInput, vUv + fi * blurDir / texSize) * w;
    total += w;
  }
  fragColor = color / total;
}
`;

const vertexShaderSphere = `
precision highp float;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform sampler2D tTrailBlurred;
uniform float displacementOffset;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec3 vPosition;
out vec3 vViewPosition;
out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUv;

void main() {
  vUv = uv;
  vPosition = position;

  vec2 texRes = vec2(textureSize(tTrailBlurred, 0));
  float trail = clamp(texture(tTrailBlurred, uv).r / 200.0, 0.0, 1.0);

  vec3 p = position * (1.0 + trail * displacementOffset / 10.0);

  // Compute displaced normal from trail gradient
  float epsU = 4.0 / texRes.x;
  float epsV = 4.0 / texRes.y;
  float trailR = clamp(texture(tTrailBlurred, uv + vec2(epsU, 0.0)).r / 200.0, 0.0, 1.0);
  float trailU = clamp(texture(tTrailBlurred, uv + vec2(0.0, epsV)).r / 200.0, 0.0, 1.0);
  float dTrail_du = (trailR - trail) / epsU;
  float dTrail_dv = (trailU - trail) / epsV;

  float lon = uv.x * 6.28318530;
  float lat = (uv.y - 0.5) * 3.14159265;
  vec3 T = normalize(vec3(-sin(lon), 0.0, cos(lon)));
  vec3 B = normalize(vec3(-sin(lat)*cos(lon), cos(lat), -sin(lat)*sin(lon)));

  vec3 displacedNormal = normalize(normal - displacementOffset * (dTrail_du * T + dTrail_dv * B) / 10.0);

  vec4 worldPos = modelMatrix * vec4(p, 1.0);
  vWorldPosition = worldPos.xyz;
  vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
  vViewPosition = -mvPos.xyz;
  vNormal = normalize(normalMatrix * displacedNormal);
  gl_Position = projectionMatrix * mvPos;
}
`;

const sphereFragMain = `
uniform sampler2D tTrailNormal;
uniform float displacementOffset;

void main() {
  mat3 viewMatrixInverse = mat3(inverse(viewMatrix));
  vec3 worldNormal = normalize(viewMatrixInverse * vNormal);

  vec2 ts = 1.0 / vec2(textureSize(tTrailNormal, 0));
  float hR = texture(tTrailNormal, vUv + vec2(ts.x, 0.0)).r;
  float hL = texture(tTrailNormal, vUv - vec2(ts.x, 0.0)).r;
  float hU = texture(tTrailNormal, vUv + vec2(0.0, ts.y)).r;
  float hD = texture(tTrailNormal, vUv - vec2(0.0, ts.y)).r;
  vec3 mapN = normalize(vec3((hL - hR) * displacementOffset, (hD - hU) * displacementOffset, 50.0));
  worldNormal = perturbNormal2Arb(vWorldPosition, worldNormal, vUv, mapN);

  vec4 diffuseColor = vec4(color, 1.0);
  vec3 outgoingLight = shade(vWorldPosition, worldNormal, vUv, diffuseColor, roughness, metalness);
  outgoingLight = ACESFilmicToneMapping(outgoingLight);
  fragColor = linearToSRGB(vec4(outgoingLight, 1.0));
}
`;

class SceneParticles {
  constructor(texWidth, texHeight, width, height) {
    this.mat = new RawShaderMaterial({
      uniforms: {
        positions: { value: null },
        tTrail: { value: null },
        pointSize: { value: 1.0 },
        resolution: { value: new Vector2(width, height) },
      },
      vertexShader,
      fragmentShader,
      glslVersion: GLSL3,
      transparent: true,
      // blending: AdditiveBlending,
      depthTest: true,
    });

    this.group = new Object3D();

    this.mesh = new InstancedMesh(
      new PlaneGeometry(2, 2),
      this.mat,
      texWidth * texHeight,
    );
    this.mesh.frustumCulled = false;

    const blurFBOOptions = {
      type: HalfFloatType,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      depthBuffer: false,
    };

    const makeBlurPass = (blurDir, radius) => {
      const mat = new RawShaderMaterial({
        uniforms: {
          tInput: { value: null },
          blurRadius: { value: radius },
          blurDir: { value: blurDir },
        },
        vertexShader: orthoVS,
        fragmentShader: blurFS,
        glslVersion: GLSL3,
      });
      const pass = new ShaderPass(mat, blurFBOOptions);
      pass.setSize(2048, 1024);
      return { mat, pass };
    };

    const bH = makeBlurPass(new Vector2(1, 0), 20);
    const bV = makeBlurPass(new Vector2(0, 1), 20);
    this.blurHMat = bH.mat;
    this.blurHPass = bH.pass;
    this.blurVMat = bV.mat;
    this.blurVPass = bV.pass;
    this.blurVMat.uniforms.tInput.value = this.blurHPass.texture;

    const nH = makeBlurPass(new Vector2(1, 0), 5);
    const nV = makeBlurPass(new Vector2(0, 1), 5);
    this.normalBlurHMat = nH.mat;
    this.normalBlurHPass = nH.pass;
    this.normalBlurVMat = nV.mat;
    this.normalBlurVPass = nV.pass;
    this.normalBlurVMat.uniforms.tInput.value = this.normalBlurHPass.texture;

    this.sphereMat = new Material({
      vertexShader: vertexShaderSphere,
      uniforms: {
        color: new Color(1, 1, 1),
        roughness: 0.2,
        metalness: 0.5,
      },
      customUniforms: {
        tTrailBlurred: { value: this.blurVPass.texture },
        tTrailNormal: { value: this.normalBlurVPass.texture },
        displacementOffset: { value: 0.0 },
      },
      main: sphereFragMain,
    });

    this.sphere = new Mesh(new IcosahedronGeometry(1, 40), this.sphereMat);
    this.sphere.scale.z = -1;

    // this.group.add(this.mesh);
    this.group.add(this.sphere);
  }

  update(simTexture, trailTexture) {
    this.mat.uniforms.positions.value = simTexture;
    this.mat.uniforms.tTrail.value = trailTexture;

    this.blurHMat.uniforms.tInput.value = trailTexture;
    this.normalBlurHMat.uniforms.tInput.value = trailTexture;
  }

  renderBlur(renderer) {
    this.blurHPass.render(renderer);
    this.blurVPass.render(renderer);
    this.normalBlurHPass.render(renderer);
    this.normalBlurVPass.render(renderer);
  }

  syncMaterial(renderer, scene) {
    this.sphereMat.syncLights(scene);
    this.sphereMat.syncRenderer(renderer);
  }

  setSize(renderer, width, height) {
    const dPR = renderer.getPixelRatio();
    this.mat.uniforms.resolution.value.set(width * dPR, height * dPR);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

export { SceneParticles };
