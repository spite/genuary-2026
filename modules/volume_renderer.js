import {
  Data3DTexture,
  Mesh,
  RedFormat,
  FloatType,
  RawShaderMaterial,
  Vector3,
  GLSL3,
  WebGLRenderTarget,
  Scene,
  OrthographicCamera,
  PlaneGeometry,
  LinearFilter,
} from "three";
import { shader as sdfs } from "shaders/sdfs.js";
import { shader as trefoil } from "shaders/trefoil.js";

const sdfCommonCode = `
vec3 rotateX(vec3 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}

vec3 rotateY(vec3 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

vec3 rotateZ(vec3 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
}

${sdfs}
${trefoil}

float opSmoothUnion(float d1, float d2, float k) {
    k *= 4.0;
    float h = max(k - abs(d1 - d2), 0.0);
    return min(d1, d2) - h * h * 0.25 / k;
}

float opSmoothSubtraction(float d1, float d2, float k) {
    return -opSmoothUnion(d1, -d2, k);
}

float opSmoothIntersection(float d1, float d2, float k) {
    return -opSmoothUnion(-d1, -d2, k);
}

float opUnion(float d1, float d2) {
    return min(d1, d2);
}

float opSubtraction(float d1, float d2) {
    return max(-d1, d2);
}

float opIntersection(float d1, float d2) {
    return max(d1, d2);
}

float sampleField(vec3 p, vec3 gridSize, float time) {
    vec3 centered = p - gridSize * 0.5;
    
    // float val1 = sdTorus(centered, vec2(15.0 + 5.0 * sin(0.5 * time), 7.5 + 2.5 * cos(0.7 * time)));
    // float val2 = sdTorus(rotateZ(rotateX(centered + vec3(0.0, 0.0, 5.0 * cos(time)), time), time / 2.0), vec2(15.0, 10.0));
    // float val = opSmoothUnion(val1, val2, 1.0);
    
    float val0 = fDodecahedron(centered, 20.0, 20.0);
    float val1 = sdTrefoilKnot(rotateZ(centered, uTime * .9), 8.0, 0.4, 64 * 6);
    float val2 = sdTrefoilKnot(rotateX(centered, uTime), 8.0, 0.4, 64 * 6);
    
    // float val1 = fDodecahedron(centered, 20.0, 20.0);
    // float val2 = fIcosahedron(rotateX(centered, time), 25.0, 20.0);
    float val11 = opSmoothUnion(val1, val2, 2.0);
    float val = opSmoothSubtraction(val11, val0, 2.0);
    return val;
}
`;

const vertexShader = `
precision highp float;

in vec3 position;
in vec2 uv;

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader2D = `
precision highp float;

uniform float uTime;
uniform vec3 uGridSize;
uniform float uSlicesPerRow;
uniform float uAtlasRows;

in vec2 vUv;
out vec4 fragColor;

${sdfCommonCode}

void main() {
    vec2 atlasPixel = vUv * vec2(uGridSize.x * uSlicesPerRow, uGridSize.y * uAtlasRows);
    
    int sliceX = int(floor(atlasPixel.x / uGridSize.x));
    int sliceY = int(floor(atlasPixel.y / uGridSize.y));
    int z = sliceY * int(uSlicesPerRow) + sliceX;
    
    float x = floor(mod(atlasPixel.x, uGridSize.x));
    float y = floor(mod(atlasPixel.y, uGridSize.y));
    
    if (z >= int(uGridSize.z)) {
        fragColor = vec4(1000.0, 0.0, 0.0, 1.0);
        return;
    }
    
    vec3 pos = vec3(x, y, float(z));
    float sdf = sampleField(pos, uGridSize, uTime);
    
    fragColor = vec4(sdf, 0.0, 0.0, 1.0);
}
`;

class VolumeRenderer {
  constructor(size = 64) {
    this.size = size;

    this.slicesPerRow = Math.ceil(Math.sqrt(size));
    this.atlasRows = Math.ceil(size / this.slicesPerRow);
    this.atlasWidth = size * this.slicesPerRow;
    this.atlasHeight = size * this.atlasRows;

    this.textureMode = "atlas";

    this._texture3DDirty = true;
    this._glTexture3D = null;

    this.sliceOffsets = new Uint16Array(size * 2);
    for (let z = 0; z < size; z++) {
      this.sliceOffsets[z * 2] = (z % this.slicesPerRow) * size;
      this.sliceOffsets[z * 2 + 1] = Math.floor(z / this.slicesPerRow) * size;
    }

    this.initRenderTargets();
    this.initMaterials();
    this.initScene();
  }

  initRenderTargets() {
    this.renderTarget2D = new WebGLRenderTarget(
      this.atlasWidth,
      this.atlasHeight,
      {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        format: RedFormat,
        type: FloatType,
        depthBuffer: false,
        stencilBuffer: false,
      }
    );

    this.texture3D = new Data3DTexture(
      new Float32Array(this.size * this.size * this.size),
      this.size,
      this.size,
      this.size
    );
    this.texture3D.format = RedFormat;
    this.texture3D.type = FloatType;
    this.texture3D.minFilter = LinearFilter;
    this.texture3D.magFilter = LinearFilter;
    this.texture3D.unpackAlignment = 1;
    this.texture3D.needsUpdate = true;
  }

  initMaterials() {
    this.material2D = new RawShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGridSize: { value: new Vector3(this.size, this.size, this.size) },
        uSlicesPerRow: { value: this.slicesPerRow },
        uAtlasRows: { value: this.atlasRows },
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader2D,
      glslVersion: GLSL3,
    });
  }

  initScene() {
    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.sdfQuad = new Mesh(new PlaneGeometry(2, 2), this.material2D);
    this.scene.add(this.sdfQuad);
  }

  update2D(renderer, time) {
    this.material2D.uniforms.uTime.value = time;

    const currentRenderTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget2D);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(currentRenderTarget);

    this._texture3DDirty = true;
  }

  update3D(renderer, time) {
    this.update2D(renderer, time);

    if (!this._texture3DDirty) {
      return;
    }

    const gl = renderer.getContext();

    if (!this._glTexture3D) {
      const textureProperties = renderer.properties.get(this.texture3D);
      if (!textureProperties.__webglTexture) {
        renderer.initTexture(this.texture3D);
      }
      this._glTexture3D = textureProperties.__webglTexture;
    }

    const renderTargetProperties = renderer.properties.get(this.renderTarget2D);
    const atlasFramebuffer = renderTargetProperties.__webglFramebuffer;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, atlasFramebuffer);
    gl.bindTexture(gl.TEXTURE_3D, this._glTexture3D);

    const offsets = this.sliceOffsets;
    const size = this.size;
    for (let z = 0; z < size; z++) {
      gl.copyTexSubImage3D(
        gl.TEXTURE_3D,
        0,
        0,
        0,
        z,
        offsets[z * 2],
        offsets[z * 2 + 1],
        size,
        size
      );
    }

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    this._texture3DDirty = false;
  }

  update(renderer, time) {
    if (this.textureMode === "3d") {
      this.update3D(renderer, time);
    } else {
      this.update2D(renderer, time);
    }
  }

  setTextureMode(mode) {
    if (mode !== "atlas" && mode !== "3d") {
      console.warn(`Invalid texture mode: ${mode}. Use "atlas" or "3d".`);
      return;
    }
    this.textureMode = mode;
    console.log(`SDF texture mode set to: ${mode}`);
  }

  getTextureMode() {
    return this.textureMode;
  }

  invalidateCache() {
    this._glTexture3D = null;
    this._texture3DDirty = true;
  }

  dispose() {
    this.renderTarget2D.dispose();
    this.texture3D.dispose();
    this.material2D.dispose();
    this.sdfQuad.geometry.dispose();
    this._glTexture3D = null;
  }
}

export { VolumeRenderer };
