import { OrthographicCamera, Scene, Mesh, PlaneGeometry } from "three";
import { getFBO } from "./fbo.js";

class ShaderPass {
  constructor(shader, options = {}) {
    this.shader = shader;
    this.orthoScene = new Scene();
    this.fbo = getFBO(1, 1, options);
    this.orthoCamera = new OrthographicCamera(
      1 / -2,
      1 / 2,
      1 / 2,
      1 / -2,
      0.00001,
      1000
    );
    this.orthoQuad = new Mesh(new PlaneGeometry(1, 1), this.shader);
    this.orthoScene.add(this.orthoQuad);
  }

  get texture() {
    return this.fbo.texture;
  }

  render(renderer, final = false) {
    renderer.setRenderTarget(final ? null : this.fbo);
    renderer.render(this.orthoScene, this.orthoCamera);
    renderer.setRenderTarget(null);
  }

  setSize(width, height) {
    this.fbo.setSize(width, height);
    this.orthoQuad.scale.set(width, height, 1);
    this.orthoCamera.left = -width / 2;
    this.orthoCamera.right = width / 2;
    this.orthoCamera.top = height / 2;
    this.orthoCamera.bottom = -height / 2;
    this.orthoCamera.updateProjectionMatrix();
  }

  dispose() {
    this.fbo.dispose();
    this.orthoQuad.geometry.dispose();
  }
}

export { ShaderPass };
