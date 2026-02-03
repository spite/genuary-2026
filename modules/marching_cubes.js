import { triTable } from "modules/MarchingCubesGeometry.js";
import {
  BufferGeometry,
  NearestFilter,
  DataTexture,
  Mesh,
  RedIntegerFormat,
  IntType,
  RawShaderMaterial,
  Matrix4,
  Vector2,
  Vector3,
  DoubleSide,
  GLSL3,
  BufferAttribute,
} from "three";

import { VolumeRenderer } from "modules/volume_renderer.js";

const ISO_LEVEL = 0.5;

// Common shader chunks
const SHADER_CONSTANTS = `
const int edgeConnections[24] = int[](
    0,1, 1,2, 2,3, 3,0,
    4,5, 5,6, 6,7, 7,4,
    0,4, 1,5, 2,6, 3,7
);

const vec3 corners[8] = vec3[](
    vec3(0,0,0), vec3(1,0,0), vec3(1,0,1), vec3(0,0,1),
    vec3(0,1,0), vec3(1,1,0), vec3(1,1,1), vec3(0,1,1)
);
`;

const VERTEX_COMMON_UNIFORMS = `
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform isampler2D uTriTable;
uniform vec3 uGridSize;
uniform vec3 uHalfGridSize;
uniform ivec3 uGridSizeInt;
uniform float uIsoLevel;
uniform vec3 uTextureSize;
uniform vec3 uGridToTexScale;

uniform float uInv15;
uniform float uInvGridXY;
uniform float uInvGridX;

uniform int uNormalMode;

uniform vec3 uLightDir;
uniform int uShadowSteps;
uniform float uShadowSoftness;
uniform float uShadowBias;
uniform float uShadowMaxDist;

in uint vIndex;

out vec3 vNormal;
out vec3 vPos;
out vec3 vGridPos;
out float vShadow;
`;

const SHADOW_UNIFORMS = `
uniform vec3 uGridSize;
uniform float uIsoLevel;
uniform vec3 uGridToTexScale;
uniform int uShadowSteps;
uniform float uShadowSoftness;
uniform float uShadowBias;
uniform float uShadowMaxDist;
`;

// calcShadow that uses SAMPLE_FUNC (replaced per shader)
const CALC_SHADOW_TEMPLATE = `
float calcShadow(vec3 pos, vec3 lightDir) {
    float shadow = 1.0;
    float t = uShadowBias;
    float stepSize = uShadowMaxDist / float(uShadowSteps);
    
    for (int i = 0; i < 64; i++) {
        if (i >= uShadowSteps) break;
        
        vec3 p = pos + lightDir * t;
        
        if (p.x < 0.0 || p.x > uGridSize.x ||
            p.y < 0.0 || p.y > uGridSize.y ||
            p.z < 0.0 || p.z > uGridSize.z) {
            break;
        }
        
        float d = SAMPLE_FUNC(p) - uIsoLevel;
        
        if (d < 0.0) {
            shadow = 0.0;
            break;
        }
        
        shadow = min(shadow, uShadowSoftness * d / t);
        t += stepSize;
        
        if (t > uShadowMaxDist) break;
    }
    
    return clamp(shadow, 0.0, 1.0);
}
`;

// Normal functions that use SAMPLE_FUNC (replaced per shader)
const NORMAL_FUNCTIONS_TEMPLATE = `
vec3 getNormalCentralDiff(vec3 p, float eps) {
    float dx = SAMPLE_FUNC(p + vec3(eps, 0.0, 0.0)) - SAMPLE_FUNC(p - vec3(eps, 0.0, 0.0));
    float dy = SAMPLE_FUNC(p + vec3(0.0, eps, 0.0)) - SAMPLE_FUNC(p - vec3(0.0, eps, 0.0));
    float dz = SAMPLE_FUNC(p + vec3(0.0, 0.0, eps)) - SAMPLE_FUNC(p - vec3(0.0, 0.0, eps));
    return normalize(vec3(dx, dy, dz));
}

vec3 getNormalTetrahedron(vec3 p, float eps) {
    vec2 k = vec2(1.0, -1.0);
    return normalize(
        k.xyy * SAMPLE_FUNC(p + k.xyy * eps) +
        k.yyx * SAMPLE_FUNC(p + k.yyx * eps) +
        k.yxy * SAMPLE_FUNC(p + k.yxy * eps) +
        k.xxx * SAMPLE_FUNC(p + k.xxx * eps)
    );
}

vec3 getNormal(vec3 p) {
    float eps = 1.0 / uGridToTexScale.x;
    if (uNormalMode == 1) {
        return getNormalTetrahedron(p, eps);
    }
    return getNormalCentralDiff(p, eps);
}
`;

const VERTEX_MAIN = `
void main() {
    int id = int(vIndex);
    
    int voxelID = int(floor(float(id) * uInv15));
    int vertexID = id - voxelID * 15;

    int z = int(floor(float(voxelID) * uInvGridXY));
    int temp = voxelID - z * uGridSizeInt.x * uGridSizeInt.y;

    int y = int(floor(float(temp) * uInvGridX));
    int x = temp - y * uGridSizeInt.x;

    if (x >= uGridSizeInt.x - 1 || y >= uGridSizeInt.y - 1 || z >= uGridSizeInt.z - 1) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    vec3 pos = vec3(x, y, z);

    float values[8];
    int cubeIndex = 0;
    
    for(int i = 0; i < 8; i++) {
        vec3 samplePos = pos + corners[i];
        values[i] = sampleSDF(samplePos);
        if (values[i] < uIsoLevel) {
            cubeIndex |= (1 << i);
        }
    }

    int edgeIndex = texelFetch(uTriTable, ivec2(vertexID, cubeIndex), 0).r;

    if (edgeIndex == -1) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    int v1 = edgeConnections[edgeIndex * 2];
    int v2 = edgeConnections[edgeIndex * 2 + 1];

    vec3 p1 = pos + corners[v1];
    vec3 p2 = pos + corners[v2];
    float val1 = values[v1];
    float val2 = values[v2];

    float t = clamp((uIsoLevel - val1) / (val2 - val1), 0.0, 1.0);
    vec3 finalPos = mix(p1, p2, t);

    vNormal = getNormal(finalPos);
    vGridPos = finalPos;
    vShadow = calcShadow(finalPos, normalize(uLightDir));
    
    vec3 centeredPos = finalPos - uHalfGridSize;
    vPos = centeredPos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(centeredPos, 1.0);
}
`;

const FRAGMENT_MAIN = `
void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(uLightDir);
    
    float NdotL = max(dot(normal, lightDir), 0.0);
    
    // Use vertex shadow, recalculate in fragment if interpolated (between 0 and 1)
    float shadow = vShadow;
    if (vShadow > 0.001 && vShadow < 0.999) {
        shadow = calcShadow(vGridPos, lightDir);
    }
    
    float shadowedDiffuse = NdotL * shadow;
    float lighting = uAmbient + (1.0 - uAmbient) * shadowedDiffuse;
    
    vec3 color = uBaseColor * lighting;
    fragColor = vec4(color, 1.0);
}
`;

// 2D Atlas specific sampling
const SAMPLE_SDF_2D = `
float sampleSDF(vec3 gridPos) {
    vec3 pos = gridPos * uGridToTexScale;
    pos = clamp(pos, vec3(0.0), uTextureSize - 1.0);
    
    float z = floor(pos.z + 0.5);
    int sliceX = int(mod(z, uSlicesPerRow));
    int sliceY = int(z / uSlicesPerRow);
    
    float u = (float(sliceX) * uTextureSize.x + pos.x + 0.5) * uInvAtlasSize.x;
    float v = (float(sliceY) * uTextureSize.y + pos.y + 0.5) * uInvAtlasSize.y;
    
    return texture(uSDFTexture, vec2(u, v)).r;
}
`;

const SAMPLE_SDF_SMOOTH_2D = `
float sampleSDFSmooth(vec3 gridPos) {
    vec3 pos = gridPos * uGridToTexScale;
    pos = clamp(pos, vec3(0.0), uTextureSize - 1.0);
    
    float z = pos.z;
    float zFloor = floor(z);
    float zCeil = min(zFloor + 1.0, uTextureSize.z - 1.0);
    float zFrac = z - zFloor;
    
    float zFloorRounded = floor(zFloor + 0.5);
    float zCeilRounded = floor(zCeil + 0.5);
    
    int sliceX0 = int(mod(zFloorRounded, uSlicesPerRow));
    int sliceY0 = int(zFloorRounded / uSlicesPerRow);
    float u0 = (float(sliceX0) * uTextureSize.x + pos.x + 0.5) * uInvAtlasSize.x;
    float v0 = (float(sliceY0) * uTextureSize.y + pos.y + 0.5) * uInvAtlasSize.y;
    float val0 = texture(uSDFTexture, vec2(u0, v0)).r;
    
    int sliceX1 = int(mod(zCeilRounded, uSlicesPerRow));
    int sliceY1 = int(zCeilRounded / uSlicesPerRow);
    float u1 = (float(sliceX1) * uTextureSize.x + pos.x + 0.5) * uInvAtlasSize.x;
    float v1 = (float(sliceY1) * uTextureSize.y + pos.y + 0.5) * uInvAtlasSize.y;
    float val1 = texture(uSDFTexture, vec2(u1, v1)).r;
    
    return mix(val0, val1, zFrac);
}
`;

// 3D Texture specific sampling
const SAMPLE_SDF_3D = `
float sampleSDF(vec3 gridPos) {
    vec3 pos = gridPos * uGridToTexScale;
    vec3 uvw = (pos + 0.5) * uInvTextureSize;
    return texture(utexture3D, uvw).r;
}
`;

// Build vertex shaders
const vertexShader2D = `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2D;

uniform sampler2D uSDFTexture;
uniform float uSlicesPerRow;
uniform float uAtlasRows;
uniform vec2 uInvAtlasSize;
${VERTEX_COMMON_UNIFORMS}
${SHADER_CONSTANTS}
${SAMPLE_SDF_2D}
${SAMPLE_SDF_SMOOTH_2D}
${CALC_SHADOW_TEMPLATE.replace(/SAMPLE_FUNC/g, 'sampleSDFSmooth')}
${NORMAL_FUNCTIONS_TEMPLATE.replace(/SAMPLE_FUNC/g, 'sampleSDFSmooth')}
${VERTEX_MAIN}
`;

const vertexShader3D = `
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp isampler2D;

uniform sampler3D utexture3D;
uniform vec3 uInvGridSize;
uniform vec3 uInvTextureSize;
${VERTEX_COMMON_UNIFORMS}
${SHADER_CONSTANTS}
${SAMPLE_SDF_3D}
${CALC_SHADOW_TEMPLATE.replace(/SAMPLE_FUNC/g, 'sampleSDF')}
${NORMAL_FUNCTIONS_TEMPLATE.replace(/SAMPLE_FUNC/g, 'sampleSDF')}
${VERTEX_MAIN}
`;

// Build fragment shaders
const fragmentShader2D = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec3 uLightDir;
uniform vec3 uBaseColor;
uniform float uAmbient;
uniform sampler2D uSDFTexture;
uniform vec3 uTextureSize;
uniform float uSlicesPerRow;
uniform vec2 uInvAtlasSize;
${SHADOW_UNIFORMS}

in vec3 vNormal;
in vec3 vPos;
in vec3 vGridPos;
in float vShadow;
out vec4 fragColor;

${SAMPLE_SDF_SMOOTH_2D}
${CALC_SHADOW_TEMPLATE.replace(/SAMPLE_FUNC/g, 'sampleSDFSmooth')}
${FRAGMENT_MAIN}
`;

const fragmentShader3D = `
precision highp float;
precision highp int;
precision highp sampler3D;

uniform vec3 uLightDir;
uniform vec3 uBaseColor;
uniform float uAmbient;
uniform sampler3D utexture3D;
uniform vec3 uInvTextureSize;
${SHADOW_UNIFORMS}

in vec3 vNormal;
in vec3 vPos;
in vec3 vGridPos;
in float vShadow;
out vec4 fragColor;

${SAMPLE_SDF_3D}
${CALC_SHADOW_TEMPLATE.replace(/SAMPLE_FUNC/g, 'sampleSDF')}
${FRAGMENT_MAIN}
`;

class MarchingCubes {
  constructor(options = {}) {
    const {
      size = 64,
      textureSize,
      isoLevel = ISO_LEVEL,
      volumeRenderer,
    } = options;

    this.size = size;
    this.textureSize = textureSize || size;
    this.isoLevel = isoLevel;

    this.volumeRenderer =
      volumeRenderer || new VolumeRenderer(this.textureSize);

    this.initTriTable();
    this.initGeometry();
    this.initMaterials();
    this.initMesh();
  }

  initTriTable() {
    const triTableData = new Int32Array(256 * 16);
    triTableData.fill(-1);
    for (let i = 0; i < triTable.length; i++) {
      triTableData[i] = triTable[i];
    }

    this.triTableTexture = new DataTexture(
      triTableData,
      16,
      256,
      RedIntegerFormat,
      IntType,
    );
    this.triTableTexture.internalFormat = "R32I";
    this.triTableTexture.minFilter = NearestFilter;
    this.triTableTexture.magFilter = NearestFilter;
    this.triTableTexture.needsUpdate = true;
  }

  initGeometry() {
    const totalVoxels = this.size * this.size * this.size;
    const vertexCount = totalVoxels * 15;

    this.geometry = new BufferGeometry();

    const indices = new Uint32Array(vertexCount);
    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      indices[i] = i;
    }
    this.geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.geometry.setAttribute("vIndex", new BufferAttribute(indices, 1));
  }

  initMaterials() {
    const vr = this.volumeRenderer;
    const s = this.size;
    const ts = this.textureSize;

    const gridSize = new Vector3(s, s, s);
    const halfGridSize = new Vector3(s * 0.5, s * 0.5, s * 0.5);
    const invGridSize = new Vector3(1.0 / s, 1.0 / s, 1.0 / s);

    const textureSize = new Vector3(ts, ts, ts);
    const invTextureSize = new Vector3(1.0 / ts, 1.0 / ts, 1.0 / ts);

    const scale = ts / s;
    const gridToTexScale = new Vector3(scale, scale, scale);

    const invAtlasSize = new Vector2(1.0 / vr.atlasWidth, 1.0 / vr.atlasHeight);

    const inv15 = 1.0 / 15.0;
    const gridXY = s * s;
    const invGridXY = 1.0 / gridXY;
    const invGridX = 1.0 / s;

    this.normalMode = 0;

    // Shadow and lighting defaults
    this.lightDir = new Vector3(1.0, 1.0, 1.0);
    this.shadowSteps = 32;
    this.shadowSoftness = 8.0;
    this.shadowBias = 1.0;
    this.shadowMaxDist = s * 0.5;
    this.baseColor = new Vector3(0.0, 0.7, 1.0);
    this.ambient = 0.15;

    this.material2D = new RawShaderMaterial({
      uniforms: {
        uTriTable: { value: this.triTableTexture },
        uSDFTexture: { value: vr.renderTarget2D.texture },
        uGridSize: { value: gridSize },
        uHalfGridSize: { value: halfGridSize },
        uGridSizeInt: { value: [s, s, s] },
        uIsoLevel: { value: this.isoLevel },
        uTextureSize: { value: textureSize },
        uGridToTexScale: { value: gridToTexScale },
        uSlicesPerRow: { value: vr.slicesPerRow },
        uAtlasRows: { value: vr.atlasRows },
        uInvAtlasSize: { value: invAtlasSize },
        uInv15: { value: inv15 },
        uInvGridXY: { value: invGridXY },
        uInvGridX: { value: invGridX },
        uNormalMode: { value: this.normalMode },
        uLightDir: { value: this.lightDir },
        uShadowSteps: { value: this.shadowSteps },
        uShadowSoftness: { value: this.shadowSoftness },
        uShadowBias: { value: this.shadowBias },
        uShadowMaxDist: { value: this.shadowMaxDist },
        uBaseColor: { value: this.baseColor },
        uAmbient: { value: this.ambient },
        modelViewMatrix: { value: new Matrix4() },
        projectionMatrix: { value: new Matrix4() },
      },
      vertexShader: vertexShader2D,
      fragmentShader: fragmentShader2D,
      side: DoubleSide,
      transparent: false,
      wireframe: false,
      glslVersion: GLSL3,
    });

    this.material3D = new RawShaderMaterial({
      uniforms: {
        uTriTable: { value: this.triTableTexture },
        utexture3D: { value: vr.texture3D },
        uGridSize: { value: gridSize },
        uHalfGridSize: { value: halfGridSize },
        uInvGridSize: { value: invGridSize },
        uGridSizeInt: { value: [s, s, s] },
        uIsoLevel: { value: this.isoLevel },
        uTextureSize: { value: textureSize },
        uGridToTexScale: { value: gridToTexScale },
        uInvTextureSize: { value: invTextureSize },
        uInv15: { value: inv15 },
        uInvGridXY: { value: invGridXY },
        uInvGridX: { value: invGridX },
        uNormalMode: { value: this.normalMode },
        uLightDir: { value: this.lightDir },
        uShadowSteps: { value: this.shadowSteps },
        uShadowSoftness: { value: this.shadowSoftness },
        uShadowBias: { value: this.shadowBias },
        uShadowMaxDist: { value: this.shadowMaxDist },
        uBaseColor: { value: this.baseColor },
        uAmbient: { value: this.ambient },
        modelViewMatrix: { value: new Matrix4() },
        projectionMatrix: { value: new Matrix4() },
      },
      vertexShader: vertexShader3D,
      fragmentShader: fragmentShader3D,
      side: DoubleSide,
      transparent: false,
      wireframe: false,
      glslVersion: GLSL3,
    });
  }

  initMesh() {
    this.mesh = new Mesh(this.geometry, this.material2D);
    this.mesh.frustumCulled = false;

    const self = this;
    this.mesh.onBeforeRender = function (renderer, scene, camera) {
      const mat = this.material;
      mat.uniforms.modelViewMatrix.value.copy(this.modelViewMatrix);
      mat.uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
    };
  }

  update(renderer, time) {
    this.volumeRenderer.update(renderer, time);
  }

  setTextureMode(mode) {
    if (mode !== "atlas" && mode !== "3d") {
      console.warn(`Invalid texture mode: ${mode}. Use "atlas" or "3d".`);
      return;
    }

    this.volumeRenderer.setTextureMode(mode);

    if (mode === "3d") {
      this.mesh.material = this.material3D;
    } else {
      this.mesh.material = this.material2D;
    }

    console.log(`Marching cubes texture mode set to: ${mode}`);
  }

  getTextureMode() {
    return this.volumeRenderer.getTextureMode();
  }

  setIsoLevel(level) {
    this.isoLevel = level;
    this.material2D.uniforms.uIsoLevel.value = level;
    this.material3D.uniforms.uIsoLevel.value = level;
  }

  getIsoLevel() {
    return this.isoLevel;
  }

  setNormalMode(mode) {
    if (mode !== "central" && mode !== "tetrahedron") {
      console.warn(
        `Invalid normal mode: ${mode}. Use "central" or "tetrahedron".`,
      );
      return;
    }

    this.normalMode = mode === "tetrahedron" ? 1 : 0;
    this.material2D.uniforms.uNormalMode.value = this.normalMode;
    this.material3D.uniforms.uNormalMode.value = this.normalMode;

    console.log(`Normal calculation mode set to: ${mode}`);
  }

  getNormalMode() {
    return this.normalMode === 1 ? "tetrahedron" : "central";
  }

  setLightDir(x, y, z) {
    this.lightDir.set(x, y, z);
    this.material2D.uniforms.uLightDir.value = this.lightDir;
    this.material3D.uniforms.uLightDir.value = this.lightDir;
  }

  getLightDir() {
    return this.lightDir.clone();
  }

  setShadowSteps(steps) {
    this.shadowSteps = Math.max(1, Math.min(64, steps));
    this.material2D.uniforms.uShadowSteps.value = this.shadowSteps;
    this.material3D.uniforms.uShadowSteps.value = this.shadowSteps;
  }

  getShadowSteps() {
    return this.shadowSteps;
  }

  setShadowSoftness(softness) {
    this.shadowSoftness = Math.max(0.1, softness);
    this.material2D.uniforms.uShadowSoftness.value = this.shadowSoftness;
    this.material3D.uniforms.uShadowSoftness.value = this.shadowSoftness;
  }

  getShadowSoftness() {
    return this.shadowSoftness;
  }

  setShadowBias(bias) {
    this.shadowBias = Math.max(0.0, bias);
    this.material2D.uniforms.uShadowBias.value = this.shadowBias;
    this.material3D.uniforms.uShadowBias.value = this.shadowBias;
  }

  getShadowBias() {
    return this.shadowBias;
  }

  setShadowMaxDist(dist) {
    this.shadowMaxDist = Math.max(1.0, dist);
    this.material2D.uniforms.uShadowMaxDist.value = this.shadowMaxDist;
    this.material3D.uniforms.uShadowMaxDist.value = this.shadowMaxDist;
  }

  getShadowMaxDist() {
    return this.shadowMaxDist;
  }

  setBaseColor(r, g, b) {
    this.baseColor.set(r, g, b);
    this.material2D.uniforms.uBaseColor.value = this.baseColor;
    this.material3D.uniforms.uBaseColor.value = this.baseColor;
  }

  getBaseColor() {
    return this.baseColor.clone();
  }

  setAmbient(ambient) {
    this.ambient = Math.max(0.0, Math.min(1.0, ambient));
    this.material2D.uniforms.uAmbient.value = this.ambient;
    this.material3D.uniforms.uAmbient.value = this.ambient;
  }

  getAmbient() {
    return this.ambient;
  }

  getInfo() {
    const totalVoxels = this.size * this.size * this.size;
    const vertexCount = totalVoxels * 15;
    const textureTotalVoxels =
      this.textureSize * this.textureSize * this.textureSize;

    return {
      gridSize: this.size,
      textureSize: this.textureSize,
      textureToGridRatio: this.textureSize / this.size,
      textureMode: this.getTextureMode(),
      normalMode: this.getNormalMode(),
      isoLevel: this.isoLevel,
      grid: {
        totalVoxels: totalVoxels,
        maxVertices: vertexCount,
      },
      texture: {
        totalVoxels: textureTotalVoxels,
        atlasWidth: this.volumeRenderer.atlasWidth,
        atlasHeight: this.volumeRenderer.atlasHeight,
      },
      lighting: {
        lightDir: this.lightDir.toArray(),
        baseColor: this.baseColor.toArray(),
        ambient: this.ambient,
      },
      shadows: {
        steps: this.shadowSteps,
        softness: this.shadowSoftness,
        bias: this.shadowBias,
        maxDist: this.shadowMaxDist,
      },
    };
  }

  dispose() {
    this.triTableTexture.dispose();
    this.geometry.dispose();
    this.material2D.dispose();
    this.material3D.dispose();
    this.volumeRenderer.dispose();
  }
}

function getMaxGridSize(renderer) {
  const gl = renderer.getContext();

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const max3DTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
  const maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
  const maxVertexUniformVectors = gl.getParameter(
    gl.MAX_VERTEX_UNIFORM_VECTORS,
  );

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuVendor = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    : "Unknown";
  const gpuRenderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : "Unknown";

  const float32MaxInt = Math.pow(2, 24);
  const maxSizeFromPrecision = Math.floor(Math.cbrt(float32MaxInt / 15));

  const estimatedGPUMemoryMB = 512;
  const bytesPerVertex = 16;
  const maxVerticesFromMemory =
    (estimatedGPUMemoryMB * 1024 * 1024) / bytesPerVertex;
  const maxSizeFromMemory = Math.floor(Math.cbrt(maxVerticesFromMemory / 15));

  const practicalMaxVertices = 4000000;
  const maxSizeFromPerformance = Math.floor(
    Math.cbrt(practicalMaxVertices / 15),
  );

  let maxSizeFromAtlas = 1;
  for (let size = 1; size <= 1024; size++) {
    const slicesPerRow = Math.ceil(Math.sqrt(size));
    const atlasRows = Math.ceil(size / slicesPerRow);
    const atlasWidth = size * slicesPerRow;
    const atlasHeight = size * atlasRows;
    if (atlasWidth <= maxTextureSize && atlasHeight <= maxTextureSize) {
      maxSizeFromAtlas = size;
    } else {
      break;
    }
  }

  const maxSizeFrom3D = max3DTextureSize;

  const commonMaxSize = Math.min(
    maxSizeFromPrecision,
    maxSizeFromMemory,
    maxSizeFromPerformance,
  );

  const maxSizeAtlas = Math.min(commonMaxSize, maxSizeFromAtlas);
  const maxSize3D = Math.min(commonMaxSize, maxSizeFrom3D);

  const maxSize = Math.min(maxSizeAtlas, maxSize3D);

  return {
    maxSize,
    maxSizeByMode: {
      atlas: maxSizeAtlas,
      "3d": maxSize3D,
    },
    limits: {
      fromFloat32Precision: maxSizeFromPrecision,
      fromMemory: maxSizeFromMemory,
      fromPerformance: maxSizeFromPerformance,
      fromAtlasTexture: maxSizeFromAtlas,
      from3DTexture: maxSizeFrom3D,
    },
    gpu: {
      vendor: gpuVendor,
      renderer: gpuRenderer,
      maxTextureSize,
      max3DTextureSize,
      maxVertexAttribs,
    },
    recommendations: {
      atlas: {
        safe: Math.min(64, maxSizeAtlas),
        balanced: Math.min(80, maxSizeAtlas),
        maximum: maxSizeAtlas,
      },
      "3d": {
        safe: Math.min(64, maxSize3D),
        balanced: Math.min(80, maxSize3D),
        maximum: maxSize3D,
      },
    },
  };
}

export { MarchingCubes, VolumeRenderer, getMaxGridSize };
