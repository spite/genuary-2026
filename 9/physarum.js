import {
  RawShaderMaterial,
  GLSL3,
  Vector2,
  DataTexture,
  RGBAFormat,
  FloatType,
  HalfFloatType,
  NearestFilter,
  RepeatWrapping,
  AdditiveBlending,
  InstancedMesh,
  PlaneGeometry,
  Scene,
  OrthographicCamera,
  Clock,
} from "three";
import { ShaderPingPongPass } from "modules/shader-ping-pong-pass.js";
import { ShaderPass } from "modules/shader-pass.js";

import { shader as orthoVertexShader } from "shaders/ortho-vs.js";

const simulationFragmentShader = `
precision highp float;
precision highp sampler2D;

uniform sampler2D currentPos;
uniform sampler2D trailMap;
uniform float time;
uniform float deltaTime;
uniform vec2 resolution;

uniform float sensorAngle;
uniform float sensorDist;
uniform float turnSpeed;
uniform float moveSpeed;
uniform float lifeDecay;
uniform float randomSeed;

out vec4 fragColor;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float sense(vec2 pos, float angle, float offset) {
  float sa = angle + offset;
  float lat = (pos.y - 0.5) * 3.14159265;
  float cosLat = max(cos(lat), 0.05);
  vec2 dir = vec2(cos(sa) / cosLat, sin(sa));
  vec2 sensorPos = vec2(
    fract(pos.x + dir.x * sensorDist / resolution.x),
    clamp(pos.y + dir.y * sensorDist / resolution.y, 0.0, 1.0)
  );
  return texture(trailMap, sensorPos).r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(currentPos, 0));
  vec4 data = texture(currentPos, uv);
  vec2 pos = data.xy;
  float angle = data.z;
  float life = data.w;

  life -= lifeDecay * deltaTime;

  if (life <= 0.0) {
    float seed = randomSeed + gl_FragCoord.x * 314.0 + gl_FragCoord.y + time;
    float h1 = hash(seed);
    float h2 = hash(seed + 1.0);
    float h3 = hash(seed + 2.0);

    pos = vec2(h1, h2);

    angle = h3 * 6.283185;
    life = hash(seed + 3.0) * 0.5 + 0.5;
  } else {
    float wF = sense(pos, angle, 0.0);
    float wL = sense(pos, angle, sensorAngle);
    float wR = sense(pos, angle, -sensorAngle);
    float rnd = (hash(pos.x * 100.0 + pos.y * 200.0 + time) - 0.5) * 0.2;

    if (wF > wL && wF > wR) {
      // continue straight
    } else if (wF < wL && wF < wR) {
      angle += (rnd - 0.5) * 2.0 * turnSpeed * deltaTime;
    } else if (wR > wL) {
      angle -= turnSpeed * deltaTime;
    } else if (wL > wR) {
      angle += turnSpeed * deltaTime;
    }

    float lat = (pos.y - 0.5) * 3.14159265;
    float cosLat = max(cos(lat), 0.05);
    vec2 dir = vec2(cos(angle) / cosLat, sin(angle));
    pos.x = fract(pos.x + dir.x * moveSpeed * deltaTime / resolution.x);
    pos.y =       pos.y + dir.y * moveSpeed * deltaTime / resolution.y;
    if (pos.y < 0.0) { pos.y = -pos.y;      angle = 3.14159265 - angle; }
    if (pos.y > 1.0) { pos.y = 2.0 - pos.y; angle = 3.14159265 - angle; }
  }

  fragColor = vec4(pos, angle, life);
}
`;

const depositVertexShader = `
precision highp float;
precision highp sampler2D;
precision highp int;

in vec3 position;

uniform sampler2D positions;
uniform float pointSize;
uniform vec2 resolution;
uniform ivec2 texSize;

out vec2 vDisc;

void main() {
  float tx = float(gl_InstanceID % texSize.x) / float(texSize.x);
  float ty = float(gl_InstanceID / texSize.x) / float(texSize.y);
  vec2 uv = vec2(tx, ty) + 0.5 / float(texSize);

  vec4 data = texture(positions, uv);
  vec2 pos = data.xy;
  float life = data.w;

  vec2 center = life > 0.0 ? pos * 2.0 - 1.0 : vec2(10.0);

  vec2 offset = position.xy * pointSize * 2.0 / resolution;

  vDisc = position.xy;
  gl_Position = vec4(center + offset, 0.0, 1.0);
}
`;

const depositFragmentShader = `
precision highp float;

in vec2 vDisc;
out vec4 fragColor;

void main() {
  float dist = length(vDisc);
  float fw = fwidth(dist);
  float alpha = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, dist);
  if (alpha < 0.001) discard;
  fragColor = vec4(1.0, 1.0, 1.0, alpha);
}
`;

const diffuseFragmentShader = `
precision highp float;
precision highp sampler2D;

uniform sampler2D trailMap;
uniform vec2 resolution;
uniform float decayRate;
uniform float diffuseRate;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 texel = 1.0 / resolution;

  float sum = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      sum += texture(trailMap, uv + vec2(float(x), float(y)) * texel).r;
    }
  }

  float blurred = sum / 9.0;
  float original = texture(trailMap, uv).r;
  float diffused = mix(original, blurred, diffuseRate);

  fragColor = vec4(vec3(diffused * (1.0 - decayRate)), 1.0);
}
`;

const displayFragmentShader = `
precision highp float;
precision highp sampler2D;

uniform sampler2D tTrail;

in vec2 vUv;
out vec4 fragColor;

void main() {
  fragColor = vec4(texture(tTrail, vUv).rgb, 1.0);
}
`;

class PhysarumSimulationPass {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.time = 0;
    this.clock = new Clock();
    this.firstFrame = true;

    const simMat = new RawShaderMaterial({
      uniforms: {
        currentPos: { value: null },
        trailMap: { value: null },
        time: { value: 0 },
        deltaTime: { value: 0.016 },
        resolution: { value: new Vector2(width, height) },
        sensorAngle: { value: 0.4 },
        sensorDist: { value: 15.0 },
        turnSpeed: { value: 10.0 },
        moveSpeed: { value: 100.0 },
        lifeDecay: { value: 0.05 },
        randomSeed: { value: Math.random() },
      },
      vertexShader: orthoVertexShader,
      fragmentShader: simulationFragmentShader,
      glslVersion: GLSL3,
    });

    this.simPass = new ShaderPingPongPass(simMat, {
      type: FloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      depthBuffer: false,
    });
    this.simPass.setSize(width, height);

    this.initTex = this.createInitTexture();

    const trailMat = new RawShaderMaterial({
      uniforms: {
        trailMap: { value: null },
        resolution: { value: new Vector2(width, height) },
        decayRate: { value: 0.05 },
        diffuseRate: { value: 0.5 },
      },
      vertexShader: orthoVertexShader,
      fragmentShader: diffuseFragmentShader,
      glslVersion: GLSL3,
    });

    this.trailPass = new ShaderPingPongPass(trailMat, {
      type: HalfFloatType,
      // minFilter: NearestFilter,
      // magFilter: NearestFilter,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      depthBuffer: false,
    });
    this.trailPass.setSize(width, height);

    const depositMat = new RawShaderMaterial({
      uniforms: {
        positions: { value: null },
        pointSize: { value: 1.0 },
        resolution: { value: new Vector2(width, height) },
        texSize: { value: new Vector2(width, height) },
      },
      vertexShader: depositVertexShader,
      fragmentShader: depositFragmentShader,
      glslVersion: GLSL3,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
    });
    this.depositMat = depositMat;

    this.agentMesh = new InstancedMesh(
      new PlaneGeometry(2, 2),
      depositMat,
      width * height,
    );
    this.agentMesh.frustumCulled = false;

    this.scene = new Scene();
    this.scene.add(this.agentMesh);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const displayMat = new RawShaderMaterial({
      uniforms: {
        tTrail: { value: null },
      },
      vertexShader: orthoVertexShader,
      fragmentShader: displayFragmentShader,
      glslVersion: GLSL3,
    });
    this.displayPass = new ShaderPass(displayMat, { depthBuffer: false });
    this.displayPass.setSize(width, height);
  }

  createInitTexture() {
    const data = new Float32Array(this.width * this.height * 4);
    for (let i = 0; i < this.width * this.height; i++) {
      data[i * 4 + 0] = Math.random();
      data[i * 4 + 1] = Math.random();
      data[i * 4 + 2] = Math.random() * Math.PI * 2;
      data[i * 4 + 3] = Math.random();
    }
    const tex = new DataTexture(
      data,
      this.width,
      this.height,
      RGBAFormat,
      FloatType,
    );
    tex.needsUpdate = true;
    return tex;
  }

  render(renderer) {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    const u = this.simPass.shader.uniforms;
    u.currentPos.value = this.firstFrame ? this.initTex : this.simPass.texture;
    u.trailMap.value = this.trailPass.texture;
    u.time.value = this.time;
    u.deltaTime.value = dt;
    u.randomSeed.value = Math.random();
    this.firstFrame = false;
    this.simPass.render(renderer);

    this.depositMat.uniforms.positions.value = this.simPass.texture;
    // this.displayPass.shader.uniforms.tTrail.value = this.trailPass.texture;

    renderer.setRenderTarget(this.trailPass.current);
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
    renderer.setRenderTarget(null);

    this.trailPass.shader.uniforms.trailMap.value = this.trailPass.texture;
    this.trailPass.render(renderer);
  }

  setSize(renderer, width, height) {
    this.width = width;
    this.height = height;
    this.trailPass.setSize(width, height);
    this.displayPass.setSize(width, height);
    this.simPass.shader.uniforms.resolution.value.set(width, height);
    this.depositMat.uniforms.resolution.value.set(width, height);
    const dPR = renderer.getPixelRatio();
    this.trailPass.shader.uniforms.resolution.value.set(
      width * dPR,
      height * dPR,
    );
  }

  dispose() {
    this.simPass.dispose();
    this.trailPass.dispose();
    this.displayPass.dispose();
    this.agentMesh.geometry.dispose();
    this.depositMat.dispose();
    this.initTex.dispose();
  }
}

export { PhysarumSimulationPass };
