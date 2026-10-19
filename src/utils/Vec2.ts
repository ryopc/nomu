/**
 * Vec2 - 2D vector math utilities
 * Lightweight, no allocations in hot paths where possible
 */

export class Vec2 {
  x: number;
  y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  // Static factory methods
  static zero(): Vec2 { return new Vec2(0, 0); }
  static one(): Vec2 { return new Vec2(1, 1); }
  static up(): Vec2 { return new Vec2(0, -1); }
  static down(): Vec2 { return new Vec2(0, 1); }
  static left(): Vec2 { return new Vec2(-1, 0); }
  static right(): Vec2 { return new Vec2(1, 0); }

  // Copy & clone
  copy(other: Vec2): this {
    this.x = other.x;
    this.y = other.y;
    return this;
  }
  clone(): Vec2 { return new Vec2(this.x, this.y); }

  // Arithmetic (mutable - for performance in update loops)
  add(other: Vec2): this {
    this.x += other.x;
    this.y += other.y;
    return this;
  }
  sub(other: Vec2): this {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }
  scale(scalar: number): this {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  // Arithmetic (immutable - for calculations)
  added(other: Vec2): Vec2 { return new Vec2(this.x + other.x, this.y + other.y); }
  subbed(other: Vec2): Vec2 { return new Vec2(this.x - other.x, this.y - other.y); }
  scaled(scalar: number): Vec2 { return new Vec2(this.x * scalar, this.y * scalar); }

  // Properties
  length(): number { return Math.hypot(this.x, this.y); }
  lengthSq(): number { return this.x * this.x + this.y * this.y; }
  distance(other: Vec2): number { return this.subbed(other).length(); }
  distanceSq(other: Vec2): number { return this.subbed(other).lengthSq(); }

  normalize(): this {
    const len = this.length();
    if (len > 0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }
  normalized(): Vec2 { return this.clone().normalize(); }

  // Utility
  floor(): this { this.x = Math.floor(this.x); this.y = Math.floor(this.y); return this; }
  ceil(): this { this.x = Math.ceil(this.x); this.y = Math.ceil(this.y); return this; }
  round(): this { this.x = Math.round(this.x); this.y = Math.round(this.y); return this; }
  clamp(min: Vec2, max: Vec2): this {
    this.x = Math.max(min.x, Math.min(max.x, this.x));
    this.y = Math.max(min.y, Math.min(max.y, this.y));
    return this;
  }
  lerp(target: Vec2, t: number): this {
    this.x += (target.x - this.x) * t;
    this.y += (target.y - this.y) * t;
    return this;
  }

  // Comparison
  equals(other: Vec2): boolean { return this.x === other.x && this.y === other.y; }
  approxEquals(other: Vec2, epsilon: number = 0.0001): boolean {
    return Math.abs(this.x - other.x) < epsilon && Math.abs(this.y - other.y) < epsilon;
  }

  toString(): string { return `(${this.x}, ${this.y})`; }
}

// Immutable vector operations for functional style
export const v2 = {
  add: (a: Vec2, b: Vec2) => new Vec2(a.x + b.x, a.y + b.y),
  sub: (a: Vec2, b: Vec2) => new Vec2(a.x - b.x, a.y - b.y),
  mul: (a: Vec2, s: number) => new Vec2(a.x * s, a.y * s),
  div: (a: Vec2, s: number) => new Vec2(a.x / s, a.y / s),
  dot: (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y,
  cross: (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x,
  lerp: (a: Vec2, b: Vec2, t: number) => new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
  clamp: (v: Vec2, min: Vec2, max: Vec2) => new Vec2(
    Math.max(min.x, Math.min(max.x, v.x)),
    Math.max(min.y, Math.min(max.y, v.y))
  ),
};