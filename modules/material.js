import {
  RawShaderMaterial,
  FloatType,
  Vector3,
  PMREMGenerator,
  DirectionalLight,
  AmbientLight,
  Vector2,
  HemisphereLight,
  Color,
  GLSL3,
} from "three";
import { UltraHDRLoader } from "third_party/UltraHDRLoader.js";

async function loadEnvMap(file, renderer) {
  return new Promise((resolve, reject) => {
    const loader = new UltraHDRLoader();
    loader.setDataType(FloatType);

    const pmremGenerator = new PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    loader.load(file, (texture) => {
      const pmremRT = pmremGenerator.fromEquirectangular(texture);
      resolve(pmremRT.texture);
    });
  });
}

const vertexShader = `
precision highp float;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

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
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
} `;

const MAX_DIR_LIGHTS = 4;
const MAX_HEMI_LIGHTS = 2;

const fragmentShader = `
precision highp float;

#define PI 3.141592653589793
#define RECIPROCAL_PI 0.3183098861837907
#define EPSILON 1e-6
#define saturate( a ) clamp( a, 0.0, 1.0 )

struct DirectionalLight { vec3 direction; vec3 color; };
struct HemisphereLight { vec3 direction; vec3 skyColor; vec3 groundColor; };

uniform mat4 viewMatrix;
uniform bool hasEnvMap;

uniform vec3 color; 

uniform bool hasMap;
uniform sampler2D map;
uniform vec2 mapRepeat;

uniform bool hasRoughnessMap;
uniform float roughness;
uniform sampler2D roughnessMap;
uniform vec2 roughnessMapRepeat;

uniform bool hasMetalnessMap;
uniform float metalness;
uniform sampler2D metalnessMap;
uniform vec2 metalnessMapRepeat;

uniform bool hasNormalMap;
uniform sampler2D normalMap;
uniform vec2 normalScale;
uniform vec2 normalRepeat;

uniform float toneMappingExposure; // Added exposure uniform

#define MAX_DIR_LIGHTS ${MAX_DIR_LIGHTS}
#define MAX_HEMI_LIGHTS ${MAX_HEMI_LIGHTS}
uniform DirectionalLight directionalLights[MAX_DIR_LIGHTS];
uniform HemisphereLight hemisphereLights[MAX_HEMI_LIGHTS];
uniform int numDirectionalLights;
uniform int numHemisphereLights;

uniform vec3 ambientLightColor;
uniform vec3 cameraPosition; 

uniform sampler2D envMap; 
uniform float envMapIntensity;
// PMREM constants - calculated from texture dimensions
uniform float cubeUV_maxMip;
uniform float cubeUV_texelWidth;
uniform float cubeUV_texelHeight;

uniform mat3 normalMatrix;

in vec3 vPosition;
in vec3 vViewPosition;
in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vUv;

out vec4 fragColor;

// --- Three.js Standard ACES Implementation ---
vec3 RRTAndODTFit( vec3 v ) {
    vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
    vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
    return a / b;
}

vec3 ACESFilmicToneMapping( vec3 color ) {
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

    // Three.js exposure correction factor
    color *= toneMappingExposure / 0.6;

    color = ACESInputMat * color;
    color = RRTAndODTFit( color );
    color = ACESOutputMat * color;

    return saturate( color );
}

vec4 linearToSRGB( in vec4 value ) {
    return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}

vec3 perturbNormal2Arb( vec3 worldPos, vec3 surf_norm, vec2 uv_coords, in vec3 mapN ) {
    vec3 q0 = dFdx( worldPos.xyz ); vec3 q1 = dFdy( worldPos.xyz );
    vec2 st0 = dFdx( uv_coords.st ); vec2 st1 = dFdy( uv_coords.st );
    vec3 N = surf_norm;
    vec3 q1perp = cross( q1, N ); vec3 q0perp = cross( N, q0 );
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max( dot( T, T ), dot( B, B ) );
    float scale_det = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
    mat3 tsn = mat3( T * scale_det, B * scale_det, N );
    
    return normalize( tsn * mapN );
}

vec3 F_Schlick(float u, vec3 f0) { return f0 + (vec3(1.0) - f0) * pow(1.0 - u, 5.0); }

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

// ============== Three.js PMREM Sampling (exact copy from cube_uv_reflection_fragment.glsl.js) ==============
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

vec3 bilinearCubeUV( sampler2D envMapSampler, vec3 direction, float mipInt ) {
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

vec4 textureCubeUV( sampler2D envMapSampler, vec3 sampleDir, float roughness ) {
    float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, cubeUV_maxMip );
    float mipF = fract( mip );
    float mipInt = floor( mip );
    
    vec3 color0 = bilinearCubeUV( envMapSampler, sampleDir, mipInt );
    if ( mipF == 0.0 ) {
        return vec4( color0, 1.0 );
    } else {
        vec3 color1 = bilinearCubeUV( envMapSampler, sampleDir, mipInt + 1.0 );
        return vec4( mix( color0, color1, mipF ), 1.0 );
    }
}
// ============== End PMREM Sampling ==============

void calculateLight(vec3 L, vec3 lightColor, vec3 geometryNormal, vec3 viewDir, vec3 f0, float alpha, float metalnessFactor, vec3 diffuseReflectance, inout vec3 reflectedLight, inout vec3 diffuseLight) {
    vec3 H = normalize(L + viewDir);
    float NdotL = clamp(dot(geometryNormal, L), 0.0, 1.0);
    float NdotV = clamp(abs(dot(geometryNormal, viewDir)), 0.0, 1.0);
    float NdotH = clamp(dot(geometryNormal, H), 0.0, 1.0);
    float VdotH = clamp(dot(viewDir, H), 0.0, 1.0);
    if (NdotL > 0.0) {
        vec3 F = F_Schlick(VdotH, f0);
        float D = D_GGX(NdotH, alpha);
        float V = V_GGX_SmithCorrelated(alpha, NdotV, NdotL);
        vec3 specular = F * (D * V);
        vec3 kD = (vec3(1.0) - F) * (1.0 - metalnessFactor);
        vec3 diffuse = diffuseReflectance * RECIPROCAL_PI;
        reflectedLight += specular * lightColor * NdotL;
        diffuseLight += diffuse * lightColor * NdotL;
    }
}

vec3 shade(in vec3 worldPosition, in vec3 worldNormal, in vec2 uv, in vec4 diffuseColor, in float roughness, in float metalness) {
   
    float metalnessFactor = metalness;
    float roughnessFactor = max(roughness, 0.0525);
    float alpha = roughnessFactor * roughnessFactor;

    vec3 f0 = vec3(0.04);
    f0 = mix(f0, diffuseColor.rgb, metalnessFactor);
    vec3 diffuseReflectance = diffuseColor.rgb * (1.0 - metalnessFactor);

    vec3 geometryNormal = worldNormal; 
    vec3 viewDir = normalize(cameraPosition - worldPosition);

    vec3 reflectedLight = vec3(0.0);
    vec3 diffuseLight = vec3(0.0);

    for(int i = 0; i < MAX_DIR_LIGHTS; i++) {
        if (i >= numDirectionalLights) break;
        vec3 L = normalize(directionalLights[i].direction);
        calculateLight(L, directionalLights[i].color, geometryNormal, viewDir, f0, alpha, metalnessFactor, diffuseReflectance, reflectedLight, diffuseLight);
    }

    vec3 indirectSpecular = vec3(0.0);
    vec3 indirectDiffuse = vec3(0.0);

    // Hemisphere/ambient lights - simple Lambertian diffuse (no multi-scattering)
    vec3 ambientIrradiance = ambientLightColor;
    for(int i = 0; i < MAX_HEMI_LIGHTS; i++) {
        if (i >= numHemisphereLights) break;
        float weight = 0.5 * dot(geometryNormal, normalize(hemisphereLights[i].direction)) + 0.5;
        ambientIrradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, weight);
    }
    // Simple Lambert BRDF for ambient/hemisphere
    indirectDiffuse = ambientIrradiance * diffuseReflectance * RECIPROCAL_PI;
    
    if (hasEnvMap) {
        float NdotV = clamp(abs(dot(geometryNormal, viewDir)), 0.0, 1.0);
        
        // Reflection vector - bend toward normal for rough surfaces (Three.js getIBLRadiance)
        vec3 worldReflectVec = reflect(-viewDir, geometryNormal);
        worldReflectVec = normalize(mix(worldReflectVec, geometryNormal, roughnessFactor * roughnessFactor));
        
        // Sample prefiltered radiance
        vec3 radiance = textureCubeUV(envMap, worldReflectVec, roughnessFactor).rgb;
        radiance *= envMapIntensity;

        // Environment diffuse irradiance
        // Three.js getIBLIrradiance returns: PI * envMapColor * envMapIntensity
        // Then RE_IndirectSpecular divides by PI, so net effect is: envMapColor * envMapIntensity
        vec3 iblIrradiance = textureCubeUV(envMap, geometryNormal, 1.0).rgb;
        iblIrradiance *= envMapIntensity;
        // Note: NOT dividing by PI here since PMREM irradiance is already properly scaled
        
        // DFG approximation (split-sum approximation)
        vec2 fab = EnvBRDFApprox(roughnessFactor, NdotV);
        
        // Single scattering term
        float specularF90 = 1.0;
        vec3 FssEss = f0 * fab.x + specularF90 * fab.y;
        
        // Multi-scattering compensation (Fdez-Aguera's approach)
        float Ess = fab.x + fab.y;
        float Ems = 1.0 - Ess;
        vec3 Favg = f0 + (1.0 - f0) * 0.047619; // 1/21
        vec3 Fms = FssEss * Favg / (1.0 - Ems * Favg);
        
        // Total scattering
        vec3 singleScattering = FssEss;
        vec3 multiScattering = Fms * Ems;
        vec3 totalScattering = singleScattering + multiScattering;
        
        // IBL diffuse - reduced by total scattering for energy conservation
        vec3 iblDiffuse = diffuseReflectance * (1.0 - max(max(totalScattering.r, totalScattering.g), totalScattering.b));
        
        // IBL contribution with multi-scattering
        // Use iblIrradiance directly (Three.js: PI * sample / PI = sample)
        indirectSpecular = radiance * singleScattering + multiScattering * iblIrradiance;
        indirectDiffuse += iblDiffuse * iblIrradiance;
    }

    vec3 outgoingLight = reflectedLight + diffuseLight + indirectDiffuse + indirectSpecular;
    return outgoingLight;
}

void _main() {
    float r = roughness;
    float m = metalness;

    mat3 viewMatrixInverse = mat3(inverse(viewMatrix));
    vec3 worldNormal = normalize(viewMatrixInverse * vNormal);
    if (hasNormalMap) {
        vec3 mapN = texture( normalMap, vUv * normalRepeat ).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale;
        worldNormal = perturbNormal2Arb(vWorldPosition, worldNormal, vUv * normalRepeat, mapN);
    }
    if (hasRoughnessMap) {
        r *= texture(roughnessMap, vUv * roughnessMapRepeat).r;
    }
    if (hasMetalnessMap) {
        m *= texture(metalnessMap, vUv * metalnessMapRepeat).r;
    }
    vec4 diffuseColor = vec4(color, 1.0);
    if (hasMap) {
        vec4 texColor = texture(map, vUv * mapRepeat);
        texColor = pow(texColor, vec4(2.2)); 
        diffuseColor *= texColor;
    }

    vec3 outgoingLight = shade(vWorldPosition, worldNormal, vUv, diffuseColor, r, m) ;
    outgoingLight = ACESFilmicToneMapping(outgoingLight);
    fragColor = linearToSRGB(vec4(outgoingLight, 1.0));
}
`;

const light = new DirectionalLight(0xffffff, 3);
light.position.set(3, 6, 3);
light.castShadow = true;
light.shadow.camera.top = 3;
light.shadow.camera.bottom = -3;
light.shadow.camera.right = 3;
light.shadow.camera.left = -3;
light.shadow.mapSize.set(4096, 4096);

const hemiLight = new HemisphereLight(0xffffff, 0xffffff, 2);
hemiLight.color.setHSL(0.6, 1, 0.6);
hemiLight.groundColor.setHSL(0.095, 1, 0.75);
hemiLight.position.set(0, 50, 0);

class Material extends RawShaderMaterial {
  constructor(params) {
    super({
      vertexShader: params.vertexShader ?? vertexShader,
      fragmentShader:
        (params.fragmentShader ?? fragmentShader) +
        (params.main ?? `void main() { _main(); }`),
      uniforms: {
        color: { value: params.uniforms.color },
        roughness: { value: params.uniforms.roughness },
        metalness: { value: params.uniforms.metalness },
        toneMappingExposure: { value: 1.0 },

        hasMap: { value: params.uniforms.hasMap ?? false },
        map: { value: params.uniforms.map },
        mapRepeat: {
          value: params.uniforms.mapRepeat ?? new Vector2(1, 1),
        },

        hasRoughnessMap: { value: params.uniforms.hasRoughnessMap },
        roughnessMap: { value: params.uniforms.roughnessMap },
        roughnessMapRepeat: {
          value: params.uniforms.roughnessMapRepeat ?? new Vector2(1, 1),
        },

        hasMetalnessMap: { value: params.uniforms.hasMetalnessMap },
        metalnessMap: { value: params.uniforms.roughnessMap },
        metalnessMapRepeat: {
          value: params.uniforms.metalnessMapRepeat ?? new Vector2(1, 1),
        },

        hasNormalMap: { value: params.uniforms.hasNormalMap },
        normalMap: { value: params.uniforms.normalMap },
        normalScale: {
          value: params.uniforms.normalScale ?? new Vector2(1, 1),
        },
        normalRepeat: {
          value: params.uniforms.normalRepeat ?? new Vector2(1, 1),
        },

        ambientLightColor: { value: new Color(0) },

        hemisphereLights: {
          value: [
            {
              direction: new Vector3(0, 1, 0),
              skyColor: new Color(0),
              groundColor: new Color(0),
            },
            {
              direction: new Vector3(0, 1, 0),
              skyColor: new Color(0),
              groundColor: new Color(0),
            },
          ],
        },

        hasEnvMap: { value: false },
        envMap: { value: null },
        envMapIntensity: { value: 1.0 },
        cubeUV_maxMip: { value: 8.0 },
        cubeUV_texelWidth: { value: 1.0 / 768.0 },
        cubeUV_texelHeight: { value: 1.0 / 1024.0 },

        directionalLights: {
          value: [
            { direction: new Vector3(0, 1, 0), color: new Color(0) },
            { direction: new Vector3(0, 1, 0), color: new Color(0) },
            { direction: new Vector3(0, 1, 0), color: new Color(0) },
            { direction: new Vector3(0, 1, 0), color: new Color(0) },
          ],
        },
        numDirectionalLights: { value: 0 },
        numHemisphereLights: { value: 0 },
        ...params.customUniforms,
      },
      glslVersion: GLSL3,
    });
  }

  set envMap(texture) {
    const height = texture.height;

    const faceSize = height / 4;
    const cubeUV_maxMip = Math.log2(faceSize);

    const cubeUV_texelWidth = 1.0 / (3 * Math.pow(2, cubeUV_maxMip));
    const cubeUV_texelHeight = 1.0 / (4 * Math.pow(2, cubeUV_maxMip));

    this.uniforms.envMap.value = texture;
    this.uniforms.cubeUV_maxMip.value = cubeUV_maxMip;
    this.uniforms.cubeUV_texelWidth.value = cubeUV_texelWidth;
    this.uniforms.cubeUV_texelHeight.value = cubeUV_texelHeight;
    this.uniforms.hasEnvMap.value = true;
    this.needsUpdate = true;
  }

  syncLights(scene) {
    const directionalLights = [];
    const hemisphereLights = [];

    scene.traverse((object) => {
      if (object instanceof AmbientLight) {
        this.uniforms.ambientLightColor.value.copy(object.color);
      }
      if (object instanceof DirectionalLight) {
        directionalLights.push({
          direction: object.position.clone().normalize(),
          color: object.color.clone().multiplyScalar(object.intensity),
        });
      } else if (object instanceof HemisphereLight) {
        hemisphereLights.push({
          direction: object.position.clone().normalize(),
          skyColor: object.color.clone().multiplyScalar(object.intensity),
          groundColor: object.groundColor
            .clone()
            .multiplyScalar(object.intensity),
        });
      }
    });

    const maxDirLights = MAX_DIR_LIGHTS;
    for (let i = 0; i < maxDirLights; i++) {
      if (i < directionalLights.length) {
        this.uniforms.directionalLights.value[i] = directionalLights[i];
      } else {
        this.uniforms.directionalLights.value[i] = {
          direction: new Vector3(0, 1, 0),
          color: new Color(0),
        };
      }
    }
    this.uniforms.numDirectionalLights.value = Math.min(
      directionalLights.length,
      maxDirLights
    );

    const maxHemiLights = MAX_HEMI_LIGHTS;
    for (let i = 0; i < maxHemiLights; i++) {
      if (i < hemisphereLights.length) {
        this.uniforms.hemisphereLights.value[i] = hemisphereLights[i];
      } else {
        this.uniforms.hemisphereLights.value[i] = {
          direction: new Vector3(0, 1, 0),
          skyColor: new Color(0),
          groundColor: new Color(0),
        };
      }
    }
    this.uniforms.numHemisphereLights.value = Math.min(
      hemisphereLights.length,
      maxHemiLights
    );
  }

  syncRenderer(renderer) {
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
  }
}

export { Material, loadEnvMap };
