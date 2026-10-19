/**
 * Bullet - Projectile fired by player
 * Moves upward on beat, synchronized with rhythm
 */

import { Entity, EntityType, EntityLayer } from './Entity';
import { Vec2 } from '../utils/Vec2';

export interface BulletConfig {
  position: Vec2;
  speed?: number; // Cells per beat
  damage?: number;
  color?: string;
  char?: string;
  size?: Vec2;
  lifetime?: number; // Beats
}

export class Bullet extends Entity {
  private speed: number;
  private damage: number;
  private screenTop: number;
  private hitEffect: boolean = false;

  constructor(config: BulletConfig) {
    super(EntityType.Bullet, {
      position: config.position,
      velocity: new Vec2(0, -1), // Upward
      char: config.char || '│',
      color: config.color || '\x1b[96m', // Bright cyan
      layer: EntityLayer.Bullet,
      size: config.size || new Vec2(0.3, 0.5),
      lifetime: config.lifetime || 15,
    });

    this.speed = config.speed || 2; // cells per beat
    this.damage = config.damage || 1;
    this.screenTop = 0;
    this.velocity.y = -this.speed;
  }

  setScreenBounds(top: number): void {
    this.screenTop = top;
  }

  onBeat(beatNumber: number, bpm: number): void {
    super.onBeat(beatNumber, bpm);

    // Move on beat (position updated in onTick for smooth visual)
    this.position.y += this.velocity.y;

    // Check bounds
    if (this.position.y <= this.screenTop + this.size.y) {
      this.destroy();
    }

    // Hit effect flash
    if (this.hitEffect) {
      this.char = '*';
      this.color = '\x1b[93m'; // Yellow
      this.hitEffect = false;
    }
  }

  onTick(dt: number, beatIntervalMs: number): void {
    super.onTick(dt, beatIntervalMs);
    // Position is interpolated in getRenderPosition()
  }

  triggerHitEffect(): void {
    this.hitEffect = true;
  }

  resetForReuse(position: Vec2, char: string, color: string): void {
    this.position.copy(position);
    this.active = true;
    this.age = 0;
    this.char = char;
    this.color = color;
    this.hitEffect = false;
  }

  getDamage(): number {
    return this.damage;
  }

  // For collision - bullets are thin
  getCollisionSize(): Vec2 {
    return new Vec2(this.size.x * 0.5, this.size.y);
  }
}

/**
 * BulletPool - Object pool for bullet reuse (performance)
 */
export class BulletPool {
  private pool: Bullet[] = [];
  private active: Bullet[] = [];
  private config: BulletConfig;
  private maxSize: number;

  constructor(config: BulletConfig, maxSize: number = 50) {
    this.config = config;
    this.maxSize = maxSize;
  }

  acquire(position: Vec2): Bullet {
    let bullet: Bullet;

    if (this.pool.length > 0) {
      bullet = this.pool.pop()!;
      bullet.resetForReuse(position, this.config.char || '│', this.config.color || '\x1b[96m');
    } else {
      bullet = new Bullet({ ...this.config, position: position.clone() });
    }

    this.active.push(bullet);
    return bullet;
  }

  release(bullet: Bullet): void {
    const idx = this.active.indexOf(bullet);
    if (idx >= 0) {
      this.active.splice(idx, 1);
      bullet.destroy();
      if (this.pool.length < this.maxSize) {
        this.pool.push(bullet);
      }
    }
  }

  update(beatNumber: number, bpm: number): void {
    for (const bullet of this.active) {
      bullet.onBeat(beatNumber, bpm);
      if (!bullet.active) {
        this.release(bullet);
      }
    }
  }

  tick(dt: number, beatIntervalMs: number): void {
    for (const bullet of this.active) {
      bullet.onTick(dt, beatIntervalMs);
    }
  }

  getActive(): Bullet[] {
    return this.active;
  }

  clear(): void {
    for (const bullet of this.active) {
      bullet.destroy();
      if (this.pool.length < this.maxSize) {
        this.pool.push(bullet);
      }
    }
    this.active.length = 0;
  }
}
