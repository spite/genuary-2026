import {
  Scene,
  WebGLRenderTarget,
  RepeatWrapping,
  LinearMipMapLinearFilter,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  BufferGeometry,
  BufferAttribute,
  Mesh,
  PlaneGeometry,
  OrthographicCamera,
} from "three";

class ShaderTexture {
  constructor(
    renderer,
    shader,
    width,
    height,
    format,
    type,
    minFilter,
    magFilter,
    wrapS,
    wrapT
  ) {
    this.renderer = renderer;
    this.shader = shader;
    this.orthoScene = new Scene();
    this.fbo = new WebGLRenderTarget(width, height, {
      wrapS: wrapS || RepeatWrapping,
      wrapT: wrapT || RepeatWrapping,
      minFilter: minFilter,
      magFilter: magFilter,
      format: format || RGBAFormat,
      type: type || UnsignedByteType,
    });
    this.orthoCamera = new OrthographicCamera(
      width / -2,
      width / 2,
      height / 2,
      height / -2,
      0.00001,
      1000
    );
    var geometry = new PlaneGeometry(1, 1, 1);

    this.orthoQuad = new Mesh(geometry, this.shader);
    this.orthoQuad.scale.set(width, height, 1);
    this.orthoScene.add(this.orthoQuad);
  }

  get texture() {
    return this.fbo.texture;
  }

  render() {
    this.renderer.setRenderTarget(this.fbo);
    this.renderer.render(this.orthoScene, this.orthoCamera);
    this.renderer.setRenderTarget(null);
  }

  setSize(width, height) {
    this.orthoQuad.scale.set(width, height, 1);

    this.fbo.setSize(width, height);

    this.orthoCamera.left = -width / 2;
    this.orthoCamera.right = width / 2;
    this.orthoCamera.top = height / 2;
    this.orthoCamera.bottom = -height / 2;
    this.orthoCamera.updateProjectionMatrix();
  }
}

export { ShaderTexture };
