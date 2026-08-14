// A neural network small enough to read.
//
// There is no library here on purpose. The whole app is a static page with no
// build step and no dependencies, and dragging in a tensor framework to fit a
// few thousand weights would be the tail wagging the dog. What follows is a
// multilayer perceptron — matrix, bias, squash, repeat — with the backward pass
// written out by hand, which is about two hundred lines and behaves exactly the
// same as the version that needs a hundred megabytes of wheels.
//
// It is deliberately tiny. The training set is one person answering questions
// about music in the evening; if that is two hundred examples then a model with
// ten thousand parameters will memorise every one of them and know nothing. So:
// a couple of narrow layers, weight decay on everything, and a held-out fold
// that gets the final say. The constraint is the data, not the arithmetic.

/** Everything a gradient can be accumulated into: weights, biases. */
class Param {
  constructor(size, init = 0) {
    this.value = new Float64Array(size).fill(init);
    this.grad = new Float64Array(size);
  }

  zero() {
    this.grad.fill(0);
  }
}

/**
 * y = Wx + b.
 *
 * Holds on to its input so the backward pass can work out dW without being
 * handed it again, which is the only piece of state a layer needs.
 */
export class Linear {
  constructor(inDim, outDim, rng) {
    this.inDim = inDim;
    this.outDim = outDim;
    this.w = new Param(inDim * outDim);
    this.b = new Param(outDim);
    // Xavier: keep the variance of the signal roughly constant as it goes
    // through, so a three-layer net does not arrive at the output as noise.
    const scale = Math.sqrt(6 / (inDim + outDim));
    for (let i = 0; i < this.w.value.length; i++) this.w.value[i] = (rng() * 2 - 1) * scale;
    this.x = null;
  }

  forward(x) {
    this.x = x;
    const y = new Float64Array(this.outDim);
    const w = this.w.value;
    for (let o = 0; o < this.outDim; o++) {
      let sum = this.b.value[o];
      const row = o * this.inDim;
      for (let i = 0; i < this.inDim; i++) sum += w[row + i] * x[i];
      y[o] = sum;
    }
    return y;
  }

  /** @returns {Float64Array} the gradient with respect to this layer's input */
  backward(gy) {
    const gx = new Float64Array(this.inDim);
    const w = this.w.value;
    const gw = this.w.grad;
    for (let o = 0; o < this.outDim; o++) {
      const g = gy[o];
      if (g === 0) continue;
      const row = o * this.inDim;
      this.b.grad[o] += g;
      for (let i = 0; i < this.inDim; i++) {
        gw[row + i] += g * this.x[i];
        gx[i] += w[row + i] * g;
      }
    }
    return gx;
  }

  params() {
    return [this.w, this.b];
  }

  toJSON() {
    return {
      in: this.inDim,
      out: this.outDim,
      // Six places is well inside float64's ability to reproduce a forward
      // pass, and it keeps the committed model diffable rather than a wall.
      w: [...this.w.value].map(round6),
      b: [...this.b.value].map(round6),
    };
  }

  static fromJSON(json) {
    const layer = Object.create(Linear.prototype);
    layer.inDim = json.in;
    layer.outDim = json.out;
    layer.w = new Param(json.in * json.out);
    layer.b = new Param(json.out);
    layer.w.value.set(json.w);
    layer.b.value.set(json.b);
    layer.x = null;
    return layer;
  }
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * tanh, kept as a layer so the backward pass has somewhere to remember its own
 * output — which is all the derivative needs (1 - y²).
 */
export class Tanh {
  forward(x) {
    const y = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = Math.tanh(x[i]);
    this.y = y;
    return y;
  }

  backward(gy) {
    const gx = new Float64Array(gy.length);
    for (let i = 0; i < gy.length; i++) gx[i] = gy[i] * (1 - this.y[i] * this.y[i]);
    return gx;
  }

  params() {
    return [];
  }
}

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
}

/**
 * A stack of layers, run in order. Nothing clever: `forward` threads the vector
 * through, `backward` threads the gradient back out.
 */
export class Sequential {
  constructor(layers) {
    this.layers = layers;
  }

  forward(x) {
    let out = x;
    for (const layer of this.layers) out = layer.forward(out);
    return out;
  }

  backward(gy) {
    let grad = gy;
    for (let i = this.layers.length - 1; i >= 0; i--) grad = this.layers[i].backward(grad);
    return grad;
  }

  params() {
    return this.layers.flatMap((layer) => layer.params());
  }
}

/**
 * Adam, with decoupled weight decay.
 *
 * Plain SGD works here too, but Adam gets a model this small to a sensible
 * place in a couple of hundred passes rather than a couple of thousand, which
 * matters when the training button is in a browser and someone is waiting for
 * it. The decay is decoupled (AdamW) because coupling it to the adaptive step
 * makes the amount of regularisation depend on how noisy each weight happened
 * to be, which is not what anybody wants it to mean.
 */
export class Adam {
  constructor(params, { rate = 0.02, beta1 = 0.9, beta2 = 0.999, eps = 1e-8, decay = 0 } = {}) {
    this.params = params;
    this.rate = rate;
    this.beta1 = beta1;
    this.beta2 = beta2;
    this.eps = eps;
    this.decay = decay;
    this.step = 0;
    this.m = params.map((p) => new Float64Array(p.value.length));
    this.v = params.map((p) => new Float64Array(p.value.length));
  }

  zeroGrad() {
    for (const param of this.params) param.zero();
  }

  /** @param {number} [scale] divide the accumulated gradients by the batch size */
  apply(scale = 1) {
    this.step += 1;
    const bc1 = 1 - this.beta1 ** this.step;
    const bc2 = 1 - this.beta2 ** this.step;
    for (let p = 0; p < this.params.length; p++) {
      const param = this.params[p];
      const m = this.m[p];
      const v = this.v[p];
      for (let i = 0; i < param.value.length; i++) {
        const g = param.grad[i] / scale;
        m[i] = this.beta1 * m[i] + (1 - this.beta1) * g;
        v[i] = this.beta2 * v[i] + (1 - this.beta2) * g * g;
        const stepSize = this.rate * (m[i] / bc1) / (Math.sqrt(v[i] / bc2) + this.eps);
        param.value[i] -= stepSize + this.rate * this.decay * param.value[i];
      }
    }
  }
}

/**
 * Binary cross-entropy against a soft target.
 *
 * The ratings are not yes/no — "it's fine" is a real answer and lands at 0.5 —
 * so the target is a number in 0..1 rather than a label. Cross-entropy handles
 * that without complaint and, unlike squared error, does not go flat when the
 * model is confidently wrong, which is exactly when you want it to move.
 *
 * @returns {{loss: number, grad: number}} grad is with respect to the *logit*
 */
export function bce(logit, target) {
  const p = sigmoid(logit);
  const safe = Math.min(1 - 1e-7, Math.max(1e-7, p));
  const loss = -(target * Math.log(safe) + (1 - target) * Math.log(1 - safe));
  return { loss, grad: p - target };
}

/**
 * A second copy of a layer that *is* the same layer: new caches, same weights.
 *
 * A pair of sections is judged by running one trunk over both of them, so the
 * trunk has to hold two forward passes at once without either overwriting the
 * other's working. Sharing the Param objects rather than the layer means both
 * copies accumulate into the same gradients and the optimiser sees one set of
 * weights, which is what "the same ears listened to both" means in arithmetic.
 */
Linear.prototype.share = function share() {
  const copy = Object.create(Linear.prototype);
  copy.inDim = this.inDim;
  copy.outDim = this.outDim;
  copy.w = this.w;
  copy.b = this.b;
  copy.x = null;
  return copy;
};

Tanh.prototype.share = function share() {
  return new Tanh();
};

Sequential.prototype.share = function share() {
  return new Sequential(this.layers.map((layer) => layer.share()));
};

/** Unique by identity — a shared Param must be handed to the optimiser once. */
export function uniqueParams(...groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    for (const param of group) {
      if (seen.has(param)) continue;
      seen.add(param);
      out.push(param);
    }
  }
  return out;
}
