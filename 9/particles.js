import {
  RawShaderMaterial,
  GLSL3,
  Vector2,
  InstancedMesh,
  PlaneGeometry,
  AdditiveBlending,
} from "three";

const fragmentShader = `
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

const vertexShader = `
precision highp float;
precision highp sampler2D;
precision highp int;

in vec3 position;

uniform sampler2D positions;
uniform float pointSize;
uniform vec2 resolution;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform ivec2 texSize;

out vec2 vDisc;

float parabola(float x) {
  return 4.0 * x * (1.0 - x);
}

void main() {
  float tx = float(gl_InstanceID % texSize.x) / float(texSize.x);
  float ty = float(gl_InstanceID / texSize.x) / float(texSize.y);
  vec2 uv = vec2(tx, ty) + 0.5 / vec2(texSize);

  vec4 data = texture(positions, uv);
  vec2 agentPos = data.xy;
  float life = data.w;

  float lon = agentPos.x * 6.28318530;
  float lat = (agentPos.y - 0.5) * 3.14159265;
  vec3 worldPos = life > 0.0
    ? vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)) * 1.01
    : vec3(1000.0);

  vec4 clip = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
  vec2 ndcOffset = position.xy * pointSize * parabola(life) * 2.0 / resolution;
  vDisc = position.xy;
  gl_Position = vec4(clip.xy + ndcOffset * clip.w, clip.z, clip.w);
}
`;

class SceneParticles {
  constructor(texWidth, texHeight, width, height) {
    this.mat = new RawShaderMaterial({
      uniforms: {
        positions: { value: null },
        pointSize: { value: 1.0 },
        resolution: { value: new Vector2(width, height) },
        texSize: { value: new Vector2(texWidth, texHeight) },
      },
      vertexShader,
      fragmentShader,
      glslVersion: GLSL3,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: true,
    });

    this.mesh = new InstancedMesh(
      new PlaneGeometry(2, 2),
      this.mat,
      texWidth * texHeight,
    );
    this.mesh.frustumCulled = false;
  }

  update(simTexture) {
    this.mat.uniforms.positions.value = simTexture;
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
