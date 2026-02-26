import {
  WebGLRenderTarget,
  ClampToEdgeWrapping,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  NoColorSpace,
} from "three";

function getFBO(w, h, options = {}) {
  return new WebGLRenderTarget(w, h, {
    wrapS: options.wrapS ?? ClampToEdgeWrapping,
    wrapT: options.wrapT ?? ClampToEdgeWrapping,
    minFilter: options.minFilter ?? LinearFilter,
    magFilter: options.magFilter ?? LinearFilter,
    format: options.format ?? RGBAFormat,
    type: options.type ?? UnsignedByteType,
    stencilBuffer: options.stencilBuffer ?? false,
    depthBuffer: options.depthBuffer ?? true,
    colorSpace: options.colorSpace ?? NoColorSpace,
    count: options.count ?? 1,
  });
}

export { getFBO };
