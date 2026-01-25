/**
 * Trefoil Knot SDF
 *
 * A trefoil knot is the simplest non-trivial knot.
 * Parametric equations:
 *   x = sin(t) + 2*sin(2*t)
 *   y = cos(t) - 2*cos(2*t)
 *   z = -sin(3*t)
 */

const shader = `

// Trefoil knot curve point at parameter t
vec3 trefoilPoint(float t) {
    return vec3(
        sin(t) + 2.0 * sin(2.0 * t),
        cos(t) - 2.0 * cos(2.0 * t),
        -sin(3.0 * t)
    );
}

// Trefoil knot tangent (derivative) at parameter t
vec3 trefoilTangent(float t) {
    return vec3(
        cos(t) + 4.0 * cos(2.0 * t),
        -sin(t) + 4.0 * sin(2.0 * t),
        -3.0 * cos(3.0 * t)
    );
}

// SDF for trefoil knot using curve sampling
// p: point to evaluate
// scale: size of the knot
// tubeRadius: thickness of the tube
// samples: number of samples along curve (higher = more accurate but slower)
float sdTrefoilKnot(vec3 p, float scale, float tubeRadius, int samples) {
    float minDist = 1e10;
    float twoPi = 6.283185307;
    
    vec3 scaledP = p / scale;
    
    for (int i = 0; i < samples; i++) {
        float t = twoPi * float(i) / float(samples);
        vec3 curvePoint = trefoilPoint(t);
        float d = length(scaledP - curvePoint);
        minDist = min(minDist, d);
    }
    
    return (minDist - tubeRadius) * scale;
}

// Faster version with fixed 64 samples
float sdTrefoilKnot64(vec3 p, float scale, float tubeRadius) {
    float minDist = 1e10;
    float twoPi = 6.283185307;
    
    vec3 scaledP = p / scale;
    
    for (int i = 0; i < 64; i++) {
        float t = twoPi * float(i) / 64.0;
        vec3 curvePoint = trefoilPoint(t);
        float d = length(scaledP - curvePoint);
        minDist = min(minDist, d);
    }
    
    return (minDist - tubeRadius) * scale;
}

// High quality version with Newton-Raphson refinement
// More accurate but slower
float sdTrefoilKnotHQ(vec3 p, float scale, float tubeRadius) {
    float twoPi = 6.283185307;
    vec3 scaledP = p / scale;
    
    // Coarse search with 32 samples
    float minDist = 1e10;
    float bestT = 0.0;
    
    for (int i = 0; i < 32; i++) {
        float t = twoPi * float(i) / 32.0;
        vec3 curvePoint = trefoilPoint(t);
        float d = length(scaledP - curvePoint);
        if (d < minDist) {
            minDist = d;
            bestT = t;
        }
    }
    
    // Newton-Raphson refinement (3 iterations)
    float t = bestT;
    for (int i = 0; i < 3; i++) {
        vec3 cp = trefoilPoint(t);
        vec3 ct = trefoilTangent(t);
        vec3 diff = scaledP - cp;
        
        // Find t that minimizes distance
        // d/dt |p - c(t)|^2 = -2 * (p - c(t)) . c'(t) = 0
        float projection = dot(diff, ct);
        float tangentLenSq = dot(ct, ct);
        
        if (tangentLenSq > 0.0001) {
            t += projection / tangentLenSq;
            // Wrap t to [0, 2pi]
            t = mod(t, twoPi);
        }
    }
    
    vec3 closestPoint = trefoilPoint(t);
    float d = length(scaledP - closestPoint);
    
    return (d - tubeRadius) * scale;
}

// Simple version with default parameters
// scale = 1.0, tubeRadius = 0.4
float sdTrefoilKnot(vec3 p) {
    return sdTrefoilKnot64(p, 1.0, 0.4);
}

// Animated trefoil that morphs over time
// phase shifts the knot shape
float sdTrefoilKnotAnimated(vec3 p, float scale, float tubeRadius, float phase) {
    float minDist = 1e10;
    float twoPi = 6.283185307;
    
    vec3 scaledP = p / scale;
    
    for (int i = 0; i < 64; i++) {
        float t = twoPi * float(i) / 64.0;
        // Add phase to create animation
        vec3 curvePoint = vec3(
            sin(t + phase) + 2.0 * sin(2.0 * t),
            cos(t + phase) - 2.0 * cos(2.0 * t),
            -sin(3.0 * t + phase * 0.5)
        );
        float d = length(scaledP - curvePoint);
        minDist = min(minDist, d);
    }
    
    return (minDist - tubeRadius) * scale;
}

// Generalized torus knot SDF
// p, q define the knot type (trefoil is p=2, q=3)
float sdTorusKnot(vec3 p, float scale, float tubeRadius, int pParam, int qParam, int samples) {
    float minDist = 1e10;
    float twoPi = 6.283185307;
    
    vec3 scaledP = p / scale;
    float fp = float(pParam);
    float fq = float(qParam);
    
    // Torus knot on a torus with R=2, r=1
    float R = 2.0;
    float r = 1.0;
    
    for (int i = 0; i < samples; i++) {
        float t = twoPi * float(i) / float(samples);
        float phi = fq * t;
        float theta = fp * t;
        
        // Point on torus knot
        float cosTheta = cos(theta);
        float sinTheta = sin(theta);
        float cosPhi = cos(phi);
        float sinPhi = sin(phi);
        
        vec3 curvePoint = vec3(
            (R + r * cosPhi) * cosTheta,
            (R + r * cosPhi) * sinTheta,
            r * sinPhi
        );
        
        float d = length(scaledP - curvePoint);
        minDist = min(minDist, d);
    }
    
    return (minDist - tubeRadius) * scale;
}

// Convenience function for (2,3) torus knot (trefoil) 
float sdTorusKnot23(vec3 p, float scale, float tubeRadius) {
    return sdTorusKnot(p, scale, tubeRadius, 2, 3, 64);
}

// Convenience function for (3,2) torus knot
float sdTorusKnot32(vec3 p, float scale, float tubeRadius) {
    return sdTorusKnot(p, scale, tubeRadius, 3, 2, 64);
}

// Convenience function for (2,5) torus knot (cinquefoil)
float sdTorusKnot25(vec3 p, float scale, float tubeRadius) {
    return sdTorusKnot(p, scale, tubeRadius, 2, 5, 96);
}

// Convenience function for (3,4) torus knot
float sdTorusKnot34(vec3 p, float scale, float tubeRadius) {
    return sdTorusKnot(p, scale, tubeRadius, 3, 4, 96);
}

`;

export { shader };
