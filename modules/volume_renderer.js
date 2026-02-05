import {
  Data3DTexture,
  Mesh,
  RedFormat,
  RGFormat,
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

vec2 opSmoothUnion(vec2 d1, vec2 d2, float k) {
    k *= 4.0;
    float h = max(k - abs(d1.x - d2.x), 0.0);
    float t = clamp(0.5 + 0.5 * (d2.x - d1.x) / k, 0.0, 1.0);
    float colorAttr = mix(d2.y, d1.y, t);
    return vec2(min(d1.x, d2.x) - h * h * 0.25 / k, colorAttr);
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

vec2 opUnion(vec2 d1, vec2 d2) {
    float c = d2.y;
    if (d1.x < d2.x) c = d1.y;
    
    return vec2(min(d1.x, d2.x), c);
}

float opSubtraction(float d1, float d2) {
    return max(-d1, d2);
}

float opIntersection(float d1, float d2) {
    return max(d1, d2);
}

float sdSharpSpikeball(vec3 p, float radius, float time) {
    float d = length(p) - radius;    
    float freq = .2;
    float amp = 5.;
    float displacement = -abs(sin(p.x * freq) * sin(p.y * freq) * sin(p.z * freq)) * amp;
    return d + displacement;
}

float noise(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 54.53))) * 43758.5453);
}

float sdNoiseBall(vec3 p, float radius, float time) {
    float d = length(p) - radius;
    
    float v0 = .25;
    float v1 = .25;
    float amplitude = 5.;
    float displacement = sin(p.x*v0+ time)*sin(p.y*v0+ time)*sin(p.z*v0+ time) + 
                         sin(p.x*v1 + time)*sin(p.y*v1 + time)*sin(p.z*v1 + time)*0.5;
                         
    return d + (displacement * amplitude);
}


float sdSpikeball(vec3 p, float radius, float time) {
    float d = length(p) - radius;
    float frequency = .2;
    float amplitude = 5.;
    float displacement = sin(p.x * frequency + time) * sin(p.y * frequency + time) * sin(p.z * frequency + time) * amplitude;
    return d + displacement;
}


vec2 sampleField(vec3 p, vec3 gridSize, float time, vec4 shapeEnabled) {
    vec3 centered = (p - gridSize * 0.5 ) * 64. / gridSize;
    
    vec2 val = vec2(1000.0, 0.);
    
    if (shapeEnabled.x > 0.5) {
        val = vec2(fDodecahedron(rotateY(centered, time * 1.1), 20.0, 20.0), 0.);
    }

    vec3 pos = rotateX(centered, time * .9);
    float r = 27.;
    
    if (shapeEnabled.z > 0.5 && shapeEnabled.x > 0.5) {
        for(int i = 0; i < 10; i++) {
            float a = float(i) * 1. * 3.14159 / 10.;
            float s0 = sdSphere(pos + rotateZ(vec3(r,0.,0.), a) * sin(time * .98 + a), 5.);
            val.x = opSmoothSubtraction(s0, val.x, 2.);
        }
    }

    float torus = sdTorus(rotateX(centered, time * .95), vec2(20., 6. + 1. * sin(time * 1.2)));
    if (shapeEnabled.y > 0.5 && shapeEnabled.x > 0.5) {
        val.x = opSmoothSubtraction(torus, val.x, 2.);
    }

    vec2 add = vec2(1000., 0.);
    if (shapeEnabled.z > 0.5) {
        for(int i = 0; i < 10; i++) {
            float a = float(i) * 1. * 3.14159 / 10.;
            float s0 = sdSphere(pos + rotateZ(vec3(r,0.,0.), a) * sin(time * .98 + a), 3.);
            add = opUnion(vec2(s0, 1. + float(i) * 1. / 10.), add);
        }
    }
    if (shapeEnabled.y > 0.5) {
        add = opSmoothUnion(add, vec2(torus + 2., 3.), 1.);
    }
    if (shapeEnabled.y > 0.5 || shapeEnabled.z > 0.5) {
        val = opUnion(add, val);
    }

    if (shapeEnabled.w > 0.5) {
        vec3 mousePos = uMouse;
        
        float halfGrid = gridSize.x * 0.5;
        float maxRadius = 8.0;
        float maxRadiusSolid = 4.0;
        
        float distToBoundary = min(
            min(halfGrid - abs(mousePos.x), halfGrid - abs(mousePos.y)),
            halfGrid - abs(mousePos.z)
        );
        
        float radiusScale = clamp(distToBoundary / maxRadius, 0.0, 1.0);
        float sphereRadius = maxRadius * radiusScale;
        float solidRadius = maxRadiusSolid * radiusScale;
        
        if (sphereRadius > 0.1) {
            float mouseSphere = sdSphere(centered - mousePos, sphereRadius);
            val.x = opSmoothSubtraction(mouseSphere, val.x, 3.0 * radiusScale);
        }
        if (solidRadius > 0.1) {
            float mouseSphereSolid = sdSphere(centered - mousePos, solidRadius);
            val = opUnion(val, vec2(mouseSphereSolid, 4.));
        }
    }

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
uniform vec3 uMouse;
uniform vec4 uShapeEnabled;

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
    vec2 sdf = sampleField(pos, uGridSize, uTime, uShapeEnabled);
    float d = sdf.x;
    float c = sdf.y;
    
    fragColor = vec4(d, c, 0.0, 1.0);
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
        format: RGFormat,
        type: FloatType,
        depthBuffer: false,
        stencilBuffer: false,
      },
    );

    this.texture3D = new Data3DTexture(
      new Float32Array(this.size * this.size * this.size * 2),
      this.size,
      this.size,
      this.size,
    );
    this.texture3D.format = RGFormat;
    this.texture3D.type = FloatType;
    this.texture3D.minFilter = LinearFilter;
    this.texture3D.magFilter = LinearFilter;
    this.texture3D.unpackAlignment = 1;
    this.texture3D.needsUpdate = true;
  }

  initMaterials() {
    this.mouse = new Vector3(0, 0, 0);
    this.shapeEnabled = { x: 1, y: 1, z: 1, w: 1 };

    this.material2D = new RawShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGridSize: { value: new Vector3(this.size, this.size, this.size) },
        uSlicesPerRow: { value: this.slicesPerRow },
        uAtlasRows: { value: this.atlasRows },
        uMouse: { value: this.mouse },
        uShapeEnabled: { value: [1, 1, 1, 1] },
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader2D,
      glslVersion: GLSL3,
    });
  }

  setMouse(x, y, z = 0) {
    this.mouse.set(x, y, z);
  }

  getMouse() {
    return { x: this.mouse.x, y: this.mouse.y, z: this.mouse.z };
  }

  setShapesEnabled(shapes) {
    if (shapes.dodecahedron !== undefined) {
      this.shapeEnabled.x = shapes.dodecahedron ? 1 : 0;
    }
    if (shapes.torus !== undefined) {
      this.shapeEnabled.y = shapes.torus ? 1 : 0;
    }
    if (shapes.spheres !== undefined) {
      this.shapeEnabled.z = shapes.spheres ? 1 : 0;
    }
    if (shapes.mouseSphere !== undefined) {
      this.shapeEnabled.w = shapes.mouseSphere ? 1 : 0;
    }
    this.material2D.uniforms.uShapeEnabled.value = [
      this.shapeEnabled.x,
      this.shapeEnabled.y,
      this.shapeEnabled.z,
      this.shapeEnabled.w,
    ];
  }

  getShapesEnabled() {
    return {
      dodecahedron: this.shapeEnabled.x > 0.5,
      torus: this.shapeEnabled.y > 0.5,
      spheres: this.shapeEnabled.z > 0.5,
      mouseSphere: this.shapeEnabled.w > 0.5,
    };
  }

  setShapeEnabled(shape, enabled) {
    this.setShapesEnabled({ [shape]: enabled });
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
        size,
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
