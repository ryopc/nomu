/**
 * Player - The performer
 * Moves on beat, shoots on beat
 */

import type { EntityConfig } from './Entity';
import { Entity, EntityType, EntityLayer } from './Entity';
import { Bullet } from './Bullet';
import { Vec2 } from '../utils/Vec2';

export interface PlayerConfig extends EntityConfig {
  screenWidth: number;
  screenHeight: number;
  moveSpeed?: number; // Cells per beat
  shootCooldown?: number; // Beats between shots
}

export class Player extends Entity {
  // Screen bounds
  private screenWidth: number;
  private screenHeight: number;
  private minX: number;
  private maxX: number;
  private minY: number;
  private maxY: number;

  // Movement
  private moveSpeed: number;
  private targetX: number;
  private isMoving: boolean = false;
  private moveStartBeat: number = 0;

  // Shooting
  private shootCooldown: number;
  private lastShotBeat: number = -999;
  private canShoot: boolean = true;

  // Visual
  private baseChar: string;
  private shootChar: string;
  private shootFlashTimer: number = 0;

  // Input state (set by InputManager)
  inputLeft: boolean = false;
  inputRight: boolean = false;
  inputShoot: boolean = false;

  constructor(config: PlayerConfig) {
    super(EntityType.Player, {
      ...config,
      char: config.char || '▲',
      color: config.color || '\x1b[36m', // Cyan
      layer: EntityLayer.Player,
      size: config.size || new Vec2(0.5, 0.5),
    });

    this.screenWidth = config.screenWidth;
    this.screenHeight = config.screenHeight;
    this.moveSpeed = config.moveSpeed || 2; // cells per beat
    this.shootCooldown = config.shootCooldown || 1; // beats

    // Calculate bounds (leave 1 cell margin)
    this.minX = 1 + this.size.x;
    this.maxX = this.screenWidth - 1 - this.size.x;
    this.minY = this.screenHeight * 0.7;
    this.maxY = this.screenHeight - 2;

    // Clamp initial position
    this.position.x = Math.max(this.minX, Math.min(this.maxX, this.position.x));
    this.position.y = Math.max(this.minY, Math.min(this.maxY, this.position.y));
    this.targetX = this.position.x;

    this.baseChar = this.char;
    this.shootChar = '▼';
  }

  // Called by InputManager
  setInput(left: boolean, right: boolean, shoot: boolean): void {
    this.inputLeft = left;
    this.inputRight = right;
    this.inputShoot = shoot;
  }

  // Request movement (queued for next beat)
  requestMove(direction: -1 | 1): void {
    const newTargetX = this.targetX + direction * this.moveSpeed;
    this.targetX = Math.max(this.minX, Math.min(this.maxX, newTargetX));
    this.isMoving = true;
  }

  // Request shoot (queued for next beat if on cooldown)
  requestShoot(): boolean {
    return this.canShoot;
  }

  onBeat(beatNumber: number, bpm: number): void {
    super.onBeat(beatNumber, bpm);

    // Execute queued movement (snap to target on beat)
    if (this.isMoving) {
      this.position.x = this.targetX;
      this.isMoving = false;
    }

    // Update shoot cooldown
    this.canShoot = beatNumber - this.lastShotBeat >= this.shootCooldown;

    // Shoot flash timer
    if (this.shootFlashTimer > 0) {
      this.shootFlashTimer--;
      if (this.shootFlashTimer === 0) {
        this.char = this.baseChar;
      }
    }

    // Process input for THIS beat
    if (this.inputLeft && !this.inputRight) {
      this.requestMove(-1);
    } else if (this.inputRight && !this.inputLeft) {
      this.requestMove(1);
    }
    // Note: Shoot is handled by GameState on beat with timing check
  }

  onTick(dt: number, beatIntervalMs: number): void {
    super.onTick(dt, beatIntervalMs);

    // Smooth visual interpolation toward target
    if (this.isMoving) {
      // Visual position leads slightly
      this.position.x = this.lastBeatPosition.x + (this.targetX - this.lastBeatPosition.x) * dt;
    }
  }

  /**
   * Fire a bullet - returns bullet entity or null if on cooldown
   */
  shoot(beatNumber: number): { bullet: Bullet; timing: 'perfect' | 'great' | 'miss' } | null {
    if (!this.canShoot) {
      return null;
    }

    this.lastShotBeat = beatNumber;
    this.canShoot = false;
    this.shootFlashTimer = 1; // Flash for 1 beat
    this.char = this.shootChar;

    // Create bullet at player position
    const bulletPos = new Vec2(this.position.x, this.position.y - 1);

    return {
      bullet: new Bullet({
        position: bulletPos,
        speed: 2,
        damage: 1,
        char: '│',
        color: '\x1b[96m', // Bright cyan
        size: new Vec2(0.3, 0.5),
        lifetime: 20,
      }),
      timing: 'perfect', // Will be refined by GameState based on actual input timing
    };
  }

  getShootCooldownRemaining(currentBeat: number): number {
    return Math.max(0, this.shootCooldown - (currentBeat - this.lastShotBeat));
  }

  isAtTarget(): boolean {
    return !this.isMoving && Math.abs(this.position.x - this.targetX) < 0.1;
  }
}
