const shader = `

// Bounce 

float bounceOut(float t) {
  const float n1 = 7.5625;
  const float d1 = 2.75;

  if (t < 1.0 / d1) {
    return n1 * t * t;
  } else if (t < 2.0 / d1) {
    t -= 1.5 / d1;
    return n1 * t * t + 0.75;
  } else if (t < 2.5 / d1) {
    t -= 2.25 / d1;
    return n1 * t * t + 0.9375;
  } else {
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
  }
}

float bounceIn(float t) {
    return 1.0 - bounceOut(1.0 - t);
}

float bounceInOut(float t) {
    return t < 0.5
        ? (1.0 - bounceOut(1.0 - 2.0 * t)) * 0.5
        : (bounceOut(2.0 * t - 1.0) * 0.5 + 0.5);
}

// Elastic

float elasticOut(float t) {
    return sin(-13.0 * (t + 1.0) * MPI * 0.5) * pow(2.0, -10.0 * t) + 1.0;
}

float elasticIn(float t) {
    return sin(13.0 * t * MPI * 0.5) * pow(2.0, 10.0 * (t - 1.0));
}

float elasticInOut(float t) {
    return t < 0.5
        ? 0.5 * sin(13.0 * (2.0 * t) * MPI * 0.5) * pow(2.0, 10.0 * ((2.0 * t) - 1.0))
        : 0.5 * (sin(-13.0 * ((2.0 * t - 1.0) + 1.0) * MPI * 0.5) * pow(2.0, -10.0 * (2.0 * t - 1.0)) + 2.0);
}

// Back

const float s = 1.70158; 

float backIn(float t) {
    return t * t * ((s + 1.0) * t - s);
}

float backOut(float t) {
    t -= 1.0;
    return t * t * ((s + 1.0) * t + s) + 1.0;
}

float backInOut(float t) {
    float s2 = s * 1.525; // Exaggerate the overshoot for InOut
    t *= 2.0;
    if (t < 1.0) {
        return 0.5 * (t * t * ((s2 + 1.0) * t - s2));
    } else {
        t -= 2.0;
        return 0.5 * (t * t * ((s2 + 1.0) * t + s2) + 2.0);
    }
}

// Parabola

float parabola ( float x, float k ) {
  return pow( 4. * x * ( 1. - x ), k );
}
`;

export { shader };
