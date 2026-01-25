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

const vertexShader2D = `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2D;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform isampler2D uTriTable;
uniform sampler2D uSDFTexture;
uniform vec3 uGridSize;
uniform vec3 uHalfGridSize;
uniform ivec3 uGridSizeInt;
uniform float uIsoLevel;
uniform float uSlicesPerRow;
uniform float uAtlasRows;
uniform vec2 uInvAtlasSize;

in uint vIndex;

out vec3 vNormal;
out vec3 vPos;

// Edge connection list
const int edgeConnections[24] = int[](
    0,1, 1,2, 2,3, 3,0,
    4,5, 5,6, 6,7, 7,4,
    0,4, 1,5, 2,6, 3,7
);

// Corner offsets
const vec3 corners[8] = vec3[](
    vec3(0,0,0), vec3(1,0,0), vec3(1,0,1), vec3(0,0,1),
    vec3(0,1,0), vec3(1,1,0), vec3(1,1,1), vec3(0,1,1)
);

// Sample SDF from the atlas texture (single slice, for marching cubes grid sampling)
float sampleSDF(vec3 pos) {
    pos = clamp(pos, vec3(0.0), uGridSize - 1.0);
    
    float z = pos.z;
    int sliceX = int(mod(z, uSlicesPerRow));
    int sliceY = int(z / uSlicesPerRow);
    
    float u = (float(sliceX) * uGridSize.x + pos.x + 0.5) * uInvAtlasSize.x;
    float v = (float(sliceY) * uGridSize.y + pos.y + 0.5) * uInvAtlasSize.y;
    
    return texture(uSDFTexture, vec2(u, v)).r;
}

// Sample SDF with Z-axis interpolation (for smooth normals)
// Hardware bilinear handles X/Y, we manually interpolate Z between slices
float sampleSDFSmooth(vec3 pos) {
    pos = clamp(pos, vec3(0.0), uGridSize - 1.0);
    
    float z = pos.z;
    float zFloor = floor(z);
    float zCeil = min(zFloor + 1.0, uGridSize.z - 1.0);
    float zFrac = z - zFloor;
    
    // Sample from floor Z slice
    int sliceX0 = int(mod(zFloor, uSlicesPerRow));
    int sliceY0 = int(zFloor / uSlicesPerRow);
    float u0 = (float(sliceX0) * uGridSize.x + pos.x + 0.5) * uInvAtlasSize.x;
    float v0 = (float(sliceY0) * uGridSize.y + pos.y + 0.5) * uInvAtlasSize.y;
    float val0 = texture(uSDFTexture, vec2(u0, v0)).r;
    
    // Sample from ceil Z slice
    int sliceX1 = int(mod(zCeil, uSlicesPerRow));
    int sliceY1 = int(zCeil / uSlicesPerRow);
    float u1 = (float(sliceX1) * uGridSize.x + pos.x + 0.5) * uInvAtlasSize.x;
    float v1 = (float(sliceY1) * uGridSize.y + pos.y + 0.5) * uInvAtlasSize.y;
    float val1 = texture(uSDFTexture, vec2(u1, v1)).r;
    
    return mix(val0, val1, zFrac);
}

// Central difference normal with Z-interpolation - 12 texture fetches
vec3 getNormal(vec3 p) {
    float eps = 1.0;
    float dx = sampleSDFSmooth(p + vec3(eps, 0.0, 0.0)) - sampleSDFSmooth(p - vec3(eps, 0.0, 0.0));
    float dy = sampleSDFSmooth(p + vec3(0.0, eps, 0.0)) - sampleSDFSmooth(p - vec3(0.0, eps, 0.0));
    float dz = sampleSDFSmooth(p + vec3(0.0, 0.0, eps)) - sampleSDFSmooth(p - vec3(0.0, 0.0, eps));
    return -normalize(vec3(dx, dy, dz));
}

void main() {
    int id = int(vIndex);
    int voxelID = id / 15;
    int vertexID = id % 15;

    int gridXY = uGridSizeInt.x * uGridSizeInt.y;
    
    int z = voxelID / gridXY;
    int temp = voxelID - z * gridXY;
    int y = temp / uGridSizeInt.x;
    int x = temp - y * uGridSizeInt.x;

    if (x >= uGridSizeInt.x - 1 || y >= uGridSizeInt.y - 1 || z >= uGridSizeInt.z - 1) {
        gl_Position = vec4(0.0);
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
        gl_Position = vec4(0.0);
        return;
    }

    int v1 = edgeConnections[edgeIndex * 2];
    int v2 = edgeConnections[edgeIndex * 2 + 1];

    vec3 p1 = pos + corners[v1];
    vec3 p2 = pos + corners[v2];
    float val1 = values[v1];
    float val2 = values[v2];

    float t = (uIsoLevel - val1) / (val2 - val1);
    vec3 finalPos = mix(p1, p2, t);

    vNormal = getNormal(finalPos);
    
    vec3 centeredPos = finalPos - uHalfGridSize;
    
    vPos = centeredPos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(centeredPos, 1.0);
}
`;

const vertexShader3D = `
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp isampler2D;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform isampler2D uTriTable;
uniform sampler3D utexture3D;
uniform vec3 uGridSize;
uniform vec3 uHalfGridSize;
uniform vec3 uInvGridSize;
uniform ivec3 uGridSizeInt;
uniform float uIsoLevel;

in uint vIndex;

out vec3 vNormal;
out vec3 vPos;

// Edge connection list
const int edgeConnections[24] = int[](
    0,1, 1,2, 2,3, 3,0,
    4,5, 5,6, 6,7, 7,4,
    0,4, 1,5, 2,6, 3,7
);

// Corner offsets
const vec3 corners[8] = vec3[](
    vec3(0,0,0), vec3(1,0,0), vec3(1,0,1), vec3(0,0,1),
    vec3(0,1,0), vec3(1,1,0), vec3(1,1,1), vec3(0,1,1)
);

// Sample SDF from 3D texture - hardware trilinear filtering
float sampleSDF(vec3 pos) {
    vec3 uvw = (pos + 0.5) * uInvGridSize;
    return texture(utexture3D, uvw).r;
}

// Central difference normal - 6 texture fetches
vec3 getNormal(vec3 p) {
    float eps = 1.0;
    float dx = sampleSDF(p + vec3(eps, 0.0, 0.0)) - sampleSDF(p - vec3(eps, 0.0, 0.0));
    float dy = sampleSDF(p + vec3(0.0, eps, 0.0)) - sampleSDF(p - vec3(0.0, eps, 0.0));
    float dz = sampleSDF(p + vec3(0.0, 0.0, eps)) - sampleSDF(p - vec3(0.0, 0.0, eps));
    return -normalize(vec3(dx, dy, dz));
}

void main() {
    int id = int(vIndex);
    int voxelID = id / 15;
    int vertexID = id % 15;

    int gridXY = uGridSizeInt.x * uGridSizeInt.y;
    
    int z = voxelID / gridXY;
    int temp = voxelID - z * gridXY;
    int y = temp / uGridSizeInt.x;
    int x = temp - y * uGridSizeInt.x;

    if (x >= uGridSizeInt.x - 1 || y >= uGridSizeInt.y - 1 || z >= uGridSizeInt.z - 1) {
        gl_Position = vec4(0.0);
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
        gl_Position = vec4(0.0);
        return;
    }

    int v1 = edgeConnections[edgeIndex * 2];
    int v2 = edgeConnections[edgeIndex * 2 + 1];

    vec3 p1 = pos + corners[v1];
    vec3 p2 = pos + corners[v2];
    float val1 = values[v1];
    float val2 = values[v2];

    float t = (uIsoLevel - val1) / (val2 - val1);
    vec3 finalPos = mix(p1, p2, t);

    vNormal = getNormal(finalPos);
    
    vec3 centeredPos = finalPos - uHalfGridSize;
    
    vPos = centeredPos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(centeredPos, 1.0);
}
`;

const fragmentShader = `
precision highp float;

in vec3 vNormal;
in vec3 vPos;
out vec4 fragColor;

void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
    
    float diff = 0.5 + 0.5 * max(dot(normal, lightDir), 0.0);
    vec3 color = vec3(0.0, 0.7, 1.0) * diff + vec3(0.1);

    fragColor = vec4(color, 1.0);
}
`;

class MarchingCubes {
  constructor(options = {}) {
    const { size = 64, isoLevel = ISO_LEVEL, volumeRenderer } = options;

    this.size = size;
    this.isoLevel = isoLevel;

    this.volumeRenderer = volumeRenderer || new VolumeRenderer(size);

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
      IntType
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

    const gridSize = new Vector3(s, s, s);
    const halfGridSize = new Vector3(s * 0.5, s * 0.5, s * 0.5);
    const invGridSize = new Vector3(1.0 / s, 1.0 / s, 1.0 / s);
    const invAtlasSize = new Vector2(1.0 / vr.atlasWidth, 1.0 / vr.atlasHeight);

    this.material2D = new RawShaderMaterial({
      uniforms: {
        uTriTable: { value: this.triTableTexture },
        uSDFTexture: { value: vr.renderTarget2D.texture },
        uGridSize: { value: gridSize },
        uHalfGridSize: { value: halfGridSize },
        uGridSizeInt: { value: [s, s, s] },
        uIsoLevel: { value: this.isoLevel },
        uSlicesPerRow: { value: vr.slicesPerRow },
        uAtlasRows: { value: vr.atlasRows },
        uInvAtlasSize: { value: invAtlasSize },
        modelViewMatrix: { value: new Matrix4() },
        projectionMatrix: { value: new Matrix4() },
      },
      vertexShader: vertexShader2D,
      fragmentShader: fragmentShader,
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
        modelViewMatrix: { value: new Matrix4() },
        projectionMatrix: { value: new Matrix4() },
      },
      vertexShader: vertexShader3D,
      fragmentShader: fragmentShader,
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

  getInfo() {
    return {
      currentSize: this.size,
      textureMode: this.getTextureMode(),
      current: {
        vertexCount: currentVertexCount,
        memoryMB: currentMemoryMB.toFixed(2),
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
    gl.MAX_VERTEX_UNIFORM_VECTORS
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
    Math.cbrt(practicalMaxVertices / 15)
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
    maxSizeFromPerformance
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
