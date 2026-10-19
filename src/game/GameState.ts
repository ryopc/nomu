/**
 * GameState - Main game loop and state management
 * Orchestrates all systems: entities, audio, input, rendering, scoring
 */

import { EntityManager, EntityType, EntityLayer } from './Entity';
import { Player } from './Player';
import type { Bullet } from './Bullet';
import { BulletPool } from './Bullet';
import { Enemy, EnemyKind, EnemySpawner, WavePattern } from './Enemy';
import type { HitJudgment } from './Collision';
import { CollisionSystem } from './Collision';
import { ComboSystem } from './ComboSystem';
import type { HighScoreEntry } from './ScoreSystem';
import { ScoreSystem } from './ScoreSystem';
import { BeatClock, BeatInfo } from '../audio/BeatClock';
import { AudioEngine, AudioScheduler } from '../audio/AudioEngine';
import { Renderer, RendererConfig } from '../render/Renderer';
import { HUD, HUDConfig } from '../render/HUD';
import { EffectManager } from '../render/Effects';
import { InputManager } from '../input/InputManager';
import { Vec2 } from '../utils/Vec2';
import { Colors } from '../render/Buffer';

export enum GameMode {
  Menu = 'menu',
  Zen = 'zen',
  Groove = 'groove',
  Chaos = 'chaos',
}

export enum GameStateType {
  Menu = 'menu',
  Playing = 'playing',
  Paused = 'paused',
  GameOver = 'gameover',
}

export interface GameConfig {
  screenWidth: number;
  screenHeight: number;
  useTrueColor: boolean;
  targetFPS: number;
  mode: GameMode;
}

const DEFAULT_CONFIG: GameConfig = {
  screenWidth: 80,
  screenHeight: 24,
  useTrueColor: true,
  targetFPS: 60,
  mode: GameMode.Groove,
};

const MODE_CONFIGS: Record<GameMode, { baseBPM: number; enemySpeedMult: number; spawnRateMult: number }> = {
  [GameMode.Menu]: { baseBPM: 100, enemySpeedMult: 0.5, spawnRateMult: 0 },
  [GameMode.Zen]: { baseBPM: 100, enemySpeedMult: 0.7, spawnRateMult: 0.5 },
  [GameMode.Groove]: { baseBPM: 120, enemySpeedMult: 1.0, spawnRateMult: 1.0 },
  [GameMode.Chaos]: { baseBPM: 140, enemySpeedMult: 1.3, spawnRateMult: 1.5 },
};

export class GameState {
  private config: GameConfig;
  private state: GameStateType = GameStateType.Menu;
  private mode: GameMode;

  // Core systems
  private entityManager: EntityManager;
  private beatClock: BeatClock;
  private audioEngine: AudioEngine;
  private audioScheduler: AudioScheduler;
  private player: Player;
  private bulletPool: BulletPool;
  private enemySpawner: EnemySpawner;
  private collisionSystem: CollisionSystem;
  private comboSystem: ComboSystem;
  private scoreSystem: ScoreSystem;
  private renderer: Renderer;
  private hud: HUD;
  private effects: EffectManager;
  private inputManager: InputManager;

  // Game state
  private currentWave: string = 'intro';
  private waveSequence: string[] = ['intro', 'buildup', 'drop', 'break', 'boss'];
  private waveIndex: number = 0;
  private gameStartBeat: number = 0;
  private lastRenderOutput: string = '';
  private frameCount: number = 0;
  private isRunning: boolean = false;
  private lastFrameTime: number = 0;

  // Callbacks
  private onStateChangeCallbacks: Array<(state: GameStateType) => void> = [];
  private onGameOverCallbacks: Array<(score: HighScoreEntry) => void> = [];

  constructor(config: Partial<GameConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mode = this.config.mode;

    // Initialize systems
    this.entityManager = new EntityManager();
    this.beatClock = new BeatClock({
      initialBPM: MODE_CONFIGS[this.mode].baseBPM,
      minBPM: 60,
      maxBPM: 200,
      beatsPerMeasure: 4,
    });
    this.audioEngine = new AudioEngine({
      sampleRate: 44100,
      channels: 1,
      bufferSize: 1024,
    });
    this.audioScheduler = new AudioScheduler(this.beatClock, this.audioEngine);
    this.inputManager = new InputManager();

    // Audio setup
    this.audioEngine.init();
    this.audioEngine.preloadDefaults();
    this.setupAudioSchedule();

    // Player
    this.player = new Player({
      position: new Vec2(Math.floor(this.config.screenWidth / 2), this.config.screenHeight - 3),
      screenWidth: this.config.screenWidth,
      screenHeight: this.config.screenHeight,
      moveSpeed: 2,
      shootCooldown: 1,
    });
    this.entityManager.add(this.player);

    // Bullet pool
    this.bulletPool = new BulletPool(
      {
        position: new Vec2(0, 0),
        speed: 2,
        damage: 1,
        char: '│',
        color: '\x1b[96m',
        size: new Vec2(0.3, 0.5),
        lifetime: 20,
      },
      100
    );

    // Enemy spawner
    this.enemySpawner = new EnemySpawner(this.entityManager, this.config.screenWidth, this.config.screenHeight);
    this.enemySpawner.setLevel(1);

    // Systems
    this.collisionSystem = new CollisionSystem(this.entityManager);
    this.comboSystem = new ComboSystem(this.beatClock, this.audioScheduler, {
      baseBPM: MODE_CONFIGS[this.mode].baseBPM,
      minBPM: 60,
      maxBPM: 200,
      bpmPerComboTier: 10,
      combosPerTier: 10,
      missBPMPenalty: 5,
      transitionBeats: 4,
    });
    this.scoreSystem = new ScoreSystem();

    // Rendering
    this.renderer = new Renderer({
      width: this.config.screenWidth,
      height: this.config.screenHeight,
      useTrueColor: this.config.useTrueColor,
      useAltScreen: true,
      targetFPS: this.config.targetFPS,
    });
    this.hud = new HUD({
      width: this.config.screenWidth,
      height: this.config.screenHeight,
      showFPS: false,
      showDebug: false,
    });
    this.effects = new EffectManager(500);

    // Setup callbacks
    this.setupCallbacks();
  }

  private setupAudioSchedule(): void {
    // Schedule recurring beat sounds
    this.audioScheduler.scheduleRecurring('kick', 1, 1.0, 0); // Every beat
    this.audioScheduler.scheduleRecurring('snare', 2, 0.5, 1); // Beats 2 and 4 (backbeat)
    this.audioScheduler.scheduleRecurring('hihat', 0.5, 0.3, 0); // Eighth notes (every half beat)
  }

  private setupCallbacks(): void {
    // Collision callbacks
    this.collisionSystem.onHit((result, judgment) => {
      this.onHit(result, judgment);
    });
    this.collisionSystem.onMiss(bullet => {
      this.onBulletMiss(bullet);
    });

    // Combo callbacks
    this.comboSystem.onComboChange(combo => {
      this.onComboChange(combo);
    });
    this.comboSystem.onTierChange((tier, newBPM) => {
      this.onTierChange(tier, newBPM);
    });
    this.comboSystem.onJudgment((judgment, combo) => {
      this.scoreSystem.onJudgment(judgment);
    });
  }

  /**
   * Start the game
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.state = GameStateType.Playing;
    this.gameStartBeat = this.beatClock.getBeatNumber();
    this.scoreSystem.startGame();
    this.waveIndex = 0;
    this.currentWave = this.waveSequence[0];
    this.enemySpawner.startWave(this.currentWave, this.beatClock.getBeatNumber());

    // Start audio and clock
    this.beatClock.start();

    // Start render loop
    this.lastFrameTime = performance.now();
    this.gameLoop();
  }

  /**
   * Main game loop
   */
  private gameLoop = (): void => {
    if (!this.isRunning) {
      return;
    }

    const now = performance.now();
    const frameTime = now - this.lastFrameTime;
    const targetFrameTime = 1000 / this.config.targetFPS;

    // Process input
    this.inputManager.update();
    this.handleInput();

    // Update game logic at fixed timestep (beat-synchronized)
    this.update(frameTime);

    // Render
    const output = this.render();
    this.lastRenderOutput = output;

    // Output to terminal
    process.stdout.write(output);

    this.lastFrameTime = now;
    this.frameCount++;

    // Schedule next frame
    const elapsed = performance.now() - now;
    const delay = Math.max(0, targetFrameTime - elapsed);
    setTimeout(this.gameLoop, delay);
  };

  /**
   * Handle keyboard input
   */
  private handleInput(): void {
    // Global controls
    if (this.inputManager.isPausePressed()) {
      if (this.state === GameStateType.Playing) {
        this.pause();
      } else if (this.state === GameStateType.Paused) {
        this.resume();
      }
      return;
    }

    if (this.inputManager.isRestartPressed()) {
      if (this.state === GameStateType.GameOver || this.state === GameStateType.Paused) {
        this.restart();
      }
      return;
    }

    // State-specific input
    switch (this.state) {
      case GameStateType.Menu:
        this.handleMenuInput();
        break;
      case GameStateType.Playing:
        this.handlePlayingInput();
        break;
      case GameStateType.GameOver:
        // Only restart/quit handled above
        break;
    }
  }

  private handleMenuInput(): void {
    if (this.inputManager.isJustPressed('1')) {
      this.setMode(GameMode.Zen);
      this.start();
    } else if (this.inputManager.isJustPressed('2')) {
      this.setMode(GameMode.Groove);
      this.start();
    } else if (this.inputManager.isJustPressed('3')) {
      this.setMode(GameMode.Chaos);
      this.start();
    }
  }

  private handlePlayingInput(): void {
    // Movement - queued for next beat
    const move = this.inputManager.getMovementVector();
    if (move.x < 0) {
      this.player.setInput(true, false, false);
    } else if (move.x > 0) {
      this.player.setInput(false, true, false);
    } else {
      this.player.setInput(false, false, false);
    }

    // Shoot - checked on beat with timing
    if (this.inputManager.isShootPressed()) {
      this.player.setInput(
        this.inputManager.isPressed('ArrowLeft') || this.inputManager.isPressed('a'),
        this.inputManager.isPressed('ArrowRight') || this.inputManager.isPressed('d'),
        true
      );
    }
  }

  /**
   * Update game logic
   */
  private update(frameTime: number): void {
    if (this.state !== GameStateType.Playing) {
      return;
    }

    const beatNumber = this.beatClock.getBeatNumber();
    const bpm = this.beatClock.getBPM();
    const beatIntervalMs = 60000 / bpm;
    const timeSinceBeat = this.beatClock.getTimeUntilNextBeat();
    const timeSinceLastBeat = beatIntervalMs - timeSinceBeat;
    const beatProgress = timeSinceLastBeat / beatIntervalMs;

    // Update enemy spawner (wave management)
    this.enemySpawner.update(beatNumber);

    // Beat-synchronized updates
    this.checkBeatTransition(beatNumber);

    // Entity updates (per beat)
    this.entityManager.update(beatNumber, bpm);

    // Sub-beat interpolation updates
    this.entityManager.tick(beatProgress, beatIntervalMs);
    this.player.onTick(beatProgress, beatIntervalMs);
    this.bulletPool.tick(beatProgress, beatIntervalMs);

    // Bullet pool beat update
    this.bulletPool.update(beatNumber, bpm);

    // Collision detection
    this.collisionSystem.process(beatNumber, beatIntervalMs, timeSinceLastBeat);

    // Player-enemy collision (game over)
    const hitEnemy = this.collisionSystem.checkPlayerCollision(this.player);
    if (hitEnemy) {
      this.gameOver();
      return;
    }

    // Score survival bonus
    this.scoreSystem.onBeat();

    // Check wave progression
    this.checkWaveProgression(beatNumber);

    // Update effects
    this.effects.update();

    // Update beat clock (handled by its own timer)
  }

  private checkBeatTransition(beatNumber: number): void {
    // This is called every frame, but we only process beat events once per beat
    // The BeatClock calls its callbacks internally
  }

  private checkWaveProgression(beatNumber: number): void {
    const currentWave = this.enemySpawner.getCurrentWave();
    if (!currentWave && this.waveIndex < this.waveSequence.length - 1) {
      // Wave complete, start next
      this.waveIndex++;
      this.currentWave = this.waveSequence[this.waveIndex];
      this.enemySpawner.startWave(this.currentWave, beatNumber);

      // Special handling for boss wave
      if (this.currentWave === 'boss') {
        this.audioScheduler.clear();
        this.setupBossAudio();
      }
    }
  }

  private setupBossAudio(): void {
    // More intense audio for boss
    this.audioScheduler.scheduleRecurring('kick', 1, 1.2, 0);
    this.audioScheduler.scheduleRecurring('snare', 1, 0.8, 0); // Every beat
    this.audioScheduler.scheduleRecurring('hihat', 0.5, 0.4, 0);
  }

  /**
   * Render current frame
   */
  private render(): string {
    const beatInfo = {
      beatNumber: this.beatClock.getBeatNumber(),
      measureNumber: this.beatClock.getMeasureNumber(),
      beatInMeasure: this.beatClock.getBeatInMeasure(),
      timestamp: this.beatClock.getNextBeatTime() - 60000 / this.beatClock.getBPM(),
      bpm: this.beatClock.getBPM(),
      intervalMs: 60000 / this.beatClock.getBPM(),
    };

    // Render main scene
    const output = this.renderer.render(
      this.entityManager,
      this.player,
      this.beatClock,
      this.comboSystem,
      this.scoreSystem.getCurrentScore(),
      this.state,
      beatInfo
    );

    // Render effects on top
    const back = this.renderer.getBuffer().draw();
    this.effects.render(back);

    // Render HUD
    this.hud.render(back, this.player, this.beatClock, this.comboSystem, this.scoreSystem.getCurrentScore(), beatInfo);

    // Swap and return
    return this.renderer.getBuffer().swap();
  }

  // Event handlers
  private onHit(result: any, judgment: HitJudgment): void {
    const { bullet, enemy, position } = result;

    // Score
    this.scoreSystem.onEnemyKilled(enemy.getScoreValue(), this.comboSystem, judgment);

    // Effects
    this.effects.hitEffect(position, judgment.timing);
    this.hud.showJudgment(judgment.timing, position);

    // Audio feedback
    switch (judgment.timing) {
      case 'perfect':
        this.audioScheduler.scheduleOnBeat(0, 'pluck', 0.8);
        break;
      case 'great':
        this.audioScheduler.scheduleOnBeat(0, 'pluck', 0.5);
        break;
    }

    // Enemy death effects
    if (enemy.isDyingState()) {
      this.effects.enemyDestroyed(position, enemy.getKind());
      this.audioScheduler.scheduleOnBeat(0, 'destroy', 0.7);
    }
  }

  private onBulletMiss(bullet: Bullet): void {
    // Bullet reached top without hitting - could trigger miss judgment
    // For now, just destroy it (already done in collision system)
  }

  private onComboChange(combo: number): void {
    // Visual feedback at milestones
    if (combo > 0 && combo % 10 === 0) {
      const playerPos = this.player.getRenderPosition();
      this.effects.comboMilestone(combo, playerPos);
    }
  }

  private onTierChange(tier: number, newBPM: number): void {
    // Visual/audio feedback for tier change
    const playerPos = this.player.getRenderPosition();
    this.effects.comboMilestone(tier * 10, playerPos);
  }

  // Public API
  pause(): void {
    if (this.state === GameStateType.Playing) {
      this.state = GameStateType.Paused;
      this.beatClock.stop();
      this.notifyStateChange();
    }
  }

  resume(): void {
    if (this.state === GameStateType.Paused) {
      this.state = GameStateType.Playing;
      this.beatClock.start();
      this.notifyStateChange();
    }
  }

  restart(): void {
    this.stop();
    this.reset();
    this.start();
  }

  stop(): void {
    this.isRunning = false;
    this.beatClock.stop();
    this.audioEngine.destroy();
    this.inputManager.destroy();
    process.stdout.write(this.renderer.shutdown());
  }

  private reset(): void {
    // Clear entities
    this.entityManager.clear();

    // Reset player
    this.player = new Player({
      position: new Vec2(Math.floor(this.config.screenWidth / 2), this.config.screenHeight - 3),
      screenWidth: this.config.screenWidth,
      screenHeight: this.config.screenHeight,
      moveSpeed: 2,
      shootCooldown: 1,
    });
    this.entityManager.add(this.player);

    // Reset bullet pool
    this.bulletPool.clear();

    // Reset systems
    this.enemySpawner = new EnemySpawner(this.entityManager, this.config.screenWidth, this.config.screenHeight);
    this.enemySpawner.setLevel(1);
    this.collisionSystem = new CollisionSystem(this.entityManager);
    this.comboSystem = new ComboSystem(this.beatClock, this.audioScheduler, {
      baseBPM: MODE_CONFIGS[this.mode].baseBPM,
      minBPM: 60,
      maxBPM: 200,
      bpmPerComboTier: 10,
      combosPerTier: 10,
      missBPMPenalty: 5,
      transitionBeats: 4,
    });
    this.scoreSystem = new ScoreSystem();
    this.effects.clear();

    // Re-setup callbacks
    this.setupCallbacks();
    this.setupAudioSchedule();

    // Reset wave
    this.waveIndex = 0;
    this.currentWave = this.waveSequence[0];
  }

  private gameOver(): void {
    this.state = GameStateType.GameOver;
    this.beatClock.stop();

    const finalScore = this.scoreSystem.endGame(this.mode);
    this.notifyGameOver(finalScore);
    this.notifyStateChange();
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
    this.config.mode = mode;
    // Will apply on next restart
  }

  getState(): GameStateType {
    return this.state;
  }
  getMode(): GameMode {
    return this.mode;
  }
  getScore(): number {
    return this.scoreSystem.getCurrentScore();
  }
  getCombo(): number {
    return this.comboSystem.getCombo();
  }
  getBPM(): number {
    return this.beatClock.getBPM();
  }
  getHighScores(): HighScoreEntry[] {
    return this.scoreSystem.getHighScores();
  }

  onStateChange(callback: (state: GameStateType) => void): () => void {
    this.onStateChangeCallbacks.push(callback);
    return () => {
      const idx = this.onStateChangeCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.onStateChangeCallbacks.splice(idx, 1);
      }
    };
  }

  onGameOver(callback: (score: HighScoreEntry) => void): () => void {
    this.onGameOverCallbacks.push(callback);
    return () => {
      const idx = this.onGameOverCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.onGameOverCallbacks.splice(idx, 1);
      }
    };
  }

  private notifyStateChange(): void {
    this.onStateChangeCallbacks.forEach(cb => cb(this.state));
  }

  private notifyGameOver(score: HighScoreEntry): void {
    this.onGameOverCallbacks.forEach(cb => cb(score));
  }

  // For menu rendering
  renderMenu(): string {
    const back = this.renderer.getBuffer().draw();
    back.clear(' ', Colors.UI_TEXT, Colors.BG_DARK);
    return this.renderer.render(
      this.entityManager,
      this.player,
      this.beatClock,
      this.comboSystem,
      0,
      GameStateType.Menu
    );
  }

  // Cleanup
  destroy(): void {
    this.stop();
  }
}
