/**
 * Entity - Base class for all game objects
 * Designed for beat-synchronized updates
 */

import { Vec2 } from '../utils/Vec2';

export enum EntityType {
  Player = 'player',
  Bullet = 'bullet',
  Enemy = 'enemy',
  Effect = 'effect',
}

export enum EntityLayer {
  Background = 0,
  Enemy = 10,
  Bullet = 20,
  Player = 30,
  Effect = 40,
  UI = 100,
}

export interface EntityConfig {
  position: Vec2;
  velocity?: Vec2;
  size?: Vec2; // For collision (half-extents)
  char?: string; // Display character
  color?: string; // ANSI color code
  layer?: EntityLayer;
  lifetime?: number; // Beats until auto-destroy (0 = infinite)
}

export abstract class Entity {
  // Identity
  readonly id: number;
  readonly type: EntityType;

  // Transform
  position: Vec2;
  velocity: Vec2;
  size: Vec2; // Half-extents for AABB collision

  // Rendering
  char: string;
  color: string;
  layer: EntityLayer;

  // State
  active: boolean = true;
  age: number = 0; // Beats alive
  lifetime: number; // Beats until auto-destroy (0 = infinite)

  // Beat-sync
  protected lastBeatPosition: Vec2;
  protected beatProgress: number = 0; // 0-1 within current beat

  private static idCounter = 0;

  constructor(type: EntityType, config: EntityConfig) {
    this.id = Entity.idCounter++;
    this.type = type;
    this.position = config.position.clone();
    this.velocity = config.velocity?.clone() || Vec2.zero();
    this.size = config.size?.clone() || new Vec2(0.5, 0.5);
    this.char = config.char || '?';
    this.color = config.color || '\x1b[37m'; // White
    this.layer = config.layer || EntityLayer.Enemy;
    this.lifetime = config.lifetime || 0;
    this.lastBeatPosition = this.position.clone();
  }

  /**
   * Called once per beat (synchronized with BeatClock)
   * Override for beat-based logic
   */
  onBeat(beatNumber: number, bpm: number): void {
    this.age++;
    this.lastBeatPosition.copy(this.position);
    this.beatProgress = 0;

    // Lifetime check
    if (this.lifetime > 0 && this.age >= this.lifetime) {
      this.destroy();
    }
  }

  /**
   * Called every frame (sub-beat interpolation)
   * dt is 0-1 representing progress within current beat
   */
  onTick(dt: number, beatIntervalMs: number): void {
    this.beatProgress = dt;
    // Default: smooth interpolation between beat positions
    // Subclasses can override for different movement styles
  }

  /**
   * Called when entity should be removed
   */
  destroy(): void {
    this.active = false;
  }

  /**
   * Check if this entity collides with another (AABB)
   */
  collidesWith(other: Entity): boolean {
    if (!this.active || !other.active) {
      return false;
    }
    if (this === other) {
      return false;
    }

    const dx = Math.abs(this.position.x - other.position.x);
    const dy = Math.abs(this.position.y - other.position.y);
    const combinedHalfWidth = this.size.x + other.size.x;
    const combinedHalfHeight = this.size.y + other.size.y;

    return dx < combinedHalfWidth && dy < combinedHalfHeight;
  }

  /**
   * Get interpolated render position (for smooth visuals)
   */
  getRenderPosition(): Vec2 {
    return new Vec2(
      this.lastBeatPosition.x + (this.position.x - this.lastBeatPosition.x) * this.beatProgress,
      this.lastBeatPosition.y + (this.position.y - this.lastBeatPosition.y) * this.beatProgress
    );
  }

  /**
   * Get render character with color
   */
  getRenderChar(): string {
    return `${this.color}${this.char}\x1b[0m`;
  }

  /**
   * Serialize for debugging/save
   */
  serialize(): object {
    return {
      id: this.id,
      type: this.type,
      position: { x: this.position.x, y: this.position.y },
      velocity: { x: this.velocity.x, y: this.velocity.y },
      age: this.age,
      active: this.active,
    };
  }
}

/**
 * EntityManager - Handles entity lifecycle, updates, queries
 */
export class EntityManager {
  private entities: Map<number, Entity> = new Map();
  private toAdd: Entity[] = [];
  private toRemove: number[] = [];
  private byType: Map<EntityType, Set<Entity>> = new Map();

  constructor() {
    // Initialize type buckets
    Object.values(EntityType).forEach(t => this.byType.set(t, new Set()));
  }

  add(entity: Entity): Entity {
    this.toAdd.push(entity);
    return entity;
  }

  remove(entity: Entity): void {
    if (entity.active) {
      this.toRemove.push(entity.id);
    }
  }

  removeById(id: number): void {
    this.toRemove.push(id);
  }

  clear(): void {
    this.entities.forEach(e => e.destroy());
    this.toRemove.push(...this.entities.keys());
    this.flush();
  }

  private flush(): void {
    // Add new entities
    for (const entity of this.toAdd) {
      this.entities.set(entity.id, entity);
      this.byType.get(entity.type)!.add(entity);
    }
    this.toAdd.length = 0;

    // Remove destroyed entities
    for (const id of this.toRemove) {
      const entity = this.entities.get(id);
      if (entity) {
        this.byType.get(entity.type)!.delete(entity);
        this.entities.delete(id);
      }
    }
    this.toRemove.length = 0;
  }

  update(beatNumber: number, bpm: number): void {
    // Beat update
    for (const entity of this.entities.values()) {
      if (entity.active) {
        entity.onBeat(beatNumber, bpm);
      }
    }
    this.flush();
  }

  tick(dt: number, beatIntervalMs: number): void {
    for (const entity of this.entities.values()) {
      if (entity.active) {
        entity.onTick(dt, beatIntervalMs);
      }
    }
  }

  getAll(): Entity[] {
    return Array.from(this.entities.values());
  }

  getActive(): Entity[] {
    return Array.from(this.entities.values()).filter(e => e.active);
  }

  getByType(type: EntityType): Entity[] {
    return Array.from(this.byType.get(type) || []).filter(e => e.active);
  }

  getByLayer(layer: EntityLayer): Entity[] {
    return this.getActive().filter(e => e.layer === layer);
  }

  // Collision queries
  checkCollisions(typeA: EntityType, typeB: EntityType): Array<[Entity, Entity]> {
    const results: Array<[Entity, Entity]> = [];
    const listA = this.getByType(typeA);
    const listB = this.getByType(typeB);

    for (const a of listA) {
      for (const b of listB) {
        if (a.collidesWith(b)) {
          results.push([a, b]);
        }
      }
    }
    return results;
  }

  findNearest(position: Vec2, type: EntityType, maxDistance: number = Infinity): Entity | null {
    let nearest: Entity | null = null;
    let nearestDist = maxDistance;

    for (const entity of this.getByType(type)) {
      const dist = entity.position.distance(position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = entity;
      }
    }
    return nearest;
  }

  getCount(): number {
    return this.entities.size;
  }

  getActiveCount(): number {
    let count = 0;
    for (const e of this.entities.values()) {
      if (e.active) {
        count++;
      }
    }
    return count;
  }
}
