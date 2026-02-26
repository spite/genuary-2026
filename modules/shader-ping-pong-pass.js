import { OrthographicCamera, Scene, Mesh, PlaneGeometry } from "three";
import { getFBO } from "./fbo.js";

class ShaderPingPongPass {
  constructor(shader, options = {}) {
    this.shader = shader;
    this.orthoScene = new Scene();
    const fbo = getFBO(1, 1, options);
    this.fbos = [fbo, fbo.clone()];
    this.currentFBO = 0;
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

  get current() {
    return this.fbos[this.currentFBO];
  }

  get prev() {
    return this.fbos[1 - this.currentFBO];
  }

  get texture() {
    return this.current.texture;
  }

  render(renderer, final = false) {
    renderer.setRenderTarget(final ? null : this.fbos[1 - this.currentFBO]);
    renderer.render(this.orthoScene, this.orthoCamera);
    renderer.setRenderTarget(null);
    this.currentFBO ^= 1;
  }

  setSize(width, height) {
    this.fbos[0].setSize(width, height);
    this.fbos[1].setSize(width, height);
    this.orthoQuad.scale.set(width, height, 1);
    this.orthoCamera.left = -width / 2;
    this.orthoCamera.right = width / 2;
    this.orthoCamera.top = height / 2;
    this.orthoCamera.bottom = -height / 2;
    this.orthoCamera.updateProjectionMatrix();
  }

  dispose() {
    this.fbos[0].dispose();
    this.fbos[1].dispose();
    this.orthoQuad.geometry.dispose();
  }
}

export { ShaderPingPongPass };
