/**
 * Enemy - Various enemy types with rhythmic movement patterns
 */

import { Entity, EntityType, EntityLayer } from './Entity';
import { Vec2 } from '../utils/Vec2';
import { Random, rand } from '../utils/Random';

export enum EnemyKind {
  Basic = 'basic',           // Straight down
  Zigzag = 'zigzag',         // Side to side on beat
  Rhythmic = 'rhythmic',     // Moves only on beat, predictable
  Charger = 'charger',       // Fast, aims at player
  Splitter = 'splitter',     // Splits on hit
  Boss = 'boss',             // Multi-phase, complex patterns
}

export interface EnemyConfig {
  kind: EnemyKind;
  position: Vec2;
  hp?: number;
  scoreValue?: number;
  speed?: number;           // Cells per beat
  color?: string;
  char?: string;
  size?: Vec2;
  patternConfig?: any;      // Kind-specific config
}

export class Enemy extends Entity {
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  scoreValue: number;
  speed: number;
  
  // Movement pattern
  private patternType: string = 'straight';
  private patternTimer: number = 0;
  private patternData: any = {};
  private baseX: number = 0;
  
  // Visual
  private baseChar: string;
  private baseColor: string;
  private hitFlashTimer: number = 0;
  private isDying: boolean = false;
  private deathTimer: number = 0;

  // Screen bounds
  private screenBottom: number;
  private screenLeft: number;
  private screenRight: number;

  constructor(config: EnemyConfig) {
    super(EntityType.Enemy, {
      position: config.position,
      char: config.char || '○',
      color: config.color || '\x1b[31m', // Red
      layer: EntityLayer.Enemy,
      size: config.size || new Vec2(0.6, 0.6),
      lifetime: 0, // Enemies don't auto-expire by time
    });

    this.kind = config.kind;
    this.hp = config.hp || 1;
    this.maxHp = this.hp;
    this.scoreValue = config.scoreValue || 100;
    this.speed = config.speed || 1;
    this.baseChar = this.char;
    this.baseColor = this.color;
    this.baseX = config.position.x;

    // Default screen bounds
    this.screenBottom = 24;
    this.screenLeft = 1;
    this.screenRight = 79;

    // Initialize pattern based on kind
    this.initPattern(config.patternConfig || {});
  }

  private initPattern(patternConfig: any): void {
    switch (this.kind) {
      case EnemyKind.Basic:
        this.patternType = 'straight';
        break;
      case EnemyKind.Zigzag:
        this.patternType = 'zigzag';
        this.patternData.amplitude = patternConfig.amplitude || 3;
        this.patternData.frequency = patternConfig.frequency || 1; // beats per cycle
        this.patternData.phase = patternConfig.phase || 0;
        break;
      case EnemyKind.Rhythmic:
        this.patternType = 'rhythmic';
        this.patternData.moveBeats = patternConfig.moveBeats || [0, 2]; // beats in measure to move
        this.patternData.moveDistance = patternConfig.moveDistance || 2;
        this.patternData.direction = patternConfig.direction || (rand.bool() ? 1 : -1);
        break;
      case EnemyKind.Charger:
        this.patternType = 'charger';
        this.patternData.chargeInterval = patternConfig.chargeInterval || 4;
        this.patternData.chargeSpeed = patternConfig.chargeSpeed || 3;
        this.patternData.targetX = this.baseX;
        break;
      case EnemyKind.Splitter:
        this.patternType = 'splitter';
        this.patternData.splitCount = patternConfig.splitCount || 2;
        this.patternData.splitKind = patternConfig.splitKind || EnemyKind.Basic;
        break;
      case EnemyKind.Boss:
        this.patternType = 'boss';
        this.patternData.phase = 0;
        this.patternData.phaseTimer = 0;
        this.patternData.phases = patternConfig.phases || [];
        break;
    }
  }

  setScreenBounds(left: number, right: number, bottom: number): void {
    this.screenLeft = left;
    this.screenRight = right;
    this.screenBottom = bottom;
  }

  takeDamage(amount: number): boolean {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.startDeath();
      return true; // Killed
    }
    // Hit flash
    this.hitFlashTimer = 1;
    this.char = '◆';
    this.color = '\x1b[93m'; // Yellow
    return false;
  }

  private startDeath(): void {
    this.isDying = true;
    this.deathTimer = 4; // 4 beats death animation
    this.velocity = Vec2.zero();
    this.char = '*';
    this.color = '\x1b[91m'; // Bright red
  }

  onBeat(beatNumber: number, bpm: number): void {
    super.onBeat(beatNumber, bpm);

    if (this.isDying) {
      this.deathTimer--;
      // Death animation
      const chars = ['*', '×', '+', '·'];
      this.char = chars[Math.min(this.deathTimer, chars.length - 1)];
      if (this.deathTimer <= 0) {
        this.destroy();
      }
      return;
    }

    // Hit flash recovery
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer--;
      if (this.hitFlashTimer === 0) {
        this.char = this.baseChar;
        this.color = this.baseColor;
      }
    }

    // Execute movement pattern
    this.executePattern(beatNumber);

    // Check bottom bounds
    if (this.position.y >= this.screenBottom - this.size.y) {
      this.destroy(); // Reached bottom - handled as "miss" by GameState
    }
  }

  private executePattern(beatNumber: number): void {
    const measureBeat = beatNumber % 4; // 4/4 time
    
    switch (this.patternType) {
      case 'straight':
        this.position.y += this.speed;
        break;

      case 'zigzag':
        // Sinusoidal horizontal movement
        const cycle = (beatNumber + this.patternData.phase) / this.patternData.frequency;
        const targetX = this.baseX + Math.sin(cycle * Math.PI * 2) * this.patternData.amplitude;
        this.position.x = targetX;
        this.position.y += this.speed;
        // Clamp to screen
        this.position.x = Math.max(this.screenLeft + this.size.x, 
          Math.min(this.screenRight - this.size.x, this.position.x));
        break;

      case 'rhythmic':
        // Move only on specific beats
        if (this.patternData.moveBeats.includes(measureBeat)) {
          this.position.x += this.patternData.direction * this.patternData.moveDistance;
          // Bounce at edges
          if (this.position.x <= this.screenLeft + this.size.x) {
            this.position.x = this.screenLeft + this.size.x;
            this.patternData.direction = 1;
          } else if (this.position.x >= this.screenRight - this.size.x) {
            this.position.x = this.screenRight - this.size.x;
            this.patternData.direction = -1;
          }
        }
        this.position.y += this.speed;
        break;

      case 'charger':
        // Periodically charge toward player's X position
        if (beatNumber % this.patternData.chargeInterval === 0) {
          this.patternData.targetX = this.baseX; // Would be set by GameState to player X
        }
        // Smooth move toward target
        const dx = this.patternData.targetX - this.position.x;
        if (Math.abs(dx) > 0.5) {
          this.position.x += Math.sign(dx) * Math.min(Math.abs(dx), this.patternData.chargeSpeed);
        }
        this.position.y += this.speed;
        break;

      case 'boss':
        this.executeBossPattern(beatNumber);
        break;
    }
  }

  private executeBossPattern(beatNumber: number): void {
    const phase = this.patternData.phase;
    const phases = this.patternData.phases;
    
    if (phases.length === 0) {
      // Default boss behavior
      this.position.y += this.speed * 0.5;
      return;
    }

    const currentPhase = phases[phase];
    this.patternData.phaseTimer++;

    if (currentPhase.duration && this.patternData.phaseTimer >= currentPhase.duration) {
      this.patternData.phase = (phase + 1) % phases.length;
      this.patternData.phaseTimer = 0;
    }

    // Execute current phase pattern
    // Phases can define: pattern, speed, spawnMinions, etc.
    if (currentPhase.pattern) {
      // Delegate to pattern logic
      this.executePatternByName(currentPhase.pattern, beatNumber);
    }
  }

  private executePatternByName(patternName: string, beatNumber: number): void {
    // Simplified - would be expanded for real boss patterns
    switch (patternName) {
      case 'spread':
        // Would spawn bullets - handled by GameState
        break;
      case 'charge':
        this.position.y += this.speed * 2;
        break;
      case 'retreat':
        this.position.y -= this.speed;
        break;
    }
  }

  onTick(dt: number, beatIntervalMs: number): void {
    super.onTick(dt, beatIntervalMs);
    // Position interpolated automatically
  }

  getScoreValue(): number {
    return this.scoreValue;
  }

  getKind(): EnemyKind {
    return this.kind;
  }

  isDyingState(): boolean {
    return this.isDying;
  }

  // Factory methods for common enemy types
  static createBasic(position: Vec2, level: number = 1): Enemy {
    return new Enemy({
      kind: EnemyKind.Basic,
      position,
      hp: 1,
      scoreValue: 100 * level,
      speed: 1,
      char: '○',
      color: '\x1b[31m',
    });
  }

  static createZigzag(position: Vec2, level: number = 1): Enemy {
    return new Enemy({
      kind: EnemyKind.Zigzag,
      position,
      hp: 1,
      scoreValue: 150 * level,
      speed: 1,
      char: '◆',
      color: '\x1b[35m', // Magenta
      patternConfig: {
        amplitude: 4,
        frequency: 2,
        phase: rand.float() * 4,
      },
    });
  }

  static createRhythmic(position: Vec2, level: number = 1): Enemy {
    return new Enemy({
      kind: EnemyKind.Rhythmic,
      position,
      hp: 2,
      scoreValue: 200 * level,
      speed: 1,
      char: '♪',
      color: '\x1b[33m', // Yellow
      patternConfig: {
        moveBeats: [0, 2],
        moveDistance: 3,
        direction: rand.bool() ? 1 : -1,
      },
    });
  }

  static createCharger(position: Vec2, level: number = 1): Enemy {
    return new Enemy({
      kind: EnemyKind.Charger,
      position,
      hp: 3,
      scoreValue: 300 * level,
      speed: 1,
      char: '▶',
      color: '\x1b[91m', // Bright red
      patternConfig: {
        chargeInterval: 4,
        chargeSpeed: 4,
      },
    });
  }

  static createSplitter(position: Vec2, level: number = 1): Enemy {
    return new Enemy({
      kind: EnemyKind.Splitter,
      position,
      hp: 2,
      scoreValue: 250 * level,
      speed: 1,
      char: '⬢',
      color: '\x1b[36m', // Cyan
      patternConfig: {
        splitCount: 2,
        splitKind: EnemyKind.Basic,
      },
    });
  }

  static createBoss(position: Vec2, level: number = 1): Enemy {
    const boss = new Enemy({
      kind: EnemyKind.Boss,
      position,
      hp: 20 * level,
      scoreValue: 5000 * level,
      speed: 0.5,
      char: '☠',
      color: '\x1b[95m', // Bright magenta
      size: new Vec2(1.5, 1.0),
      patternConfig: {
        phases: [
          { pattern: 'spread', duration: 16 },
          { pattern: 'charge', duration: 8 },
          { pattern: 'retreat', duration: 8 },
        ],
      },
    });
    return boss;
  }
}

/**
 * EnemySpawner - Handles wave-based enemy spawning
 */
export interface WaveConfig {
  beat: number;           // Beat number to spawn (relative to wave start)
  kind: EnemyKind;
  count: number;
  positions: Vec2[];      // Spawn positions
  level?: number;
  delay?: number;         // Additional delay in beats
}

export interface WavePattern {
  name: string;
  duration: number;       // Beats
  spawns: WaveConfig[];
}

export class EnemySpawner {
  private wavePatterns: Map<string, WavePattern> = new Map();
  private currentWave: string | null = null;
  private waveStartBeat: number = 0;
  private nextSpawnIndex: number = 0;
  private entityManager: any; // EntityManager - avoid circular import
  private screenWidth: number;
  private screenHeight: number;
  private level: number = 1;

  constructor(entityManager: any, screenWidth: number, screenHeight: number) {
    this.entityManager = entityManager;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
    this.registerDefaultPatterns();
  }

  private registerDefaultPatterns(): void {
    // Intro wave - simple basics
    this.wavePatterns.set('intro', {
      name: 'intro',
      duration: 32, // 8 measures
      spawns: [
        { beat: 4, kind: EnemyKind.Basic, count: 1, positions: [new Vec2(20, 2)] },
        { beat: 8, kind: EnemyKind.Basic, count: 2, positions: [new Vec2(15, 2), new Vec2(25, 2)] },
        { beat: 12, kind: EnemyKind.Basic, count: 3, positions: [new Vec2(10, 2), new Vec2(20, 2), new Vec2(30, 2)] },
        { beat: 16, kind: EnemyKind.Zigzag, count: 1, positions: [new Vec2(40, 2)] },
        { beat: 20, kind: EnemyKind.Basic, count: 2, positions: [new Vec2(12, 2), new Vec2(28, 2)] },
        { beat: 24, kind: EnemyKind.Rhythmic, count: 1, positions: [new Vec2(35, 2)] },
        { beat: 28, kind: EnemyKind.Basic, count: 4, positions: [new Vec2(8, 2), new Vec2(18, 2), new Vec2(28, 2), new Vec2(38, 2)] },
      ],
    });

    // Build-up wave - more density, new types
    this.wavePatterns.set('buildup', {
      name: 'buildup',
      duration: 32,
      spawns: [
        { beat: 2, kind: EnemyKind.Basic, count: 3, positions: [new Vec2(10, 2), new Vec2(20, 2), new Vec2(30, 2)] },
        { beat: 4, kind: EnemyKind.Zigzag, count: 2, positions: [new Vec2(15, 2), new Vec2(25, 2)] },
        { beat: 6, kind: EnemyKind.Rhythmic, count: 2, positions: [new Vec2(12, 2), new Vec2(28, 2)] },
        { beat: 8, kind: EnemyKind.Charger, count: 1, positions: [new Vec2(20, 2)] },
        { beat: 10, kind: EnemyKind.Basic, count: 4, positions: [new Vec2(8, 2), new Vec2(16, 2), new Vec2(24, 2), new Vec2(32, 2)] },
        { beat: 14, kind: EnemyKind.Splitter, count: 1, positions: [new Vec2(20, 2)] },
        { beat: 18, kind: EnemyKind.Zigzag, count: 3, positions: [new Vec2(10, 2), new Vec2(20, 2), new Vec2(30, 2)] },
        { beat: 22, kind: EnemyKind.Charger, count: 2, positions: [new Vec2(15, 2), new Vec2(25, 2)] },
        { beat: 26, kind: EnemyKind.Rhythmic, count: 3, positions: [new Vec2(10, 2), new Vec2(20, 2), new Vec2(30, 2)] },
        { beat: 30, kind: EnemyKind.Basic, count: 5, positions: [new Vec2(6, 2), new Vec2(14, 2), new Vec2(22, 2), new Vec2(30, 2), new Vec2(38, 2)] },
      ],
    });

    // Drop wave - maximum intensity
    this.wavePatterns.set('drop', {
      name: 'drop',
      duration: 64,
      spawns: [
        { beat: 0, kind: EnemyKind.Basic, count: 5, positions: [new Vec2(8, 2), new Vec2(16, 2), new Vec2(24, 2), new Vec2(32, 2), new Vec2(40, 2)] },
        { beat: 2, kind: EnemyKind.Zigzag, count: 3, positions: [new Vec2(12, 2), new Vec2(24, 2), new Vec2(36, 2)] },
        { beat: 4, kind: EnemyKind.Rhythmic, count: 3, positions: [new Vec2(10, 2), new Vec2(22, 2), new Vec2(34, 2)] },
        { beat: 6, kind: EnemyKind.Charger, count: 2, positions: [new Vec2(18, 2), new Vec2(30, 2)] },
        { beat: 8, kind: EnemyKind.Splitter, count: 2, positions: [new Vec2(15, 2), new Vec2(25, 2)] },
        { beat: 10, kind: EnemyKind.Basic, count: 6, positions: [new Vec2(6, 2), new Vec2(13, 2), new Vec2(20, 2), new Vec2(27, 2), new Vec2(34, 2), new Vec2(41, 2)] },
        // Repeat with variations...
      ],
    });

    // Boss wave
    this.wavePatterns.set('boss', {
      name: 'boss',
      duration: 128,
      spawns: [
        { beat: 4, kind: EnemyKind.Boss, count: 1, positions: [new Vec2(25, 3)] },
        // Minions during boss fight
        { beat: 16, kind: EnemyKind.Basic, count: 2, positions: [new Vec2(10, 2), new Vec2(40, 2)] },
        { beat: 32, kind: EnemyKind.Zigzag, count: 2, positions: [new Vec2(15, 2), new Vec2(35, 2)] },
        { beat: 48, kind: EnemyKind.Rhythmic, count: 2, positions: [new Vec2(12, 2), new Vec2(38, 2)] },
        { beat: 64, kind: EnemyKind.Charger, count: 2, positions: [new Vec2(15, 2), new Vec2(35, 2)] },
        { beat: 80, kind: EnemyKind.Splitter, count: 2, positions: [new Vec2(10, 2), new Vec2(40, 2)] },
        { beat: 96, kind: EnemyKind.Basic, count: 4, positions: [new Vec2(8, 2), new Vec2(18, 2), new Vec2(32, 2), new Vec2(42, 2)] },
      ],
    });
  }

  setEntityManager(em: any): void {
    this.entityManager = em;
  }

  startWave(waveName: string, currentBeat: number): void {
    const wave = this.wavePatterns.get(waveName);
    if (!wave) {
      console.warn(`Wave pattern not found: ${waveName}`);
      return;
    }
    this.currentWave = waveName;
    this.waveStartBeat = currentBeat;
    this.nextSpawnIndex = 0;
    // Sort spawns by beat
    wave.spawns.sort((a, b) => a.beat - b.beat);
  }

  update(currentBeat: number): void {
    if (!this.currentWave) return;
    
    const wave = this.wavePatterns.get(this.currentWave)!;
    const relativeBeat = currentBeat - this.waveStartBeat;

    // Spawn enemies
    while (this.nextSpawnIndex < wave.spawns.length) {
      const spawn = wave.spawns[this.nextSpawnIndex];
      if (spawn.beat <= relativeBeat) {
        this.executeSpawn(spawn);
        this.nextSpawnIndex++;
      } else {
        break;
      }
    }

    // Check wave complete
    if (relativeBeat >= wave.duration) {
      this.currentWave = null;
    }
  }

  private executeSpawn(spawn: WaveConfig): void {
    for (let i = 0; i < spawn.count; i++) {
      const pos = spawn.positions[i % spawn.positions.length].clone();
      // Add some variance
      pos.x += rand.floatRange(-0.5, 0.5);
      
      let enemy: Enemy;
      switch (spawn.kind) {
        case EnemyKind.Basic:
          enemy = Enemy.createBasic(pos, this.level);
          break;
        case EnemyKind.Zigzag:
          enemy = Enemy.createZigzag(pos, this.level);
          break;
        case EnemyKind.Rhythmic:
          enemy = Enemy.createRhythmic(pos, this.level);
          break;
        case EnemyKind.Charger:
          enemy = Enemy.createCharger(pos, this.level);
          break;
        case EnemyKind.Splitter:
          enemy = Enemy.createSplitter(pos, this.level);
          break;
        case EnemyKind.Boss:
          enemy = Enemy.createBoss(pos, this.level);
          break;
        default:
          enemy = Enemy.createBasic(pos, this.level);
      }

      enemy.setScreenBounds(1, this.screenWidth - 1, this.screenHeight);
      this.entityManager.add(enemy);
    }
  }

  setLevel(level: number): void {
    this.level = level;
  }

  getCurrentWave(): string | null {
    return this.currentWave;
  }

  getWaveProgress(): number {
    if (!this.currentWave) return 0;
    const wave = this.wavePatterns.get(this.currentWave)!;
    return this.nextSpawnIndex / wave.spawns.length;
  }
}