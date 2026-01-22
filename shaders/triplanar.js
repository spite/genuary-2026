const shader = `
vec4 triplanarTexture(in vec3 position, in vec3 n, in sampler2D map, float texScale) { 

  vec3 blend_weights = abs( n );
  blend_weights = ( blend_weights - 0.2 ) * 7.;  
  blend_weights = max( blend_weights, 0. );
  blend_weights /= ( blend_weights.x + blend_weights.y + blend_weights.z );

  vec2 coord1 = position.yz * texScale;
  vec2 coord2 = position.zx * texScale;
  vec2 coord3 = position.xy * texScale;

  vec4 col1 = texture( map, coord1 );  
  vec4 col2 = texture( map, coord2 );  
  vec4 col3 = texture( map, coord3 ); 

  vec4 blended_color = col1 * blend_weights.xxxx +  
                       col2 * blend_weights.yyyy +  
                       col3 * blend_weights.zzzz; 

  return blended_color;
}
`;

export { shader };
