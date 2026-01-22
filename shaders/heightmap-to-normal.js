const shader = `
vec4 heightToNormal(sampler2D heightMap, vec2 uv, float strength, float invertR, float invertG, float invertH, int type) {
  vec2 texelSize = 1.0 / vec2(textureSize(heightMap, 0));

  // Sample 3x3 neighborhood
  float tl = texture(heightMap, uv + vec2(-texelSize.x,  texelSize.y)).r * invertH;
  float t  = texture(heightMap, uv + vec2( 0.0,          texelSize.y)).r * invertH;
  float tr = texture(heightMap, uv + vec2( texelSize.x,  texelSize.y)).r * invertH;
  float l  = texture(heightMap, uv + vec2(-texelSize.x,  0.0        )).r * invertH;
  float r  = texture(heightMap, uv + vec2( texelSize.x,  0.0        )).r * invertH;
  float bl = texture(heightMap, uv + vec2(-texelSize.x, -texelSize.y)).r * invertH;
  float b  = texture(heightMap, uv + vec2( 0.0,         -texelSize.y)).r * invertH;
  float br = texture(heightMap, uv + vec2( texelSize.x, -texelSize.y)).r * invertH;

  float dx, dy;
  if (type == 0) { // Sobel
    dx = (tr + 2.0*r + br) - (tl + 2.0*l + bl);
    dy = (tl + 2.0*t + tr) - (bl + 2.0*b + br);
  } else { // Scharr
    dx = (tr*3.0 + r*10.0 + br*3.0) - (tl*3.0 + l*10.0 + bl*3.0);
    dy = (tl*3.0 + t*10.0 + tr*3.0) - (bl*3.0 + b*10.0 + br*3.0);
  }

  vec3 n = normalize(vec3(dx * invertR, dy * invertG, strength));
  return vec4(n.xy * 0.5 + 0.5, n.z, texture(heightMap, uv).a);
}
`;

export { shader };
