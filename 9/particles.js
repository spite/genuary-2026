import {
  RawShaderMaterial,
  GLSL3,
  Vector2,
  InstancedMesh,
  PlaneGeometry,
  Object3D,
  Mesh,
  IcosahedronGeometry,
  MeshBasicMaterial,
  DoubleSide,
  AdditiveBlending,
} from "three";

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

const vertexShaderSphere = `
precision highp float;

in vec3 position;
in vec2 uv; 

uniform sampler2D tTrail;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;  

out vec2 vUv;
out float vDepth;

vec4 blur(in sampler2D image, in vec2 TexCoords, in float radius, in vec2 resolution) {
  vec4 color = vec4(0.0);
  float total = 0.0;
  
  for (float x = -radius; x <= radius; x++) {
      for (float y = -radius; y <= radius; y++) {
          
          // Calculate weight (Gaussian function)
          // Sigma is usually radius / 2.0
          float sigma = radius / 2.0;
          float weight = exp(-(x*x + y*y) / (2.0 * sigma * sigma));
          
          vec2 offset = vec2(x, y) / resolution;
          color += texture(image, TexCoords + offset) * weight;
          total += weight;
      }
  }
  color /= total;
  return color;
}

void main() {
  vUv = uv;

  vec4 t = blur(tTrail, uv, 20.0, vec2(textureSize(tTrail, 0)));
  float trail = clamp(t.r / 200.0, 0.0, 1.0);

  vec3 p = position * (1. + trail / 10.);
  vec4 mvPos = modelViewMatrix * vec4(p, 1.0);

  vec3 localPos = mat3(modelViewMatrix) * p;
  vDepth = (localPos.z + 1.) * .5;

  gl_Position = projectionMatrix * mvPos;
}
`;

const fragmentShaderSphere = `
precision highp float;

in vec2 vUv;
in float vDepth;

uniform sampler2D tTrail; 

out vec4 fragColor;

void main() {
  float trail = clamp(texture(tTrail, vUv).r / 200.0, 0.0, 1.0);
  vec3 color = vec3(trail) * (.1 + .9 * vDepth);
  fragColor = vec4(color,1.);
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

    this.sphere = new Mesh(
      new IcosahedronGeometry(1, 40),
      new RawShaderMaterial({
        vertexShader: vertexShaderSphere,
        fragmentShader: fragmentShaderSphere,
        uniforms: {
          tTrail: { value: null },
        },
        glslVersion: GLSL3,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: AdditiveBlending,
      }),
    );
    this.sphere.scale.z = -1;

    // this.group.add(this.mesh);
    this.group.add(this.sphere);
  }

  update(simTexture, trailTexture) {
    this.mat.uniforms.positions.value = simTexture;
    this.mat.uniforms.tTrail.value = trailTexture;

    this.sphere.material.uniforms.tTrail.value = trailTexture;
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
