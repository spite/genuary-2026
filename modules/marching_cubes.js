import { triTable } from "modules/MarchingCubesGeometry.js";
import {
  BufferGeometry,
  Color,
  NearestFilter,
  LinearFilter,
  ClampToEdgeWrapping,
  DataTexture,
  Mesh,
  RedIntegerFormat,
  RGBAFormat,
  IntType,
  UnsignedByteType,
  RawShaderMaterial,
  Matrix3,
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
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
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
out vec3 vWorldPosition;
out vec3 vGridPos;
out float vShadow;
out float vSDFId;
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

    vec3 objectNormal = getNormal(finalPos);
    // Transform normal to view space (will convert to world space in fragment shader)
    vNormal = normalize(normalMatrix * objectNormal);
    vGridPos = finalPos;
    vShadow = calcShadow(finalPos, normalize(uLightDir));
    vSDFId = sampleSDF2(finalPos).y;
    
    vec3 centeredPos = finalPos - uHalfGridSize;
    vec4 worldPos = modelMatrix * vec4(centeredPos, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(centeredPos, 1.0);
}
`;

// PBR lighting functions
const PBR_FUNCTIONS = `
#define PI 3.141592653589793
#define RECIPROCAL_PI 0.3183098861837907
#define EPSILON 1e-6
#define saturate( a ) clamp( a, 0.0, 1.0 )

vec3 RRTAndODTFit( vec3 v ) {
    vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
    vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
    return a / b;
}

vec3 ACESFilmicToneMapping( vec3 color, float exposure ) {
    const mat3 ACESInputMat = mat3(
        0.59719, 0.07600, 0.02840,
        0.35458, 0.90834, 0.13383,
        0.04823, 0.01566, 0.83777
    );
    const mat3 ACESOutputMat = mat3(
        1.60475, -0.10208, -0.00327,
        -0.53108,  1.10813, -0.07276,
        -0.07367, -0.00605,  1.07602
    );
    color *= exposure / 0.6;
    color = ACESInputMat * color;
    color = RRTAndODTFit( color );
    color = ACESOutputMat * color;
    return saturate( color );
}

vec4 linearToSRGB( in vec4 value ) {
    return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}

vec3 F_Schlick(float u, vec3 f0) { 
    return f0 + (vec3(1.0) - f0) * pow(1.0 - u, 5.0); 
}

vec3 F_SchlickRoughness(float u, vec3 f0, float roughness) {
    return f0 + (max(vec3(1.0 - roughness), f0) - f0) * pow(1.0 - u, 5.0);
}

float D_GGX(float NdotH, float alpha) {
    float a2 = alpha * alpha;
    float f = (NdotH * NdotH) * (a2 - 1.0) + 1.0;
    return a2 / (PI * f * f);
}

float V_GGX_SmithCorrelated(float alpha, float dotNV, float dotNL) {
    float a2 = alpha * alpha;
    float gv = dotNL * sqrt(dotNV * dotNV * (1.0 - a2) + a2);
    float gl = dotNV * sqrt(dotNL * dotNL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, EPSILON);
}

vec2 EnvBRDFApprox(float roughness, float NoV) {
    vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = roughness * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
    return AB;
}

// PMREM Sampling
#define cubeUV_minMipLevel 4.0
#define cubeUV_minTileSize 16.0

float getFace( vec3 direction ) {
    vec3 absDirection = abs( direction );
    float face = - 1.0;
    if ( absDirection.x > absDirection.z ) {
        if ( absDirection.x > absDirection.y )
            face = direction.x > 0.0 ? 0.0 : 3.0;
        else
            face = direction.y > 0.0 ? 1.0 : 4.0;
    } else {
        if ( absDirection.z > absDirection.y )
            face = direction.z > 0.0 ? 2.0 : 5.0;
        else
            face = direction.y > 0.0 ? 1.0 : 4.0;
    }
    return face;
}

vec2 getUV( vec3 direction, float face ) {
    vec2 uv;
    if ( face == 0.0 ) {
        uv = vec2( direction.z, direction.y ) / abs( direction.x );
    } else if ( face == 1.0 ) {
        uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
    } else if ( face == 2.0 ) {
        uv = vec2( - direction.x, direction.y ) / abs( direction.z );
    } else if ( face == 3.0 ) {
        uv = vec2( - direction.z, direction.y ) / abs( direction.x );
    } else if ( face == 4.0 ) {
        uv = vec2( - direction.x, direction.z ) / abs( direction.y );
    } else {
        uv = vec2( direction.x, direction.y ) / abs( direction.z );
    }
    return 0.5 * ( uv + 1.0 );
}

vec3 bilinearCubeUV( sampler2D envMapSampler, vec3 direction, float mipInt, float cubeUV_maxMip, float cubeUV_texelWidth, float cubeUV_texelHeight ) {
    float face = getFace( direction );
    float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
    mipInt = max( mipInt, cubeUV_minMipLevel );
    float faceSize = exp2( mipInt );
    
    highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
    
    if ( face > 2.0 ) {
        uv.y += faceSize;
        face -= 3.0;
    }
    
    uv.x += face * faceSize;
    uv.x += filterInt * 3.0 * cubeUV_minTileSize;
    uv.y += 4.0 * ( exp2( cubeUV_maxMip ) - faceSize );
    
    uv.x *= cubeUV_texelWidth;
    uv.y *= cubeUV_texelHeight;

    return texture( envMapSampler, uv ).rgb;
}

#define cubeUV_r0 1.0
#define cubeUV_m0 - 2.0
#define cubeUV_r1 0.8
#define cubeUV_m1 - 1.0
#define cubeUV_r4 0.4
#define cubeUV_m4 2.0
#define cubeUV_r5 0.305
#define cubeUV_m5 3.0
#define cubeUV_r6 0.21
#define cubeUV_m6 4.0

float roughnessToMip( float roughness ) {
    float mip = 0.0;
    if ( roughness >= cubeUV_r1 ) {
        mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
    } else if ( roughness >= cubeUV_r4 ) {
        mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
    } else if ( roughness >= cubeUV_r5 ) {
        mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
    } else if ( roughness >= cubeUV_r6 ) {
        mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
    } else {
        mip = - 2.0 * log2( 1.16 * roughness );
    }
    return mip;
}

vec4 textureCubeUV( sampler2D envMapSampler, vec3 sampleDir, float roughness, float cubeUV_maxMip, float cubeUV_texelWidth, float cubeUV_texelHeight ) {
    float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, cubeUV_maxMip );
    float mipF = fract( mip );
    float mipInt = floor( mip );
    
    vec3 color0 = bilinearCubeUV( envMapSampler, sampleDir, mipInt, cubeUV_maxMip, cubeUV_texelWidth, cubeUV_texelHeight );
    if ( mipF == 0.0 ) {
        return vec4( color0, 1.0 );
    } else {
        vec3 color1 = bilinearCubeUV( envMapSampler, sampleDir, mipInt + 1.0, cubeUV_maxMip, cubeUV_texelWidth, cubeUV_texelHeight );
        return vec4( mix( color0, color1, mipF ), 1.0 );
    }
}
`;

const PBR_UNIFORMS = `
uniform vec3 uBaseColor;
uniform float uRoughness;
uniform float uMetalness;
uniform vec3 uAmbientColor;
uniform float uToneMappingExposure;

uniform vec3 uLightDir;
uniform vec3 uLightColor;

uniform bool uHasEnvMap;
uniform sampler2D uEnvMap;
uniform float uEnvMapIntensity;
uniform float uCubeUV_maxMip;
uniform float uCubeUV_texelWidth;
uniform float uCubeUV_texelHeight;

uniform vec3 uCameraPosition;
uniform mat4 viewMatrix;

uniform sampler2D uColorGradient;
uniform float uColorGradientCount;
uniform bool uUseColorGradient;

uniform vec3 uMouse;
`;

const FRAGMENT_MAIN = `
void main() {
    // Transform view-space normal to world space
    mat3 viewMatrixInverse = mat3(inverse(viewMatrix));
    vec3 normal = normalize(viewMatrixInverse * vNormal);
    
    vec3 lightDir = normalize(uLightDir);
    vec3 viewDir = normalize(uCameraPosition - vWorldPosition);
    
    // Shadow calculation
    float shadow = vShadow;
    if (vShadow > 0.001 && vShadow < 0.999) {
        shadow = calcShadow(vGridPos, lightDir);
    }
    
    // PBR parameters
    float roughnessFactor = max(uRoughness, 0.0525);
    float alpha = roughnessFactor * roughnessFactor;
    float metalnessFactor = uMetalness;
    
    vec3 f0 = vec3(0.04);
    vec3 baseColor = uBaseColor;
    if (uUseColorGradient) {
        // Map vSDFId 1..N to gradient position 0..1
        float gradientU = clamp((vSDFId - 1.0) / max(uColorGradientCount - 1.0, 1.0), 0.0, 1.0);
        baseColor = texture(uColorGradient, vec2(gradientU, 0.5)).rgb;
    }
    f0 = mix(f0, baseColor, metalnessFactor);
    vec3 diffuseReflectance = baseColor * (1.0 - metalnessFactor);
    
    // Direct lighting (Cook-Torrance BRDF)
    vec3 H = normalize(lightDir + viewDir);
    float NdotL = clamp(dot(normal, lightDir), 0.0, 1.0);
    float NdotV = clamp(abs(dot(normal, viewDir)), 0.0, 1.0);
    float NdotH = clamp(dot(normal, H), 0.0, 1.0);
    float VdotH = clamp(dot(viewDir, H), 0.0, 1.0);
    
    vec3 reflectedLight = vec3(0.0);
    vec3 diffuseLight = vec3(0.0);
    
    if (NdotL > 0.0) {
        vec3 F = F_Schlick(VdotH, f0);
        float D = D_GGX(NdotH, alpha);
        float V = V_GGX_SmithCorrelated(alpha, NdotV, NdotL);
        vec3 specular = F * (D * V);
        vec3 kD = (vec3(1.0) - F) * (1.0 - metalnessFactor);
        vec3 diffuse = diffuseReflectance * RECIPROCAL_PI;
        
        // Apply shadow to direct lighting
        reflectedLight += specular * uLightColor * NdotL * shadow;
        diffuseLight += diffuse * uLightColor * NdotL * shadow;
    }
    
    // Indirect lighting
    vec3 indirectSpecular = vec3(0.0);
    vec3 indirectDiffuse = diffuseReflectance * uAmbientColor * RECIPROCAL_PI;
    
    if (uHasEnvMap) {
        // Reflection vector
        vec3 worldReflectVec = reflect(-viewDir, normal);
        worldReflectVec = normalize(mix(worldReflectVec, normal, roughnessFactor * roughnessFactor));
        
        // Sample prefiltered radiance
        vec3 radiance = textureCubeUV(uEnvMap, worldReflectVec, roughnessFactor, uCubeUV_maxMip, uCubeUV_texelWidth, uCubeUV_texelHeight).rgb;
        radiance *= uEnvMapIntensity;
        
        // Environment diffuse irradiance
        vec3 iblIrradiance = textureCubeUV(uEnvMap, normal, 1.0, uCubeUV_maxMip, uCubeUV_texelWidth, uCubeUV_texelHeight).rgb;
        iblIrradiance *= uEnvMapIntensity;
        
        // DFG approximation
        vec2 fab = EnvBRDFApprox(roughnessFactor, NdotV);
        
        // Single scattering
        float specularF90 = 1.0;
        vec3 FssEss = f0 * fab.x + specularF90 * fab.y;
        
        // Multi-scattering compensation
        float Ess = fab.x + fab.y;
        float Ems = 1.0 - Ess;
        vec3 Favg = f0 + (1.0 - f0) * 0.047619;
        vec3 Fms = FssEss * Favg / (1.0 - Ems * Favg);
        
        vec3 singleScattering = FssEss;
        vec3 multiScattering = Fms * Ems;
        vec3 totalScattering = singleScattering + multiScattering;
        
        vec3 iblDiffuse = diffuseReflectance * (1.0 - max(max(totalScattering.r, totalScattering.g), totalScattering.b));
        
        indirectSpecular = radiance * singleScattering + multiScattering * iblIrradiance;
        indirectDiffuse += iblDiffuse * iblIrradiance;
    }
    
    // In PBR, shadow only affects direct lighting (already applied above)
    // Indirect lighting (IBL) represents light from all environment directions
    // and is not blocked by a single directional shadow
    vec3 outgoingLight = reflectedLight + diffuseLight + indirectDiffuse + indirectSpecular;
    outgoingLight = ACESFilmicToneMapping(outgoingLight, uToneMappingExposure);
    // outgoingLight = vec3(shadow);
    fragColor = linearToSRGB(vec4(outgoingLight, 1.0));
}
`;

// 2D Atlas specific sampling
const SAMPLE_SDF_2D = `
vec2 sampleSDF2(vec3 gridPos) {
    vec3 pos = gridPos * uGridToTexScale;
    pos = clamp(pos, vec3(0.0), uTextureSize - 1.0);
    
    float z = floor(pos.z + 0.5);
    int sliceX = int(mod(z, uSlicesPerRow));
    int sliceY = int(z / uSlicesPerRow);
    
    float u = (float(sliceX) * uTextureSize.x + pos.x + 0.5) * uInvAtlasSize.x;
    float v = (float(sliceY) * uTextureSize.y + pos.y + 0.5) * uInvAtlasSize.y;
    
    return texture(uSDFTexture, vec2(u, v)).rg;
}

float sampleSDF(vec3 gridPos) {
    return sampleSDF2(gridPos).x;
}
`;

const SAMPLE_SDF_SMOOTH_2D = `
vec2 sampleSDFSmooth2(vec3 gridPos) {
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
    vec2 val0 = texture(uSDFTexture, vec2(u0, v0)).rg;
    
    int sliceX1 = int(mod(zCeilRounded, uSlicesPerRow));
    int sliceY1 = int(zCeilRounded / uSlicesPerRow);
    float u1 = (float(sliceX1) * uTextureSize.x + pos.x + 0.5) * uInvAtlasSize.x;
    float v1 = (float(sliceY1) * uTextureSize.y + pos.y + 0.5) * uInvAtlasSize.y;
    vec2 val1 = texture(uSDFTexture, vec2(u1, v1)).rg;
    
    return mix(val0, val1, zFrac);
}

float sampleSDFSmooth(vec3 gridPos) {
    return sampleSDFSmooth2(gridPos).x;
}
`;

// 3D Texture specific sampling
const SAMPLE_SDF_3D = `
vec2 sampleSDF2(vec3 gridPos) {
    vec3 pos = gridPos * uGridToTexScale;
    vec3 uvw = (pos + 0.5) * uInvTextureSize;
    return texture(utexture3D, uvw).rg;
}

float sampleSDF(vec3 gridPos) {
    return sampleSDF2(gridPos).x;
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
${CALC_SHADOW_TEMPLATE.replace(/SAMPLE_FUNC/g, "sampleSDFSmooth")}
${NORMAL_FUNCTIONS_TEMPLATE.replace(/SAMPLE_FUNC/g, "sampleSDFSmooth")}
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
${CALC_SHADOW_TEMPLATE.replace(/SAMPLE_FUNC/g, "sampleSDF")}
${NORMAL_FUNCTIONS_TEMPLATE.replace(/SAMPLE_FUNC/g, "sampleSDF")}
${VERTEX_MAIN}
`;

// Build fragment shaders
const fragmentShader2D = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSDFTexture;
uniform vec3 uTextureSize;
uniform float uSlicesPerRow;
uniform vec2 uInvAtlasSize;
${SHADOW_UNIFORMS}
${PBR_UNIFORMS}

in vec3 vNormal;
in vec3 vWorldPosition;
in vec3 vGridPos;
in float vShadow;
in float vSDFId;
out vec4 fragColor;

${PBR_FUNCTIONS}
${SAMPLE_SDF_SMOOTH_2D}
${CALC_SHADOW_TEMPLATE.replace(/SAMPLE_FUNC/g, "sampleSDFSmooth")}
${FRAGMENT_MAIN}
`;

const fragmentShader3D = `
precision highp float;
precision highp int;
precision highp sampler3D;

uniform sampler3D utexture3D;
uniform vec3 uInvTextureSize;
${SHADOW_UNIFORMS}
${PBR_UNIFORMS}

in vec3 vNormal;
in vec3 vWorldPosition;
in vec3 vGridPos;
in float vShadow;
in float vSDFId;
out vec4 fragColor;

${PBR_FUNCTIONS}
${SAMPLE_SDF_3D}
${CALC_SHADOW_TEMPLATE.replace(/SAMPLE_FUNC/g, "sampleSDF")}
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

    // Track if we own the volume renderer (for proper disposal)
    this._ownsVolumeRenderer = !volumeRenderer;
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
    this.lightColor = new Vector3(1.0, 1.0, 1.0);
    this.shadowSteps = 32;
    this.shadowSoftness = 8.0;
    this.shadowBias = 1;
    this.shadowMaxDist = s * 0.5;

    // PBR material properties
    this.baseColor = new Vector3(0.8, 0.8, 0.8);
    this.roughness = 0.5;
    this.metalness = 0.0;
    this.ambientColor = new Color(0x000000);
    this.toneMappingExposure = 1.0;

    // Environment map
    this.envMapIntensity = 1.0;
    this.cubeUV_maxMip = 8.0;
    this.cubeUV_texelWidth = 1.0 / 768.0;
    this.cubeUV_texelHeight = 1.0 / 1024.0;

    // Camera position (updated in onBeforeRender)
    this.cameraPosition = new Vector3();

    // Color gradient
    this.colorGradientCount = 10.0; // Default: 10 colors in rainbow
    this.useColorGradient = true;
    this.initColorGradient();

    // Mouse position in grid-centered coordinates
    this.mouse = new Vector3(0, 0, 0);

    // Common uniforms for both materials
    const commonUniforms = {
      uGridSize: { value: gridSize },
      uHalfGridSize: { value: halfGridSize },
      uGridSizeInt: { value: [s, s, s] },
      uIsoLevel: { value: this.isoLevel },
      uTextureSize: { value: textureSize },
      uGridToTexScale: { value: gridToTexScale },
      uInv15: { value: inv15 },
      uInvGridXY: { value: invGridXY },
      uInvGridX: { value: invGridX },
      uNormalMode: { value: this.normalMode },
      uLightDir: { value: this.lightDir },
      uLightColor: { value: this.lightColor },
      uShadowSteps: { value: this.shadowSteps },
      uShadowSoftness: { value: this.shadowSoftness },
      uShadowBias: { value: this.shadowBias },
      uShadowMaxDist: { value: this.shadowMaxDist },
      uBaseColor: { value: this.baseColor },
      uRoughness: { value: this.roughness },
      uMetalness: { value: this.metalness },
      uAmbientColor: { value: this.ambientColor },
      uToneMappingExposure: { value: this.toneMappingExposure },
      uHasEnvMap: { value: false },
      uEnvMap: { value: null },
      uEnvMapIntensity: { value: this.envMapIntensity },
      uCubeUV_maxMip: { value: this.cubeUV_maxMip },
      uCubeUV_texelWidth: { value: this.cubeUV_texelWidth },
      uCubeUV_texelHeight: { value: this.cubeUV_texelHeight },
      uCameraPosition: { value: this.cameraPosition },
      viewMatrix: { value: new Matrix4() },
      modelMatrix: { value: new Matrix4() },
      modelViewMatrix: { value: new Matrix4() },
      projectionMatrix: { value: new Matrix4() },
      normalMatrix: { value: new Matrix3() },
      uColorGradient: { value: this.colorGradientTexture },
      uColorGradientCount: { value: this.colorGradientCount },
      uUseColorGradient: { value: this.useColorGradient },
      uMouse: { value: this.mouse },
    };

    this.material2D = new RawShaderMaterial({
      uniforms: {
        ...commonUniforms,
        uTriTable: { value: this.triTableTexture },
        uSDFTexture: { value: vr.renderTarget2D.texture },
        uSlicesPerRow: { value: vr.slicesPerRow },
        uAtlasRows: { value: vr.atlasRows },
        uInvAtlasSize: { value: invAtlasSize },
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
        ...commonUniforms,
        uTriTable: { value: this.triTableTexture },
        utexture3D: { value: vr.texture3D },
        uInvGridSize: { value: invGridSize },
        uInvTextureSize: { value: invTextureSize },
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
      mat.uniforms.viewMatrix.value.copy(camera.matrixWorldInverse);
      mat.uniforms.modelMatrix.value.copy(this.matrixWorld);
      mat.uniforms.modelViewMatrix.value.copy(this.modelViewMatrix);
      mat.uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
      mat.uniforms.normalMatrix.value.getNormalMatrix(this.modelViewMatrix);
      mat.uniforms.uCameraPosition.value.copy(camera.position);
    };
  }

  initColorGradient() {
    // Create a rainbow gradient texture (256 pixels wide)
    const width = 256;
    const data = new Uint8Array(width * 4);

    for (let i = 0; i < width; i++) {
      const t = i / (width - 1);
      const hue = t;
      const rgb = this.hslToRgb(hue, 1.0, 0.5);
      data[i * 4 + 0] = Math.round(rgb[0] * 255);
      data[i * 4 + 1] = Math.round(rgb[1] * 255);
      data[i * 4 + 2] = Math.round(rgb[2] * 255);
      data[i * 4 + 3] = 255;
    }

    this.colorGradientTexture = new DataTexture(
      data,
      width,
      1,
      RGBAFormat,
      UnsignedByteType,
    );
    this.colorGradientTexture.minFilter = LinearFilter;
    this.colorGradientTexture.magFilter = LinearFilter;
    this.colorGradientTexture.wrapS = ClampToEdgeWrapping;
    this.colorGradientTexture.wrapT = ClampToEdgeWrapping;
    this.colorGradientTexture.needsUpdate = true;
  }

  hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r, g, b];
  }

  setColorGradient(colors) {
    // Set a custom gradient from an array of Color objects or hex values
    const width = 256;
    const data = new Uint8Array(width * 4);
    const numColors = colors.length;

    for (let i = 0; i < width; i++) {
      const t = i / (width - 1);
      const scaledT = t * (numColors - 1);
      const index = Math.floor(scaledT);
      const frac = scaledT - index;

      const c1 = colors[Math.min(index, numColors - 1)];
      const c2 = colors[Math.min(index + 1, numColors - 1)];

      const color1 = c1 instanceof Color ? c1 : new Color(c1);
      const color2 = c2 instanceof Color ? c2 : new Color(c2);

      data[i * 4 + 0] = Math.round(
        (color1.r + (color2.r - color1.r) * frac) * 255,
      );
      data[i * 4 + 1] = Math.round(
        (color1.g + (color2.g - color1.g) * frac) * 255,
      );
      data[i * 4 + 2] = Math.round(
        (color1.b + (color2.b - color1.b) * frac) * 255,
      );
      data[i * 4 + 3] = 255;
    }

    this.colorGradientTexture.image.data.set(data);
    this.colorGradientTexture.needsUpdate = true;

    // Automatically set the count to match the number of colors
    this.setColorGradientCount(numColors);
  }

  setColorGradientCount(count) {
    this.colorGradientCount = count;
    this.material2D.uniforms.uColorGradientCount.value = count;
    this.material3D.uniforms.uColorGradientCount.value = count;
  }

  getColorGradientCount() {
    return this.colorGradientCount;
  }

  setUseColorGradient(use) {
    this.useColorGradient = use;
    this.material2D.uniforms.uUseColorGradient.value = use;
    this.material3D.uniforms.uUseColorGradient.value = use;
  }

  getUseColorGradient() {
    return this.useColorGradient;
  }

  setMouse(x, y, z = 0) {
    this.mouse.set(x, y, z);
    // Also forward to volume renderer so SDF can use it
    this.volumeRenderer.setMouse(x, y, z);
  }

  getMouse() {
    return this.mouse.clone();
  }

  /**
   * Set a new volume renderer (replaces the current one)
   * @param {VolumeRenderer} volumeRenderer - The new volume renderer
   * @param {boolean} takeOwnership - If true, MarchingCubes will dispose it on cleanup
   */
  setVolumeRenderer(volumeRenderer, takeOwnership = false) {
    // Dispose old one if we owned it
    if (this._ownsVolumeRenderer && this.volumeRenderer) {
      this.volumeRenderer.dispose();
    }

    this.volumeRenderer = volumeRenderer;
    this._ownsVolumeRenderer = takeOwnership;

    // Update material textures
    const vr = this.volumeRenderer;
    const invAtlasSize = { x: 1.0 / vr.atlasWidth, y: 1.0 / vr.atlasHeight };

    this.material2D.uniforms.uSDFTexture.value = vr.renderTarget2D.texture;
    this.material2D.uniforms.uSlicesPerRow.value = vr.slicesPerRow;
    this.material2D.uniforms.uAtlasRows.value = vr.atlasRows;
    this.material2D.uniforms.uInvAtlasSize.value.set(
      invAtlasSize.x,
      invAtlasSize.y,
    );

    this.material3D.uniforms.utexture3D.value = vr.texture3D;
  }

  /**
   * Get the current volume renderer
   * @returns {VolumeRenderer}
   */
  getVolumeRenderer() {
    return this.volumeRenderer;
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

  setAmbientColor(color) {
    if (color instanceof Color) {
      this.ambientColor.copy(color);
    } else if (typeof color === "number") {
      this.ambientColor.set(color);
    } else {
      this.ambientColor.set(color);
    }
    this.material2D.uniforms.uAmbientColor.value = this.ambientColor;
    this.material3D.uniforms.uAmbientColor.value = this.ambientColor;
  }

  getAmbientColor() {
    return this.ambientColor.clone();
  }

  setRoughness(roughness) {
    this.roughness = Math.max(0.0, Math.min(1.0, roughness));
    this.material2D.uniforms.uRoughness.value = this.roughness;
    this.material3D.uniforms.uRoughness.value = this.roughness;
  }

  getRoughness() {
    return this.roughness;
  }

  setMetalness(metalness) {
    this.metalness = Math.max(0.0, Math.min(1.0, metalness));
    this.material2D.uniforms.uMetalness.value = this.metalness;
    this.material3D.uniforms.uMetalness.value = this.metalness;
  }

  getMetalness() {
    return this.metalness;
  }

  setLightColor(r, g, b) {
    this.lightColor.set(r, g, b);
    this.material2D.uniforms.uLightColor.value = this.lightColor;
    this.material3D.uniforms.uLightColor.value = this.lightColor;
  }

  getLightColor() {
    return this.lightColor.clone();
  }

  setEnvMap(texture) {
    if (!texture) {
      this.material2D.uniforms.uHasEnvMap.value = false;
      this.material3D.uniforms.uHasEnvMap.value = false;
      return;
    }

    const height =
      texture.image?.height || texture.source?.data?.height || 1024;
    const faceSize = height / 4;
    const cubeUV_maxMip = Math.log2(faceSize);
    const cubeUV_texelWidth = 1.0 / (3 * Math.pow(2, cubeUV_maxMip));
    const cubeUV_texelHeight = 1.0 / (4 * Math.pow(2, cubeUV_maxMip));

    this.cubeUV_maxMip = cubeUV_maxMip;
    this.cubeUV_texelWidth = cubeUV_texelWidth;
    this.cubeUV_texelHeight = cubeUV_texelHeight;

    this.material2D.uniforms.uEnvMap.value = texture;
    this.material2D.uniforms.uCubeUV_maxMip.value = cubeUV_maxMip;
    this.material2D.uniforms.uCubeUV_texelWidth.value = cubeUV_texelWidth;
    this.material2D.uniforms.uCubeUV_texelHeight.value = cubeUV_texelHeight;
    this.material2D.uniforms.uHasEnvMap.value = true;

    this.material3D.uniforms.uEnvMap.value = texture;
    this.material3D.uniforms.uCubeUV_maxMip.value = cubeUV_maxMip;
    this.material3D.uniforms.uCubeUV_texelWidth.value = cubeUV_texelWidth;
    this.material3D.uniforms.uCubeUV_texelHeight.value = cubeUV_texelHeight;
    this.material3D.uniforms.uHasEnvMap.value = true;
  }

  setEnvMapIntensity(intensity) {
    this.envMapIntensity = Math.max(0.0, intensity);
    this.material2D.uniforms.uEnvMapIntensity.value = this.envMapIntensity;
    this.material3D.uniforms.uEnvMapIntensity.value = this.envMapIntensity;
  }

  getEnvMapIntensity() {
    return this.envMapIntensity;
  }

  setToneMappingExposure(exposure) {
    this.toneMappingExposure = Math.max(0.0, exposure);
    this.material2D.uniforms.uToneMappingExposure.value =
      this.toneMappingExposure;
    this.material3D.uniforms.uToneMappingExposure.value =
      this.toneMappingExposure;
  }

  getToneMappingExposure() {
    return this.toneMappingExposure;
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
        lightColor: this.lightColor.toArray(),
        baseColor: this.baseColor.toArray(),
        ambient: this.ambient,
      },
      pbr: {
        roughness: this.roughness,
        metalness: this.metalness,
        envMapIntensity: this.envMapIntensity,
        toneMappingExposure: this.toneMappingExposure,
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
    this.colorGradientTexture.dispose();
    this.geometry.dispose();
    this.material2D.dispose();
    this.material3D.dispose();

    if (this._ownsVolumeRenderer) {
      this.volumeRenderer.dispose();
    }
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
