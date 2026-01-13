let activeEffect = null;

class ReactiveEffect {
  constructor(fn, scheduler) {
    this.fn = fn;
    this.scheduler = scheduler;
    this.deps = new Set();
  }

  run() {
    this.cleanup();
    activeEffect = this;
    try {
      this.fn();
    } finally {
      activeEffect = null;
    }
  }

  cleanup() {
    this.deps.forEach((depSet) => {
      depSet.delete(this);
    });
    this.deps.clear();
  }
}

function track(subscribers) {
  if (activeEffect) {
    subscribers.add(activeEffect);
    activeEffect.deps.add(subscribers);
  }
}

function trigger(subscribers) {
  const effectsToRun = new Set(subscribers);
  effectsToRun.forEach((effect) => {
    if (effect.scheduler) {
      effect.scheduler(effect);
    } else {
      effect.run();
    }
  });
}

export function signal(initialValue) {
  let value = initialValue;
  const subscribers = new Set();

  const sig = () => {
    track(subscribers);
    return value;
  };

  sig.set = (newValue) => {
    if (Object.is(value, newValue)) return;
    value = newValue;
    trigger(subscribers);
  };

  sig.update = (updater) => {
    sig.set(updater(value));
  };

  return sig;
}

export function effect(fn) {
  const effect = new ReactiveEffect(fn);
  effect.run();
}

export function effectRAF(fn) {
  let queued = false;
  const scheduler = (job) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      job.run();
    });
  };

  const effect = new ReactiveEffect(fn, scheduler);
  effect.run();
}

export function computed(fn) {
  let value;
  const subscribers = new Set();

  const computationEffect = new ReactiveEffect(() => {
    const newValue = fn();
    if (Object.is(value, newValue)) return;
    value = newValue;
    trigger(subscribers);
  });

  computationEffect.run();

  const computedSignal = () => {
    track(subscribers);
    return value;
  };

  return computedSignal;
}
