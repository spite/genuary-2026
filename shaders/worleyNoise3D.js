const shader = `
vec3 worleyHash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7,  74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(p) * 43758.5453123);
}

float worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);

  float F1 = 1e10;
  float F2 = 1e10;

  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 nb = vec3(float(x), float(y), float(z));
        vec3 pt = nb + worleyHash(i + nb) - f;
        float d = dot(pt, pt); // squared distance — cheaper, monotonic
        if (d < F1) { F2 = F1; F1 = d; }
        else if (d < F2) { F2 = d; }
      }
    }
  }

  return 1.0 - sqrt(F1);
}
`;

export { shader };
