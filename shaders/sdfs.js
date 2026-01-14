const shader = `

// Sphere 

float sdSphere( vec3 p, float s ){
    return length(p)-s;
}

// Rounded box
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Icosahedron and Dodecahedron

// https://www.shadertoy.com/view/XtyXzW

#define MPI 3.14159265359
#define PHI (1.618033988749895)
#define TAU 6.283185307179586

#define GDFVector3 normalize(vec3(1, 1, 1 ))
#define GDFVector4 normalize(vec3(-1, 1, 1))
#define GDFVector5 normalize(vec3(1, -1, 1))
#define GDFVector6 normalize(vec3(1, 1, -1))

#define GDFVector7 normalize(vec3(0, 1, PHI+1.))
#define GDFVector8 normalize(vec3(0, -1, PHI+1.))
#define GDFVector9 normalize(vec3(PHI+1., 0, 1))
#define GDFVector10 normalize(vec3(-PHI-1., 0, 1))
#define GDFVector11 normalize(vec3(1, PHI+1., 0))
#define GDFVector12 normalize(vec3(-1, PHI+1., 0))

#define GDFVector13 normalize(vec3(0, PHI, 1))
#define GDFVector14 normalize(vec3(0, -PHI, 1))
#define GDFVector15 normalize(vec3(1, 0, PHI))
#define GDFVector16 normalize(vec3(-1, 0, PHI))
#define GDFVector17 normalize(vec3(PHI, 1, 0))
#define GDFVector18 normalize(vec3(-PHI, 1, 0))

#define fGDFBegin float d = 0.;
#define fGDF(v) d = max(d, abs(dot(p, v)));
#define fGDFEnd return d - r;

// Version with variable exponent.
// This is slow and does not produce correct distances, but allows for bulging of objects.
#define fGDFExp(v) d += pow(abs(dot(p, v)), e);

// Version with without exponent, creates objects with sharp edges and flat faces
#define fGDF(v) d = max(d, abs(dot(p, v)));

// https://www.shadertoy.com/view/lssfW4

#define fGDFExpEnd return pow(d, 1./e) - r;
#define fGDFEnd return d - r;

float fDodecahedron(vec3 p, float r, float e) {
  fGDFBegin
  fGDFExp(GDFVector13) fGDFExp(GDFVector14) fGDFExp(GDFVector15) fGDFExp(GDFVector16)
  fGDFExp(GDFVector17) fGDFExp(GDFVector18)
  fGDFExpEnd
}

float fDodecahedron(vec3 p, float r) {
  fGDFBegin
  fGDF(GDFVector13) fGDF(GDFVector14) fGDF(GDFVector15) fGDF(GDFVector16)
  fGDF(GDFVector17) fGDF(GDFVector18)
  fGDFEnd
}

float fIcosahedron(vec3 p, float r) {
  fGDFBegin
  fGDF(GDFVector3) fGDF(GDFVector4) fGDF(GDFVector5) fGDF(GDFVector6)
  fGDF(GDFVector7) fGDF(GDFVector8) fGDF(GDFVector9) fGDF(GDFVector10)
  fGDF(GDFVector11) fGDF(GDFVector12)
  fGDFEnd
}

float fIcosahedron(vec3 p, float r, float e) {
  fGDFBegin
  fGDFExp(GDFVector3) fGDFExp(GDFVector4) fGDFExp(GDFVector5) fGDFExp(GDFVector6)
  fGDFExp(GDFVector7) fGDFExp(GDFVector8) fGDFExp(GDFVector9) fGDFExp(GDFVector10)
  fGDFExp(GDFVector11) fGDFExp(GDFVector12)
  fGDFExpEnd
}

// Octahedron

float sdOctahedron( vec3 p, float s) {
  p = abs(p);
  float m = p.x+p.y+p.z-s;
  vec3 q;
       if( 3.0*p.x < m ) q = p.xyz;
  else if( 3.0*p.y < m ) q = p.yzx;
  else if( 3.0*p.z < m ) q = p.zxy;
  else return m*0.57735027;
    
  float k = clamp(0.5*(q.z-q.y+s),0.0,s); 
  return length(vec3(q.x,q.y-s+k,q.z-k)); 
}

// Tetrahedron

float udTriangle(vec3 p, vec3 a, vec3 b, vec3 c) {
    vec3 ba = b - a; vec3 pa = p - a;
    vec3 cb = c - b; vec3 pb = p - b;
    vec3 ac = a - c; vec3 pc = p - c;
    vec3 nor = cross(ba, ac);

    return sqrt(
        (sign(dot(cross(ba, nor), pa)) +
         sign(dot(cross(cb, nor), pb)) +
         sign(dot(cross(ac, nor), pc)) < 2.0)
         ? min(min(
            dot(ba * clamp(dot(ba, pa) / dot(ba, ba), 0.0, 1.0) - pa, 
                ba * clamp(dot(ba, pa) / dot(ba, ba), 0.0, 1.0) - pa),
            dot(cb * clamp(dot(cb, pb) / dot(cb, cb), 0.0, 1.0) - pb, 
                cb * clamp(dot(cb, pb) / dot(cb, cb), 0.0, 1.0) - pb)),
            dot(ac * clamp(dot(ac, pc) / dot(ac, ac), 0.0, 1.0) - pc, 
                ac * clamp(dot(ac, pc) / dot(ac, ac), 0.0, 1.0) - pc))
         : dot(nor, pa) * dot(nor, pa) / dot(nor, nor)
    );
}

float sdTetrahedron(vec3 p, float r, float roundness) {
    vec3 v1 = vec3( 1.0,  1.0,  1.0) * r;
    vec3 v2 = vec3(-1.0, -1.0,  1.0) * r;
    vec3 v3 = vec3(-1.0,  1.0, -1.0) * r;
    vec3 v4 = vec3( 1.0, -1.0, -1.0) * r;

    float t1 = udTriangle(p, v1, v2, v3);
    float t2 = udTriangle(p, v1, v4, v2);
    float t3 = udTriangle(p, v1, v3, v4);
    float t4 = udTriangle(p, v2, v3, v4);
    float exact = min(min(t1, t2), min(t3, t4));

    float b1 = dot(p - v1, vec3( 1.0,  1.0, -1.0)); // Wait, normals are tricky.
    
    float bound = max(max(
        dot(p, vec3( 1.0,  1.0, -1.0)),
        dot(p, vec3(-1.0, -1.0, -1.0))), // Note signs carefully
        max(
        dot(p, vec3( 1.0, -1.0,  1.0)),
        dot(p, vec3(-1.0,  1.0,  1.0)))
    );
    
    float planeDist = (bound - r) * 0.57735027; // * 1/sqrt(3)
    
    float d = (planeDist < 0.0) ? planeDist : exact;

    return d - roundness;
}`;

export { shader };
