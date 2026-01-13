class RangeSlider extends HTMLElement {
  static formAssociated = true;

  constructor() {
    super();
    this.internals_ = this.attachInternals();
    this.attachShadow({ mode: "open" });

    this.isDragging = false;
    this.currentHandle = null;

    this._min = 0;
    this._max = 100;
    this._step = 1;
    this._valMin = 0;
    this._valMax = 50;
  }

  static get observedAttributes() {
    return ["min", "max", "step", "value", "dual", "disabled"];
  }

  get template() {
    return `
      <style>
        :host {
          display: inline-block;
          width: 100%;
          height: 24px;
          user-select: none;
          touch-action: none;
          vertical-align: middle;
          --track-height: 4px;
          --track-color: #333;
          --fill-color: #e0e0e0;
          --thumb-size: 8px;
          --thumb-color: #fff;
          --thumb-border: 2px solid #333;
          --thumb-hover: #f0f0f0;
          cursor: pointer;
        }
        
        :host([disabled]) {
          opacity: 0.5;
          pointer-events: none;
        }

        .container:hover {
          --thumb-size: 16px;
        }

        .container {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
        }

        .track {
          position: absolute;
          width: 100%;
          height: var(--track-height);
          background-color: var(--track-color);
          border-radius: 4px;
        }

        .container.immediate .thumb,
        .container.immediate .fill {
          transition: none;
        }

        .fill {
          position: absolute;
          height: var(--track-height);
          background-color: var(--fill-color);
          border-radius: 4px;
          pointer-events: none;
          transition: width .1s ease-in, left .1s ease-in;
        }

        .thumb {
          position: absolute;
          width: var(--thumb-size);
          height: var(--thumb-size);
          background-color: var(--thumb-color);
          border: var(--thumb-border);
          border-radius: 50%;
          transform: translateX(-50%);
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          transition: left .1s ease-in, transform 0.1s ease-in, width 0.1s ease-in, height 0.1s ease-in;
          z-index: 2;
          box-sizing: border-box;
        }

        .thumb:hover {
          background-color: var(--thumb-hover);
          transform: translateX(-50%) scale(1.1);
        }
        
        .thumb:active {
          transform: translateX(-50%) scale(0.95);
        }

        /* Hide left thumb if not in dual mode */
        :host(:not([dual])) .thumb-min {
          display: none;
        }
      </style>

      <div class="container" id="container">
        <div class="track"></div>
        <div class="fill" id="fill"></div>
        <div class="thumb thumb-min" id="thumbMin"></div>
        <div class="thumb thumb-max" id="thumbMax"></div>
      </div>
    `;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = this.template;
    this.elements = {
      container: this.shadowRoot.getElementById("container"),
      fill: this.shadowRoot.getElementById("fill"),
      thumbMin: this.shadowRoot.getElementById("thumbMin"),
      thumbMax: this.shadowRoot.getElementById("thumbMax"),
    };

    this.updateUI();
    this.addEventListeners();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case "min":
        this._min = parseFloat(newValue);
        break;
      case "max":
        this._max = parseFloat(newValue);
        break;
      case "step":
        this._step = parseFloat(newValue);
        break;
      case "value":
        if (newValue.includes(",")) {
          const parts = newValue.split(",");
          this._valMin = parseFloat(parts[0]);
          this._valMax = parseFloat(parts[1]);
        } else {
          this._valMax = parseFloat(newValue);
          if (!this.hasAttribute("dual")) this._valMin = this._min;
        }
        break;
    }
    this.updateUI();
  }

  addEventListeners() {
    const container = this.elements.container;
    container.addEventListener("pointerdown", (e) => this.handleDragStart(e));
    window.addEventListener("pointermove", (e) => this.handleDragMove(e));
    window.addEventListener("pointerup", () => this.handleDragEnd());
  }

  handleDragStart(e) {
    if (this.hasAttribute("disabled")) return;

    this.elements.container.classList.add("immediate");

    this.isDragging = true;

    this.elements.thumbMin.style.zIndex = 2;
    this.elements.thumbMax.style.zIndex = 2;

    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const value = this.percentageToValue(percentage);

    if (this.hasAttribute("dual")) {
      const distMin = Math.abs(value - this._valMin);
      const distMax = Math.abs(value - this._valMax);

      if (this._valMin === this._valMax) {
        if (this._valMin === this._max) {
          this.currentHandle = "min";
        } else if (this._valMin === this._min) {
          this.currentHandle = "max";
        } else {
          this.currentHandle = value < this._valMin ? "min" : "max";
        }
      } else if (distMin < distMax) {
        this.currentHandle = "min";
      } else {
        this.currentHandle = "max";
      }

      if (this.currentHandle === "min") {
        this.elements.thumbMin.style.zIndex = 3;
      } else {
        this.elements.thumbMax.style.zIndex = 3;
      }
    } else {
      this.currentHandle = "max";
    }

    this.updateValueFromPointer(e);
  }

  handleDragMove(e) {
    if (!this.isDragging) return;
    this.updateValueFromPointer(e);
  }

  handleDragEnd() {
    if (this.isDragging) {
      this.isDragging = false;
      this.dispatchEvent(new Event("change", { bubbles: true }));
      this.updateFormValue();
      this.elements.container.classList.remove("immediate");
    }
  }

  updateValueFromPointer(e) {
    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let percentage = x / rect.width;
    percentage = Math.max(0, Math.min(1, percentage));

    let rawValue = this.percentageToValue(percentage);

    let value = Math.round(rawValue / this._step) * this._step;

    value = Math.max(this._min, Math.min(this._max, value));
    value = parseFloat(value.toFixed(2));

    if (this.currentHandle === "min") {
      if (value > this._valMax) value = this._valMax;
      this._valMin = value;
    } else {
      if (this.hasAttribute("dual") && value < this._valMin)
        value = this._valMin;
      this._valMax = value;
    }

    this.updateUI();
    this.dispatchEvent(new Event("input", { bubbles: true }));
  }

  percentageToValue(percentage) {
    return this._min + percentage * (this._max - this._min);
  }

  valueToPercentage(value) {
    return ((value - this._min) / (this._max - this._min)) * 100;
  }

  updateUI() {
    if (!this.elements) return;

    const pMin = this.valueToPercentage(
      this.hasAttribute("dual") ? this._valMin : this._min
    );
    const pMax = this.valueToPercentage(this._valMax);

    this.elements.thumbMin.style.left = `${pMin}%`;
    this.elements.thumbMax.style.left = `${pMax}%`;

    this.elements.fill.style.left = `${pMin}%`;
    this.elements.fill.style.width = `${pMax - pMin}%`;

    this.updateFormValue();
  }

  updateFormValue() {
    if (this.hasAttribute("dual")) {
      this.internals_.setFormValue(`${this._valMin},${this._valMax}`);
      this.setAttribute("value", `${this._valMin},${this._valMax}`);
    } else {
      this.internals_.setFormValue(this._valMax);
      this.setAttribute("value", this._valMax);
    }
  }

  get value() {
    if (this.hasAttribute("dual")) return [this._valMin, this._valMax];
    return this._valMax;
  }

  set value(val) {
    if (Array.isArray(val)) {
      this._valMin = val[0];
      this._valMax = val[1];
    } else {
      this._valMax = val;
    }
    this.updateUI();
  }

  get min() {
    return this._min;
  }

  set min(value) {
    this._min = value;
    this.updateUI();
  }

  get max() {
    return this._max;
  }

  set max(value) {
    this._max = value;
    this.updateUI();
  }

  get step() {
    return this._step;
  }

  set step(value) {
    this._step = value;
    this.updateUI();
  }
}

customElements.define("range-slider", RangeSlider);
