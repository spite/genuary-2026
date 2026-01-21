import { signal, effect } from "./reactive.js";
import "./range-slider.js";
import Maf from "maf";

function precision(a) {
  if (!isFinite(a)) return 0;
  var e = 1,
    p = 0;
  while (Math.round(a * e) / e !== a) {
    e *= 10;
    p++;
  }
  return p;
}

function formatFloat(v, step) {
  return parseFloat(v).toFixed(precision(step));
}

function composeRangeValue(min, max, step) {
  return `${formatFloat(min, step)}-${formatFloat(max, step)}`;
}

class GUI {
  constructor(title = "Settings", el = document.body) {
    this.container = document.createElement("div");
    this.container.className = "gui";

    const titleEl = document.createElement("div");
    titleEl.className = "title";
    titleEl.textContent = title;
    this.container.append(titleEl);

    const expandEl = document.createElement("span");
    expandEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg>`;
    titleEl.append(expandEl);

    this.scroller = document.createElement("div");
    this.scroller.className = "gui-scroller";
    this.container.append(this.scroller);

    this.rows = document.createElement("div");
    this.rows.className = "gui-rows";

    this.scroller.append(this.rows);
    this.rowsExpanded = signal(window.innerWidth > 950);

    titleEl.addEventListener("click", (e) => {
      this.rowsExpanded.set(!this.rowsExpanded());
    });

    effect(() => {
      this.rows.classList.toggle("visible", this.rowsExpanded());
    });

    el.append(this.container);
  }

  show() {
    this.container.classList.add("visible");
  }

  hide() {
    this.container.classList.remove("visible");
  }

  createRow(label, disabled, randomize) {
    const row = document.createElement("div");
    row.className = "gui-row";
    if (label) {
      const labelEl = document.createElement("span");
      labelEl.className = "gui-label";
      labelEl.textContent = label;
      row.append(labelEl);

      if (randomize) {
        labelEl.addEventListener("click", (e) => {
          Math.seedrandom(performance.now());
          randomize();
        });
      }
    }

    if (disabled) {
      effect(() => {
        row.classList.toggle("disabled", disabled());
      });
    }

    this.rows.append(row);
    return row;
  }

  addButton(label, callback, disabled) {
    const row = this.createRow(null, disabled);
    const btn = document.createElement("button");
    btn.className = "gui-btn";
    btn.textContent = label;
    btn.onclick = callback;
    row.append(btn);
    return this;
  }

  addText(label, initialValue, onChange = () => {}, disabled) {
    const row = this.createRow(label, disabled);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "gui-input-text";
    input.value = initialValue;
    input.oninput = (e) => onChange(e.target.value);
    row.append(input);
    return this;
  }

  addSelect(label, signal, options, onChange = () => {}, disabled) {
    const row = this.createRow(label, disabled, () => {
      const opt = Maf.randomElement(options);
      if (Array.isArray(opt)) {
        signal.set(opt[0]);
      } else {
        signal.set(opt);
      }
    });
    const select = document.createElement("select");
    select.className = "gui-select";

    const optionEls = [];

    options.forEach((opt) => {
      const el = document.createElement("option");
      if (Array.isArray(opt)) {
        el.value = opt[0];
        el.textContent = opt[1];
        if (opt[0] === signal()) el.selected = true;
      } else {
        el.value = opt;
        el.textContent = opt;
        if (opt === signal()) el.selected = true;
      }
      select.append(el);
      optionEls.push(el);
    });

    effect(() => {
      for (const el of optionEls) {
        el.selected = el.value === signal();
      }
    });

    select.onchange = (e) => {
      signal.set(e.target.value);
      onChange(e.target.value);
    };

    row.append(select);
    return this;
  }

  addCheckbox(label, signal, onChange = () => {}, disabled) {
    const row = this.createRow(label, disabled, () => {
      signal.set(Math.random() > 0.5);
    });
    const input = document.createElement("input");
    input.type = "checkbox";

    effect(() => {
      input.checked = signal();
    });

    input.onchange = (e) => {
      signal.set(input.checked);
      onChange(e.target.checked);
    };
    row.append(input);
    return this;
  }

  addSlider(label, signal, min, max, step, onChange = () => {}, disabled) {
    const row = this.createRow(label, disabled, () => {
      signal.set(formatFloat(Maf.randomInRange(min, max), step));
    });

    const wrapper = document.createElement("div");
    wrapper.className = "gui-slider-container";

    const input = document.createElement("range-slider");
    input.type = "range";
    input.className = "gui-slider";
    input.min = min;
    input.max = max;
    input.step = step;

    const valDisplay = document.createElement("span");
    valDisplay.className = "gui-slider-val";
    valDisplay.textContent = signal();

    input.oninput = (e) => {
      const v = parseFloat(e.target.value);
      valDisplay.textContent = formatFloat(v, step);
      signal.set(v);
      onChange(v);
    };

    effect(() => {
      input.value = signal();
      valDisplay.textContent = formatFloat(signal(), step);
    });

    wrapper.append(input);
    wrapper.append(valDisplay);
    row.append(wrapper);
    return this;
  }

  addRangeSlider(label, signal, min, max, step, onChange = () => {}, disabled) {
    const row = this.createRow(label, disabled, () => {
      const a = parseFloat(Maf.randomInRange(min, max), step);
      const b = parseFloat(Maf.randomInRange(a, max), step);
      signal.set([a, b]);
    });

    const wrapper = document.createElement("div");
    wrapper.className = "gui-slider-container";

    const input = document.createElement("range-slider");
    input.setAttribute("dual", true);
    input.type = "range";
    input.className = "gui-slider";
    input.min = min;
    input.max = max;
    input.step = step;

    const valDisplay = document.createElement("span");
    valDisplay.className = "gui-slider-val";
    const display = composeRangeValue(signal()[0], signal()[1], step);
    valDisplay.textContent = display;

    input.oninput = (e) => {
      const v = e.target.value;
      signal.set([parseFloat(v[0]), parseFloat(v[1])]);
      const display = composeRangeValue(signal()[0], signal()[1], step);
      valDisplay.textContent = display;
      onChange(v);
    };

    effect(() => {
      input.value = [signal()[0], signal()[1]];
      const display = composeRangeValue(signal()[0], signal()[1], step);
      valDisplay.textContent = display;
    });

    wrapper.append(input);
    wrapper.append(valDisplay);
    row.append(wrapper);
    return this;
  }

  addLabel(label) {
    const row = this.createRow(label);
    return this;
  }

  addText(text) {
    const row = this.createRow();

    const content = document.createElement("div");
    content.className = "gui-text";
    content.innerHTML = text;
    row.append(content);

    return this;
  }

  addSeparator() {
    const row = this.createRow();

    const line = document.createElement("div");
    line.className = "gui-separator";
    row.append(line);

    return this;
  }
}

export default GUI;
