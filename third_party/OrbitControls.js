import {
  Controls,
  MOUSE,
  Quaternion,
  TOUCH,
  Vector2,
  Vector3,
  Plane,
  Ray,
  MathUtils,
} from "three";

const _changeEvent = { type: "change" };
const _startEvent = { type: "start" };
const _endEvent = { type: "end" };

const _ray = new Ray();
const _plane = new Plane();

// Shared temporaries to avoid GC
const _v = new Vector3();
const _offset = new Vector3();
const _quat = new Quaternion();
const _q1 = new Quaternion();
const _q2 = new Quaternion();

const _STATE = {
  NONE: -1,
  ROTATE: 0,
  DOLLY: 1,
  PAN: 2,
  TOUCH_ROTATE: 3,
  TOUCH_PAN: 4,
  TOUCH_DOLLY_PAN: 5,
  TOUCH_DOLLY_ROTATE: 6,
};

const _EPS = 0.000001;
const _twoPI = 2 * Math.PI;
const _LN_095 = Math.log(0.95); // Pre-calculate log for zoom speed

/**
 * OrbitControls (Optimized)
 *
 * - No Gimbal Lock (Quaternion based).
 * - Optional Zoom Damping.
 * - Physics sleep optimization (stops rendering when static).
 */
class OrbitControls extends Controls {
  constructor(object, domElement = null) {
    super(object, domElement);

    this.state = _STATE.NONE;

    // API
    this.target = new Vector3();
    this.cursor = new Vector3();

    this.minDistance = 0;
    this.maxDistance = Infinity;

    this.minZoom = 0;
    this.maxZoom = Infinity;

    this.minTargetRadius = 0;
    this.maxTargetRadius = Infinity;

    // Damping
    this.enableDamping = true;
    this.dampingFactor = 0.05;
    this.enableZoomDamping = true;

    // Settings
    this.enableZoom = true;
    this.zoomSpeed = 1.0;

    this.enableRotate = true;
    this.rotateSpeed = 0.05;
    this.keyRotateSpeed = 1.0;

    this.enablePan = true;
    this.panSpeed = 1.0;
    this.screenSpacePanning = true;
    this.keyPanSpeed = 7.0;

    this.zoomToCursor = false;

    this.autoRotate = false;
    this.autoRotateSpeed = 2.0;

    // Bindings
    this.keys = {
      LEFT: "ArrowLeft",
      UP: "ArrowUp",
      RIGHT: "ArrowRight",
      BOTTOM: "ArrowDown",
    };
    this.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
    this.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };

    // Save/Reset State
    this.target0 = this.target.clone();
    this.position0 = this.object.position.clone();
    this.zoom0 = this.object.zoom;
    this.up0 = this.object.up.clone();

    this._domElementKeyEvents = null;

    // Physics State
    this._lastPosition = new Vector3();
    this._lastQuaternion = new Quaternion();
    this._lastTargetPosition = new Vector3();

    // Current Physics Vectors
    this._orbitDelta = new Vector2(); // Angular velocity
    this._panOffset = new Vector3(); // Pan velocity
    this._zoomScale = 1.0; // Zoom scale (1.0 = equilibrium)

    // Input State
    this._rotateStart = new Vector2();
    this._rotateEnd = new Vector2();
    this._rotateDelta = new Vector2();

    this._panStart = new Vector2();
    this._panEnd = new Vector2();
    this._panDelta = new Vector2();

    this._dollyStart = new Vector2();
    this._dollyEnd = new Vector2();
    this._dollyDelta = new Vector2();

    this._dollyDirection = new Vector3();
    this._mouse = new Vector2();
    this._performCursorZoom = false;

    this._pointers = [];
    this._pointerPositions = {};
    this._controlActive = false;

    // Bind Event Handlers once
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onContextMenu = this.onContextMenu.bind(this);
    this._onMouseWheel = this.onMouseWheel.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
    this._onTouchStart = this.onTouchStart.bind(this);
    this._onTouchMove = this.onTouchMove.bind(this);
    this._onMouseDown = this.onMouseDown.bind(this);
    this._onMouseMove = this.onMouseMove.bind(this);
    this._interceptControlDown = this.interceptControlDown.bind(this);
    this._interceptControlUp = this.interceptControlUp.bind(this);

    if (this.domElement !== null) this.connect(this.domElement);

    this.update();
  }

  connect(element) {
    super.connect(element);

    const dom = this.domElement;
    dom.addEventListener("pointerdown", this._onPointerDown);
    dom.addEventListener("pointercancel", this._onPointerUp);
    dom.addEventListener("contextmenu", this._onContextMenu);
    dom.addEventListener("wheel", this._onMouseWheel, { passive: false });

    dom.getRootNode().addEventListener("keydown", this._interceptControlDown, {
      passive: true,
      capture: true,
    });
    dom.style.touchAction = "none";
  }

  disconnect() {
    const dom = this.domElement;
    dom.removeEventListener("pointerdown", this._onPointerDown);
    dom.removeEventListener("pointermove", this._onPointerMove);
    dom.removeEventListener("pointerup", this._onPointerUp);
    dom.removeEventListener("pointercancel", this._onPointerUp);
    dom.removeEventListener("wheel", this._onMouseWheel);
    dom.removeEventListener("contextmenu", this._onContextMenu);

    this.stopListenToKeyEvents();
    dom
      .getRootNode()
      .removeEventListener("keydown", this._interceptControlDown, {
        capture: true,
      });
    dom.style.touchAction = "auto";
  }

  dispose() {
    this.disconnect();
  }

  getDistance() {
    return this.object.position.distanceTo(this.target);
  }

  listenToKeyEvents(domElement) {
    domElement.addEventListener("keydown", this._onKeyDown);
    this._domElementKeyEvents = domElement;
  }

  stopListenToKeyEvents() {
    if (this._domElementKeyEvents !== null) {
      this._domElementKeyEvents.removeEventListener("keydown", this._onKeyDown);
      this._domElementKeyEvents = null;
    }
  }

  saveState() {
    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
    this.up0.copy(this.object.up);
  }

  reset() {
    this.target.copy(this.target0);
    this.object.position.copy(this.position0);
    this.object.zoom = this.zoom0;
    this.object.up.copy(this.up0);

    this.object.updateProjectionMatrix();
    this.dispatchEvent(_changeEvent);

    this.update();
    this.state = _STATE.NONE;
  }

  update(deltaTime = null) {
    const position = this.object.position;
    _offset.copy(position).sub(this.target);

    // 1. Auto Rotate
    if (this.autoRotate && this.state === _STATE.NONE) {
      this._rotateLeft(this._getAutoRotationAngle(deltaTime));
    }

    // 2. Rotation Physics
    // Apply damping or clear delta
    if (this.enableDamping) {
      this._orbitDelta.multiplyScalar(1 - this.dampingFactor);

      // OPTIMIZATION: Snap to zero if minimal movement to stop rendering loop
      if (Math.abs(this._orbitDelta.x) < _EPS) this._orbitDelta.x = 0;
      if (Math.abs(this._orbitDelta.y) < _EPS) this._orbitDelta.y = 0;
    } else {
      // If no damping, we assume the rotation was applied last frame or will be cleared here
      // But for immediate control, we leave it, then clear at end of block
    }

    // Apply Rotations (Quaternion)
    if (Math.abs(this._orbitDelta.x) > 0 || Math.abs(this._orbitDelta.y) > 0) {
      // Yaw (Left/Right) - Around Object UP
      _q1.setFromAxisAngle(this.object.up, this._orbitDelta.x);

      // Pitch (Up/Down) - Around Object Right
      // Derived from Up x Offset to ensure orthogonality
      const right = _v.copy(this.object.up).cross(_offset).normalize();
      _q2.setFromAxisAngle(right, this._orbitDelta.y);

      // Combine: Pitch then Yaw (Order matters for gimbal freedom)
      _quat.multiplyQuaternions(_q1, _q2);

      _offset.applyQuaternion(_quat);
      this.object.up.applyQuaternion(_quat);

      if (!this.enableDamping) this._orbitDelta.set(0, 0);
    }

    // 3. Pan Physics
    if (this.enableDamping) {
      this.target.addScaledVector(this._panOffset, this.dampingFactor);
      this._panOffset.multiplyScalar(1 - this.dampingFactor);

      // OPTIMIZATION: Snap to zero
      if (this._panOffset.lengthSq() < _EPS) this._panOffset.set(0, 0, 0);
    } else {
      this.target.add(this._panOffset);
      this._panOffset.set(0, 0, 0);
    }

    // Limit Target Radius
    this.target.sub(this.cursor);
    this.target.clampLength(this.minTargetRadius, this.maxTargetRadius);
    this.target.add(this.cursor);

    // 4. Zoom Physics
    let actualZoomSpeed = 1.0;
    if (this.enableDamping && this.enableZoomDamping) {
      // Interpolate zoomScale towards 1.0
      const diff = this._zoomScale - 1.0;
      if (Math.abs(diff) > _EPS) {
        const step = diff * this.dampingFactor;
        actualZoomSpeed = 1.0 + step;
        this._zoomScale /= actualZoomSpeed;
      } else {
        this._zoomScale = 1.0;
      }
    } else {
      actualZoomSpeed = this._zoomScale;
      this._zoomScale = 1.0;
    }

    let zoomChanged = false;
    const isOrtho = this.object.isOrthographicCamera;
    const zoomActive = Math.abs(actualZoomSpeed - 1.0) > _EPS;

    // Apply Zoom
    if (zoomActive) {
      if ((this.zoomToCursor && this._performCursorZoom) || isOrtho) {
        // Distance logic handles post-calculation for these modes
        const dist = _offset.length();
        const newDist = this._clampDistance(dist / actualZoomSpeed);
        _offset.setLength(newDist);
        // We don't mark zoomChanged here for Perspective+Cursor, handled below
      } else {
        // Standard Perspective
        const dist = _offset.length();
        const newDist = this._clampDistance(dist / actualZoomSpeed);
        _offset.setLength(newDist);
        zoomChanged = dist !== newDist;
      }
    }

    // 5. Reconstruct Position
    position.copy(this.target).add(_offset);
    this.object.lookAt(this.target);

    // 6. Handle Cursor Zoom / Ortho Frustum
    if (zoomActive) {
      if (this.zoomToCursor && this._performCursorZoom) {
        if (this.object.isPerspectiveCamera) {
          // Move camera down ray to keep cursor static
          const prevRadius = _offset.length();
          // We just modified _offset, so diff is the movement
          const radiusDelta = prevRadius - prevRadius / actualZoomSpeed; // approx delta

          // Correct exact position
          // Since we modified _offset in place above, we need to compare against logic
          // Simplest: The above logic moved the camera along the offset vector.
          // We need to ADD a shift along the mouse ray.

          // Re-calc delta based on the actual applied scale
          const actualShift = prevRadius * (1 - 1 / actualZoomSpeed);

          if (Math.abs(actualShift) > _EPS) {
            this.object.position.addScaledVector(
              this._dollyDirection,
              actualShift
            );
            this.object.updateMatrixWorld();
            zoomChanged = true;

            // Adjust target to maintain vector integrity (Screen Space Pan style)
            if (this.screenSpacePanning) {
              const currentDist = this.object.position.distanceTo(this.target);
              _v.set(0, 0, -1)
                .transformDirection(this.object.matrix)
                .multiplyScalar(currentDist);
              this.target.copy(this.object.position).add(_v);
            } else {
              _ray.origin.copy(this.object.position);
              _ray.direction
                .set(0, 0, -1)
                .transformDirection(this.object.matrix);
              _plane.setFromNormalAndCoplanarPoint(this.object.up, this.target);
              _ray.intersectPlane(_plane, this.target);
            }
          }
        } else if (isOrtho) {
          // Ortho Zoom (Frustum change + Pan)
          const mouseBefore = new Vector3(
            this._mouse.x,
            this._mouse.y,
            0
          ).unproject(this.object);
          const prevZoom = this.object.zoom;

          this.object.zoom = Math.max(
            this.minZoom,
            Math.min(this.maxZoom, this.object.zoom * actualZoomSpeed)
          );
          this.object.updateProjectionMatrix();

          zoomChanged = prevZoom !== this.object.zoom;

          const mouseAfter = new Vector3(
            this._mouse.x,
            this._mouse.y,
            0
          ).unproject(this.object);
          this.object.position.sub(mouseAfter).add(mouseBefore);
          this.object.updateMatrixWorld();

          // Recalc offset
          _offset.copy(this.object.position).sub(this.target);
        }
      } else if (isOrtho) {
        const prevZoom = this.object.zoom;
        this.object.zoom = Math.max(
          this.minZoom,
          Math.min(this.maxZoom, this.object.zoom * actualZoomSpeed)
        );
        if (prevZoom !== this.object.zoom) {
          this.object.updateProjectionMatrix();
          zoomChanged = true;
        }
      }
    }

    this._performCursorZoom = false;

    // 7. Check for Changes
    // Using squared distance is faster than length()
    if (
      zoomChanged ||
      this._lastPosition.distanceToSquared(this.object.position) > _EPS ||
      8 * (1 - this._lastQuaternion.dot(this.object.quaternion)) > _EPS ||
      this._lastTargetPosition.distanceToSquared(this.target) > _EPS
    ) {
      this.dispatchEvent(_changeEvent);

      this._lastPosition.copy(this.object.position);
      this._lastQuaternion.copy(this.object.quaternion);
      this._lastTargetPosition.copy(this.target);

      return true;
    }

    return false;
  }

  _getAutoRotationAngle(deltaTime) {
    return deltaTime !== null
      ? (_twoPI / 60) * this.autoRotateSpeed * deltaTime
      : (_twoPI / 3600) * this.autoRotateSpeed;
  }

  _getZoomScale(delta) {
    // OPTIMIZATION: Use exp/log instead of pow for slight perf gain on scroll
    // Math.pow(0.95, speed * delta) -> Math.exp( Math.log(0.95) * speed * delta )
    const count = Math.abs(delta * 0.01);
    return Math.exp(_LN_095 * this.zoomSpeed * count);
  }

  _rotateLeft(angle) {
    this._orbitDelta.x -= angle;
  }

  _rotateUp(angle) {
    this._orbitDelta.y -= angle;
  }

  _panLeft(distance, objectMatrix) {
    _v.setFromMatrixColumn(objectMatrix, 0).multiplyScalar(-distance);
    this._panOffset.add(_v);
  }

  _panUp(distance, objectMatrix) {
    if (this.screenSpacePanning === true) {
      _v.setFromMatrixColumn(objectMatrix, 1);
    } else {
      _v.setFromMatrixColumn(objectMatrix, 0).crossVectors(this.object.up, _v);
    }

    _v.multiplyScalar(distance);
    this._panOffset.add(_v);
  }

  _pan(deltaX, deltaY) {
    const element = this.domElement;

    if (this.object.isPerspectiveCamera) {
      // perspective
      const offsetLen = _offset
        .copy(this.object.position)
        .sub(this.target)
        .length();
      let targetDistance =
        offsetLen * Math.tan((this.object.fov / 2) * MathUtils.DEG2RAD);

      this._panLeft(
        (2 * deltaX * targetDistance) / element.clientHeight,
        this.object.matrix
      );
      this._panUp(
        (2 * deltaY * targetDistance) / element.clientHeight,
        this.object.matrix
      );
    } else if (this.object.isOrthographicCamera) {
      // orthographic
      this._panLeft(
        (deltaX * (this.object.right - this.object.left)) /
          this.object.zoom /
          element.clientWidth,
        this.object.matrix
      );
      this._panUp(
        (deltaY * (this.object.top - this.object.bottom)) /
          this.object.zoom /
          element.clientHeight,
        this.object.matrix
      );
    } else {
      console.warn("OrbitControls: Unknown camera type - pan disabled.");
      this.enablePan = false;
    }
  }

  _dollyOut(dollyScale) {
    if (this.object.isPerspectiveCamera || this.object.isOrthographicCamera) {
      this._zoomScale *= dollyScale;
    } else {
      this.enableZoom = false;
    }
  }

  _dollyIn(dollyScale) {
    if (this.object.isPerspectiveCamera || this.object.isOrthographicCamera) {
      this._zoomScale /= dollyScale;
    } else {
      this.enableZoom = false;
    }
  }

  _updateZoomParameters(x, y) {
    if (!this.zoomToCursor) return;

    this._performCursorZoom = true;

    const rect = this.domElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this._mouse.x = ((x - rect.left) / w) * 2 - 1;
    this._mouse.y = -((y - rect.top) / h) * 2 + 1;

    this._dollyDirection
      .set(this._mouse.x, this._mouse.y, 1)
      .unproject(this.object)
      .sub(this.object.position)
      .normalize();
  }

  _clampDistance(dist) {
    return Math.max(this.minDistance, Math.min(this.maxDistance, dist));
  }

  // -- Handlers --

  onPointerDown(event) {
    if (!this.enabled) return;

    if (this._pointers.length === 0) {
      this.domElement.setPointerCapture(event.pointerId);
      this.domElement.addEventListener("pointermove", this._onPointerMove);
      this.domElement.addEventListener("pointerup", this._onPointerUp);
    }

    if (this._isTrackingPointer(event)) return;

    this._addPointer(event);

    if (event.pointerType === "touch") {
      this._onTouchStart(event);
    } else {
      this._onMouseDown(event);
    }
  }

  onPointerMove(event) {
    if (!this.enabled) return;

    if (event.pointerType === "touch") {
      this._onTouchMove(event);
    } else {
      this._onMouseMove(event);
    }
  }

  onPointerUp(event) {
    this._removePointer(event);

    if (this._pointers.length === 0) {
      this.domElement.releasePointerCapture(event.pointerId);
      this.domElement.removeEventListener("pointermove", this._onPointerMove);
      this.domElement.removeEventListener("pointerup", this._onPointerUp);
      this.dispatchEvent(_endEvent);
      this.state = _STATE.NONE;
    } else if (this._pointers.length === 1) {
      const pointerId = this._pointers[0];
      const position = this._pointerPositions[pointerId];
      this._onTouchStart({
        pointerId: pointerId,
        pageX: position.x,
        pageY: position.y,
      });
    }
  }

  onMouseDown(event) {
    let mouseAction = -1;
    switch (event.button) {
      case 0:
        mouseAction = this.mouseButtons.LEFT;
        break;
      case 1:
        mouseAction = this.mouseButtons.MIDDLE;
        break;
      case 2:
        mouseAction = this.mouseButtons.RIGHT;
        break;
    }

    if (mouseAction === MOUSE.DOLLY) {
      if (!this.enableZoom) return;
      this._handleMouseDownDolly(event);
      this.state = _STATE.DOLLY;
    } else if (mouseAction === MOUSE.ROTATE) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (!this.enablePan) return;
        this._handleMouseDownPan(event);
        this.state = _STATE.PAN;
      } else {
        if (!this.enableRotate) return;
        this._handleMouseDownRotate(event);
        this.state = _STATE.ROTATE;
      }
    } else if (mouseAction === MOUSE.PAN) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (!this.enableRotate) return;
        this._handleMouseDownRotate(event);
        this.state = _STATE.ROTATE;
      } else {
        if (!this.enablePan) return;
        this._handleMouseDownPan(event);
        this.state = _STATE.PAN;
      }
    } else {
      this.state = _STATE.NONE;
    }

    if (this.state !== _STATE.NONE) this.dispatchEvent(_startEvent);
  }

  onMouseMove(event) {
    if (this.state === _STATE.ROTATE) {
      if (this.enableRotate) this._handleMouseMoveRotate(event);
    } else if (this.state === _STATE.DOLLY) {
      if (this.enableZoom) this._handleMouseMoveDolly(event);
    } else if (this.state === _STATE.PAN) {
      if (this.enablePan) this._handleMouseMovePan(event);
    }
  }

  onMouseWheel(event) {
    if (!this.enabled || !this.enableZoom || this.state !== _STATE.NONE) return;

    event.preventDefault();
    this.dispatchEvent(_startEvent);
    this._handleMouseWheel(this._customWheelEvent(event));
    this.dispatchEvent(_endEvent);
  }

  onKeyDown(event) {
    if (!this.enabled) return;
    this._handleKeyDown(event);
  }

  onTouchStart(event) {
    this._trackPointer(event);

    if (this._pointers.length === 1) {
      switch (this.touches.ONE) {
        case TOUCH.ROTATE:
          if (!this.enableRotate) return;
          this._handleTouchStartRotate(event);
          this.state = _STATE.TOUCH_ROTATE;
          break;
        case TOUCH.PAN:
          if (!this.enablePan) return;
          this._handleTouchStartPan(event);
          this.state = _STATE.TOUCH_PAN;
          break;
        default:
          this.state = _STATE.NONE;
      }
    } else if (this._pointers.length === 2) {
      switch (this.touches.TWO) {
        case TOUCH.DOLLY_PAN:
          if (!this.enableZoom && !this.enablePan) return;
          this._handleTouchStartDollyPan(event);
          this.state = _STATE.TOUCH_DOLLY_PAN;
          break;
        case TOUCH.DOLLY_ROTATE:
          if (!this.enableZoom && !this.enableRotate) return;
          this._handleTouchStartDollyRotate(event);
          this.state = _STATE.TOUCH_DOLLY_ROTATE;
          break;
        default:
          this.state = _STATE.NONE;
      }
    } else {
      this.state = _STATE.NONE;
    }

    if (this.state !== _STATE.NONE) this.dispatchEvent(_startEvent);
  }

  onTouchMove(event) {
    this._trackPointer(event);

    if (this.state === _STATE.TOUCH_ROTATE) {
      if (this.enableRotate) {
        this._handleTouchMoveRotate(event);
        this.update();
      }
    } else if (this.state === _STATE.TOUCH_PAN) {
      if (this.enablePan) {
        this._handleTouchMovePan(event);
        this.update();
      }
    } else if (this.state === _STATE.TOUCH_DOLLY_PAN) {
      if (this.enableZoom || this.enablePan) {
        this._handleTouchMoveDollyPan(event);
        this.update();
      }
    } else if (this.state === _STATE.TOUCH_DOLLY_ROTATE) {
      if (this.enableZoom || this.enableRotate) {
        this._handleTouchMoveDollyRotate(event);
        this.update();
      }
    }
  }

  onContextMenu(event) {
    if (this.enabled) event.preventDefault();
  }

  interceptControlDown(event) {
    if (event.key === "Control") {
      this._controlActive = true;
      this.domElement
        .getRootNode()
        .addEventListener("keyup", this._interceptControlUp, {
          passive: true,
          capture: true,
        });
    }
  }

  interceptControlUp(event) {
    if (event.key === "Control") {
      this._controlActive = false;
      this.domElement
        .getRootNode()
        .removeEventListener("keyup", this._interceptControlUp, {
          passive: true,
          capture: true,
        });
    }
  }

  // -- Action Implementations --

  _handleMouseDownRotate(event) {
    this._rotateStart.set(event.clientX, event.clientY);
  }

  _handleMouseDownDolly(event) {
    this._updateZoomParameters(event.clientX, event.clientX);
    this._dollyStart.set(event.clientX, event.clientY);
  }

  _handleMouseDownPan(event) {
    this._panStart.set(event.clientX, event.clientY);
  }

  _handleMouseMoveRotate(event) {
    this._rotateEnd.set(event.clientX, event.clientY);
    this._rotateDelta
      .subVectors(this._rotateEnd, this._rotateStart)
      .multiplyScalar(this.rotateSpeed);

    const element = this.domElement;
    // Use clientHeight for both to maintain aspect ratio feel
    this._rotateLeft((_twoPI * this._rotateDelta.x) / element.clientHeight);
    this._rotateUp((_twoPI * this._rotateDelta.y) / element.clientHeight);

    this._rotateStart.copy(this._rotateEnd);
    this.update();
  }

  _handleMouseMoveDolly(event) {
    this._dollyEnd.set(event.clientX, event.clientY);
    this._dollyDelta.subVectors(this._dollyEnd, this._dollyStart);

    if (this._dollyDelta.y > 0) {
      this._dollyOut(this._getZoomScale(this._dollyDelta.y));
    } else if (this._dollyDelta.y < 0) {
      this._dollyIn(this._getZoomScale(this._dollyDelta.y));
    }

    this._dollyStart.copy(this._dollyEnd);
    this.update();
  }

  _handleMouseMovePan(event) {
    this._panEnd.set(event.clientX, event.clientY);
    this._panDelta
      .subVectors(this._panEnd, this._panStart)
      .multiplyScalar(this.panSpeed);

    this._pan(this._panDelta.x, this._panDelta.y);

    this._panStart.copy(this._panEnd);
    this.update();
  }

  _handleMouseWheel(event) {
    this._updateZoomParameters(event.clientX, event.clientY);

    if (event.deltaY < 0) {
      this._dollyIn(this._getZoomScale(event.deltaY));
    } else if (event.deltaY > 0) {
      this._dollyOut(this._getZoomScale(event.deltaY));
    }

    this.update();
  }

  _handleKeyDown(event) {
    let needsUpdate = false;
    const isMod = event.ctrlKey || event.metaKey || event.shiftKey;

    switch (event.code) {
      case this.keys.UP:
        if (isMod && this.enableRotate) {
          this._rotateUp(
            (_twoPI * this.keyRotateSpeed) / this.domElement.clientHeight
          );
        } else if (this.enablePan) {
          this._pan(0, this.keyPanSpeed);
        }
        needsUpdate = true;
        break;
      case this.keys.BOTTOM:
        if (isMod && this.enableRotate) {
          this._rotateUp(
            (-_twoPI * this.keyRotateSpeed) / this.domElement.clientHeight
          );
        } else if (this.enablePan) {
          this._pan(0, -this.keyPanSpeed);
        }
        needsUpdate = true;
        break;
      case this.keys.LEFT:
        if (isMod && this.enableRotate) {
          this._rotateLeft(
            (_twoPI * this.keyRotateSpeed) / this.domElement.clientHeight
          );
        } else if (this.enablePan) {
          this._pan(this.keyPanSpeed, 0);
        }
        needsUpdate = true;
        break;
      case this.keys.RIGHT:
        if (isMod && this.enableRotate) {
          this._rotateLeft(
            (-_twoPI * this.keyRotateSpeed) / this.domElement.clientHeight
          );
        } else if (this.enablePan) {
          this._pan(-this.keyPanSpeed, 0);
        }
        needsUpdate = true;
        break;
    }

    if (needsUpdate) {
      event.preventDefault();
      this.update();
    }
  }

  _handleTouchStartRotate(event) {
    if (this._pointers.length === 1) {
      this._rotateStart.set(event.pageX, event.pageY);
    } else {
      const position = this._getSecondPointerPosition(event);
      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);
      this._rotateStart.set(x, y);
    }
  }

  _handleTouchStartPan(event) {
    if (this._pointers.length === 1) {
      this._panStart.set(event.pageX, event.pageY);
    } else {
      const position = this._getSecondPointerPosition(event);
      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);
      this._panStart.set(x, y);
    }
  }

  _handleTouchStartDolly(event) {
    const position = this._getSecondPointerPosition(event);
    const dx = event.pageX - position.x;
    const dy = event.pageY - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    this._dollyStart.set(0, distance);
  }

  _handleTouchStartDollyPan(event) {
    if (this.enableZoom) this._handleTouchStartDolly(event);
    if (this.enablePan) this._handleTouchStartPan(event);
  }

  _handleTouchStartDollyRotate(event) {
    if (this.enableZoom) this._handleTouchStartDolly(event);
    if (this.enableRotate) this._handleTouchStartRotate(event);
  }

  _handleTouchMoveRotate(event) {
    if (this._pointers.length == 1) {
      this._rotateEnd.set(event.pageX, event.pageY);
    } else {
      const position = this._getSecondPointerPosition(event);
      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);
      this._rotateEnd.set(x, y);
    }

    this._rotateDelta
      .subVectors(this._rotateEnd, this._rotateStart)
      .multiplyScalar(this.rotateSpeed);
    const element = this.domElement;

    this._rotateLeft((_twoPI * this._rotateDelta.x) / element.clientHeight);
    this._rotateUp((_twoPI * this._rotateDelta.y) / element.clientHeight);

    this._rotateStart.copy(this._rotateEnd);
  }

  _handleTouchMovePan(event) {
    if (this._pointers.length === 1) {
      this._panEnd.set(event.pageX, event.pageY);
    } else {
      const position = this._getSecondPointerPosition(event);
      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);
      this._panEnd.set(x, y);
    }

    this._panDelta
      .subVectors(this._panEnd, this._panStart)
      .multiplyScalar(this.panSpeed);
    this._pan(this._panDelta.x, this._panDelta.y);
    this._panStart.copy(this._panEnd);
  }

  _handleTouchMoveDolly(event) {
    const position = this._getSecondPointerPosition(event);
    const dx = event.pageX - position.x;
    const dy = event.pageY - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    this._dollyEnd.set(0, distance);
    this._dollyDelta.set(
      0,
      Math.pow(this._dollyEnd.y / this._dollyStart.y, this.zoomSpeed)
    );
    this._dollyOut(this._dollyDelta.y);

    this._dollyStart.copy(this._dollyEnd);

    const centerX = (event.pageX + position.x) * 0.5;
    const centerY = (event.pageY + position.y) * 0.5;
    this._updateZoomParameters(centerX, centerY);
  }

  _handleTouchMoveDollyPan(event) {
    if (this.enableZoom) this._handleTouchMoveDolly(event);
    if (this.enablePan) this._handleTouchMovePan(event);
  }

  _handleTouchMoveDollyRotate(event) {
    if (this.enableZoom) this._handleTouchMoveDolly(event);
    if (this.enableRotate) this._handleTouchMoveRotate(event);
  }

  // -- Pointer Utils --

  _addPointer(event) {
    this._pointers.push(event.pointerId);
  }

  _removePointer(event) {
    delete this._pointerPositions[event.pointerId];
    for (let i = 0; i < this._pointers.length; i++) {
      if (this._pointers[i] == event.pointerId) {
        this._pointers.splice(i, 1);
        return;
      }
    }
  }

  _isTrackingPointer(event) {
    for (let i = 0; i < this._pointers.length; i++) {
      if (this._pointers[i] == event.pointerId) return true;
    }
    return false;
  }

  _trackPointer(event) {
    let position = this._pointerPositions[event.pointerId];
    if (position === undefined) {
      position = new Vector2();
      this._pointerPositions[event.pointerId] = position;
    }
    position.set(event.pageX, event.pageY);
  }

  _getSecondPointerPosition(event) {
    const pointerId =
      event.pointerId === this._pointers[0]
        ? this._pointers[1]
        : this._pointers[0];
    return this._pointerPositions[pointerId];
  }

  _customWheelEvent(event) {
    const mode = event.deltaMode;
    const newEvent = {
      clientX: event.clientX,
      clientY: event.clientY,
      deltaY: event.deltaY,
    };

    if (mode === 1) {
      newEvent.deltaY *= 16;
    } else if (mode === 2) {
      newEvent.deltaY *= 100;
    }

    if (event.ctrlKey && !this._controlActive) {
      newEvent.deltaY *= 10;
    }

    return newEvent;
  }
}

export { OrbitControls };
