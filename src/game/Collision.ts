/**
 * Collision - Collision detection and resolution
 * Optimized for beat-synchronized game loop
 */

import type { Entity, EntityManager } from './Entity';
import { EntityType } from './Entity';
import type { Bullet } from './Bullet';
import { Enemy, EnemyKind } from './Enemy';
import { Vec2 } from '../utils/Vec2';

export interface CollisionResult {
  bullet: Bullet;
  enemy: Enemy;
  position: Vec2;
}

export interface HitJudgment {
  timing: 'perfect' | 'great' | 'miss';
  timingMs: number; // Offset from beat in ms
  scoreMultiplier: number;
  comboBonus: number;
}

export class CollisionSystem {
  private entityManager: EntityManager;
  private hitCallbacks: Array<(result: CollisionResult, judgment: HitJudgment) => void> = [];
  private missCallbacks: Array<(bullet: Bullet) => void> = [];

  // Timing windows (ms from beat)
  private readonly PERFECT_WINDOW = 50;
  private readonly GREAT_WINDOW = 150;

  constructor(entityManager: EntityManager) {
    this.entityManager = entityManager;
  }

  /**
   * Register callback for successful hits
   */
  onHit(callback: (result: CollisionResult, judgment: HitJudgment) => void): () => void {
    this.hitCallbacks.push(callback);
    return () => {
      const idx = this.hitCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.hitCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * Register callback for bullet misses (reached top without hitting)
   */
  onMiss(callback: (bullet: Bullet) => void): () => void {
    this.missCallbacks.push(callback);
    return () => {
      const idx = this.missCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.missCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * Process all collisions for current frame
   * Returns array of collision results with timing judgments
   */
  process(beatNumber: number, beatIntervalMs: number, timeSinceBeatMs: number): CollisionResult[] {
    const results: CollisionResult[] = [];

    // Bullet vs Enemy collisions
    const collisions = this.entityManager.checkCollisions(EntityType.Bullet, EntityType.Enemy);

    for (const [bullet, enemy] of collisions) {
      if (!bullet.active || !enemy.active) {
        continue;
      }

      // Don't collide with dying enemies (type guard)
      if (enemy instanceof Enemy && enemy.isDyingState()) {
        continue;
      }

      const b = bullet as Bullet;
      const e = enemy as Enemy;

      // Resolve collision
      const killed = e.takeDamage(b.getDamage());
      b.triggerHitEffect();

      // Bullet is consumed on hit (unless piercing)
      b.destroy();

      const position = new Vec2((b.position.x + e.position.x) * 0.5, (b.position.y + e.position.y) * 0.5);

      const result: CollisionResult = { bullet: b, enemy: e, position };
      results.push(result);

      // Calculate timing judgment
      const judgment = this.calculateJudgment(timeSinceBeatMs, beatIntervalMs);

      // Notify callbacks
      this.hitCallbacks.forEach(cb => cb(result, judgment));

      // Handle enemy death effects
      if (killed) {
        this.handleEnemyDeath(e, position);
      }
    }

    // Check for bullets that missed (reached top)
    const bullets = this.entityManager.getByType(EntityType.Bullet);
    for (const bullet of bullets) {
      const b = bullet as Bullet;
      if (b.position.y <= 1) {
        b.destroy();
        this.missCallbacks.forEach(cb => cb(b));
      }
    }

    return results;
  }

  /**
   * Calculate hit timing judgment based on when bullet was fired vs beat
   * timeSinceBeatMs: ms since last beat (0 = on beat, beatIntervalMs = next beat)
   */
  private calculateJudgment(timeSinceBeatMs: number, beatIntervalMs: number): HitJudgment {
    // Distance from nearest beat
    const distFromBeat = Math.min(timeSinceBeatMs, beatIntervalMs - timeSinceBeatMs);

    if (distFromBeat <= this.PERFECT_WINDOW) {
      return {
        timing: 'perfect',
        timingMs: distFromBeat,
        scoreMultiplier: 1.5,
        comboBonus: 1,
      };
    } else if (distFromBeat <= this.GREAT_WINDOW) {
      return {
        timing: 'great',
        timingMs: distFromBeat,
        scoreMultiplier: 1.0,
        comboBonus: 1,
      };
    } else {
      return {
        timing: 'miss',
        timingMs: distFromBeat,
        scoreMultiplier: 0,
        comboBonus: 0,
      };
    }
  }

  /**
   * Handle enemy death - spawn effects, handle splitters, etc.
   */
  private handleEnemyDeath(enemy: Enemy, position: Vec2): void {
    switch (enemy.getKind()) {
      case EnemyKind.Splitter:
        // Split into smaller enemies
        this.spawnSplitters(enemy, position);
        break;
      case EnemyKind.Boss:
        // Boss death handled by GameState
        break;
    }
  }

  private spawnSplitters(parent: Enemy, position: Vec2): void {
    const splitCount = 2;
    for (let i = 0; i < splitCount; i++) {
      const angle = ((Math.PI * 2) / splitCount) * i;
      const splitPos = new Vec2(position.x + Math.cos(angle) * 2, position.y + Math.sin(angle) * 2);

      const splitter = Enemy.createBasic(splitPos, 1);
      splitter.hp = 1;
      splitter.scoreValue = 50;
      splitter.speed = 1.5;
      splitter.char = '·';
      splitter.color = '\x1b[90m'; // Gray
      splitter.setScreenBounds(1, 79, 24);

      this.entityManager.add(splitter);
    }
  }

  /**
   * Check player vs enemy collision (for game over)
   */
  checkPlayerCollision(player: Entity): Enemy | null {
    const enemies = this.entityManager.getByType(EntityType.Enemy);
    for (const enemy of enemies) {
      if (enemy.active && enemy instanceof Enemy && !enemy.isDyingState() && player.collidesWith(enemy)) {
        return enemy;
      }
    }
    return null;
  }

  /**
   * Get timing window constants for external use
   */
  getPerfectWindow(): number {
    return this.PERFECT_WINDOW;
  }
  getGreatWindow(): number {
    return this.GREAT_WINDOW;
  }
}

/**
 * Spatial partitioning for future optimization (quadtree/grid)
 * Currently unused but ready for when entity counts grow
 */
export class SpatialGrid {
  private cellSize: number;
  private grid: Map<string, Entity[]> = new Map();
  private width: number;
  private height: number;

  constructor(width: number, height: number, cellSize: number = 10) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
  }

  private getCellKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  clear(): void {
    this.grid.clear();
  }

  insert(entity: Entity): void {
    const key = this.getCellKey(entity.position.x, entity.position.y);
    const cell = this.grid.get(key) || [];
    cell.push(entity);
    this.grid.set(key, cell);
  }

  remove(entity: Entity): void {
    const key = this.getCellKey(entity.position.x, entity.position.y);
    const cell = this.grid.get(key);
    if (cell) {
      const idx = cell.indexOf(entity);
      if (idx >= 0) {
        cell.splice(idx, 1);
      }
    }
  }

  query(position: Vec2, radius: number): Entity[] {
    const results: Entity[] = [];
    const minX = position.x - radius;
    const maxX = position.x + radius;
    const minY = position.y - radius;
    const maxY = position.y + radius;

    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCy = Math.floor(minY / this.cellSize);
    const maxCy = Math.floor(maxY / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = `${cx},${cy}`;
        const cell = this.grid.get(key);
        if (cell) {
          results.push(...cell);
        }
      }
    }
    return results;
  }

  getPotentialCollisions(): Array<[Entity, Entity]> {
    const pairs: Array<[Entity, Entity]> = [];
    const checked = new Set<string>();

    for (const cell of this.grid.values()) {
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) {
          const a = cell[i];
          const b = cell[j];
          const key = a.id < b.id ? `${a.id},${b.id}` : `${b.id},${a.id}`;
          if (!checked.has(key)) {
            checked.add(key);
            if (a.collidesWith(b)) {
              pairs.push([a, b]);
            }
          }
        }
      }
    }
    return pairs;
  }
}
