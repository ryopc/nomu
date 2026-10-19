/**
 * Random - Seeded pseudo-random number generator
 * Uses xoshiro256** for good quality and speed
 * Deterministic for replay/debugging
 */

export class Random {
  private state: Uint32Array;

  constructor(seed?: number | number[]) {
    this.state = new Uint32Array(4);
    if (seed === undefined) {
      // Auto-seed from time and Math.random
      this.seed(Date.now() ^ Math.floor(Math.random() * 0x100000000));
    } else if (Array.isArray(seed)) {
      this.setState(seed);
    } else {
      this.seed(seed);
    }
  }

  // Initialize state from a single 32-bit seed using splitmix64
  seed(seed: number): void {
    let z = (seed + 0x9e3779b9) | 0;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b9) | 0;
      let t = z ^ (z >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      this.state[i] = t >>> 0;
    }
  }

  setState(state: number[]): void {
    for (let i = 0; i < 4; i++) {
      this.state[i] = state[i] >>> 0;
    }
  }

  getState(): number[] {
    return [this.state[0], this.state[1], this.state[2], this.state[3]];
  }

  // Core: next 32-bit integer
  next(): number {
    const s = this.state;
    const result = Math.imul(s[0] + s[3], 0x9e3779bb) >>> 0;
    const t = s[1] << 17;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 45) | (s[3] >>> 19);
    return result;
  }

  // [0, 1)
  nextFloat(): number {
    return (this.next() >>> 0) / 0x100000000;
  }

  // [min, max)
  nextFloatRange(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  // [min, max] inclusive
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  // Boolean with probability
  nextBool(probability: number = 0.5): boolean {
    return this.nextFloat() < probability;
  }

  // Random element from array
  choice<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  // Shuffle array in place (Fisher-Yates)
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // Normal distribution (Box-Muller)
  nextGaussian(mean: number = 0, stdDev: number = 1): number {
    const u1 = this.nextFloat();
    const u2 = this.nextFloat();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }

  // Weighted choice
  weightedChoice<T>(items: T[], weights: number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.nextFloat() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

// Global default instance
export const random = new Random();

// Helper functions using global instance
export const rand = {
  float: () => random.nextFloat(),
  floatRange: (min: number, max: number) => random.nextFloatRange(min, max),
  int: (min: number, max: number) => random.nextInt(min, max),
  bool: (p?: number) => random.nextBool(p),
  choice: <T>(arr: T[]) => random.choice(arr),
  shuffle: <T>(arr: T[]) => random.shuffle(arr),
  gaussian: (mean?: number, stdDev?: number) => random.nextGaussian(mean, stdDev),
  seed: (s: number) => random.seed(s),
  getState: () => random.getState(),
  setState: (s: number[]) => random.setState(s),
};