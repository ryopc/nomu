/**
 * Renderer - High-level rendering orchestration
 * Manages double buffer, entity rendering, HUD, effects
 */

import type { Buffer } from './Buffer';
import { DoubleBuffer, Colors, Cell, rgb } from './Buffer';
import type { Entity, EntityManager } from '../game/Entity';
import { EntityType, EntityLayer } from '../game/Entity';
import type { Player } from '../game/Player';
import { Bullet } from '../game/Bullet';
import { Enemy, EnemyKind } from '../game/Enemy';
import type { Vec2 } from '../utils/Vec2';
import type { BeatClock, BeatInfo } from '../audio/BeatClock';
import type { ComboSystem } from '../game/ComboSystem';

export interface RendererConfig {
  width: number;
  height: number;
  useTrueColor?: boolean;
  useAltScreen?: boolean;
  targetFPS?: number;
}

export class Renderer {
  private buffer: DoubleBuffer;
  private config: Required<RendererConfig>;
  private frameCount: number = 0;
  private lastFrameTime: number = 0;
  private fps: number = 0;

  // Render layers (z-order)
  private renderOrder: EntityLayer[] = [
    EntityLayer.Background,
    EntityLayer.Enemy,
    EntityLayer.Bullet,
    EntityLayer.Player,
    EntityLayer.Effect,
    EntityLayer.UI,
  ];

  constructor(config: RendererConfig) {
    this.config = {
      width: config.width,
      height: config.height,
      useTrueColor: config.useTrueColor ?? true,
      useAltScreen: config.useAltScreen ?? true,
      targetFPS: config.targetFPS ?? 60,
    };
    this.buffer = new DoubleBuffer({
      width: this.config.width,
      height: this.config.height,
      useTrueColor: this.config.useTrueColor,
      useAltScreen: this.config.useAltScreen,
    });
  }

  initialize(): string {
    return this.buffer.getBack().enterAltScreen();
  }

  shutdown(): string {
    return this.buffer.getBack().exitAltScreen();
  }

  /**
   * Main render function - call once per frame
   */
  render(
    entityManager: EntityManager,
    player: Player,
    beatClock: BeatClock,
    comboSystem: ComboSystem,
    score: number,
    gameState: 'playing' | 'paused' | 'gameover' | 'menu',
    beatInfo?: BeatInfo
  ): string {
    const back = this.buffer.draw();
    const now = performance.now();

    // Calculate FPS
    this.frameCount++;
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }

    // Clear with dark background
    back.clear(' ', Colors.UI_TEXT, Colors.BG_DARK);

    // Render entities by layer
    this.renderEntities(back, entityManager, beatClock);

    // Render HUD
    this.renderHUD(back, player, beatClock, comboSystem, score, beatInfo);

    // Render game state overlays
    this.renderGameState(back, gameState, score, comboSystem.getMaxCombo());

    // Swap buffers and get output
    return this.buffer.swap();
  }

  private renderEntities(back: Buffer, entityManager: EntityManager, beatClock: BeatClock): void {
    const beatProgress = 1 - beatClock.getTimeUntilNextBeat() / (60000 / beatClock.getBPM());

    for (const layer of this.renderOrder) {
      if (layer === EntityLayer.UI) {
        continue;
      } // UI rendered separately

      const entities = entityManager.getByLayer(layer);
      for (const entity of entities) {
        if (!entity.active) {
          continue;
        }
        this.renderEntity(back, entity, beatProgress);
      }
    }
  }

  private renderEntity(back: Buffer, entity: Entity, beatProgress: number): void {
    const pos = entity.getRenderPosition();
    const x = Math.round(pos.x);
    const y = Math.round(pos.y);

    // Skip if off-screen
    if (x < 0 || x >= this.config.width || y < 0 || y >= this.config.height) {
      return;
    }

    const char = entity.char;
    const color = this.parseColor(entity.color);

    back.setCell(x, y, char, color, 0x000000, false);
  }

  private parseColor(ansiColor: string): number {
    // Parse ANSI escape sequence to RGB
    // Format: \x1b[38;2;r;g;bm or \x1b[38;5;nm or \x1b[31m
    const esc = '\x1b';
    const match = ansiColor.match(new RegExp(`${esc}\\[(?:38;2;(\\d+);(\\d+);(\\d+)|38;5;(\\d+)|3[0-7]|9[0-7])m`));
    if (!match) {
      return Colors.WHITE;
    }

    if (match[1]) {
      // TrueColor
      return rgb(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    }
    if (match[4]) {
      // 256-color
      return this.index256ToRgb(parseInt(match[4]));
    }
    // Basic 16-color
    return this.basicAnsiToRgb(ansiColor);
  }

  private basicAnsiToRgb(ansi: string): number {
    const codes: Record<string, number> = {
      '\x1b[30m': 0x000000,
      '\x1b[31m': 0xaa0000,
      '\x1b[32m': 0x00aa00,
      '\x1b[33m': 0xaa5500,
      '\x1b[34m': 0x0000aa,
      '\x1b[35m': 0xaa00aa,
      '\x1b[36m': 0x00aaaa,
      '\x1b[37m': 0xaaaaaa,
      '\x1b[90m': 0x555555,
      '\x1b[91m': 0xff5555,
      '\x1b[92m': 0x55ff55,
      '\x1b[93m': 0xffff55,
      '\x1b[94m': 0x5555ff,
      '\x1b[95m': 0xff55ff,
      '\x1b[96m': 0x55ffff,
      '\x1b[97m': 0xffffff,
    };
    return codes[ansi] || Colors.WHITE;
  }

  private index256ToRgb(idx: number): number {
    if (idx < 16) {
      return this.basicAnsiToRgb(`\x1b[${idx < 8 ? 30 + idx : 90 + (idx - 8)}m`);
    }
    if (idx < 232) {
      idx -= 16;
      const r = Math.floor(idx / 36) * 51;
      const g = Math.floor((idx % 36) / 6) * 51;
      const b = (idx % 6) * 51;
      return rgb(r, g, b);
    }
    // Grayscale
    const v = (idx - 232) * 10 + 8;
    return rgb(v, v, v);
  }

  private renderHUD(
    back: Buffer,
    player: Player,
    beatClock: BeatClock,
    comboSystem: ComboSystem,
    score: number,
    beatInfo?: BeatInfo
  ): void {
    const w = this.config.width;
    const h = this.config.height;

    // Top bar background
    back.fillRect(0, 0, w, 1, ' ', Colors.UI_TEXT, Colors.BG_PANEL);

    // Score
    back.drawText(1, 0, `SCORE: ${score.toString().padStart(7, '0')}`, Colors.UI_TEXT, Colors.BG_PANEL);

    // Combo
    const combo = comboSystem.getCombo();
    const comboColor =
      combo > 0 ? (combo >= 30 ? Colors.UI_DANGER : combo >= 20 ? Colors.UI_WARNING : Colors.UI_ACCENT) : Colors.UI_DIM;
    back.drawText(w - 30, 0, `COMBO: ${combo.toString().padStart(3)}`, comboColor, Colors.BG_PANEL, combo > 0);

    // BPM
    const bpm = Math.round(beatClock.getBPM());
    const targetBpm = Math.round(comboSystem.getTargetBPM());
    const bpmStr = bpm !== targetBpm ? `${bpm}→${targetBpm}` : `${bpm}`;
    back.drawText(Math.floor(w / 2) - 10, 0, `BPM: ${bpmStr.padStart(7)}`, Colors.UI_ACCENT, Colors.BG_PANEL);

    // Beat indicator (top right)
    if (beatInfo) {
      const beatChars = ['●', '○', '○', '○'];
      const beatChar = beatChars[beatInfo.beatInMeasure];
      const beatColor = beatInfo.beatInMeasure === 0 ? Colors.BEAT_STRONG : Colors.BEAT_WEAK;
      back.setCell(w - 2, 0, beatChar, beatColor, Colors.BG_PANEL);
    }

    // Bottom bar - timing feedback area
    back.fillRect(0, h - 2, w, 2, ' ', Colors.UI_DIM, Colors.BG_PANEL);

    // Beat timing visualization (16 segments for 4 beats)
    const beatProgress = beatInfo
      ? beatInfo.beatInMeasure / 4 + (1 - beatClock.getTimeUntilNextBeat() / (60000 / beatClock.getBPM())) / 4
      : 0;
    const segments = 16;
    for (let i = 0; i < segments; i++) {
      const x = 2 + i * 3;
      const segmentBeat = (i / segments) * 4;
      const isActive = segmentBeat <= (beatInfo ? beatInfo.beatInMeasure + beatProgress - Math.floor(beatProgress) : 0);
      const isMeasureStart = i % 4 === 0;
      back.setCell(
        x,
        h - 2,
        isMeasureStart ? '▼' : '▽',
        isActive ? (isMeasureStart ? Colors.BEAT_STRONG : Colors.UI_ACCENT) : Colors.UI_DIM,
        Colors.BG_PANEL
      );
    }

    // Player status (bottom left)
    const cooldown = player.getShootCooldownRemaining(beatClock.getBeatNumber());
    back.drawText(
      2,
      h - 1,
      cooldown > 0 ? `⏳ ${cooldown}` : '✦ READY',
      cooldown > 0 ? Colors.UI_WARNING : Colors.UI_PERFECT,
      Colors.BG_PANEL
    );
  }

  private renderGameState(
    back: Buffer,
    state: 'playing' | 'paused' | 'gameover' | 'menu',
    score: number,
    maxCombo: number
  ): void {
    if (state === 'playing') {
      return;
    }

    const w = this.config.width;
    const h = this.config.height;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);

    // Semi-transparent overlay
    back.fillRect(0, 0, w, h, ' ', Colors.UI_TEXT, Colors.BLACK);

    switch (state) {
      case 'paused': {
        back.drawBox(cx - 15, cy - 4, 30, 9, Colors.UI_ACCENT, Colors.BG_PANEL, 'rounded');
        back.drawText(cx - 6, cy - 2, 'PAUSED', Colors.UI_ACCENT, Colors.BG_PANEL, true);
        back.drawText(cx - 12, cy, 'Press ESC to resume', Colors.UI_TEXT, Colors.BG_PANEL);
        break;
      }
      case 'gameover': {
        back.drawBox(cx - 20, cy - 6, 40, 13, Colors.UI_DANGER, Colors.BG_PANEL, 'double');
        back.drawText(cx - 7, cy - 4, 'GAME OVER', Colors.UI_DANGER, Colors.BG_PANEL, true);
        back.drawText(
          cx - 12,
          cy - 1,
          `FINAL SCORE: ${score.toString().padStart(7, '0')}`,
          Colors.UI_TEXT,
          Colors.BG_PANEL
        );
        back.drawText(cx - 10, cy + 1, `MAX COMBO: ${maxCombo}`, Colors.UI_WARNING, Colors.BG_PANEL);
        back.drawText(cx - 14, cy + 4, 'Press R to restart', Colors.UI_ACCENT, Colors.BG_PANEL, true);
        back.drawText(cx - 12, cy + 5, 'Press Q to quit', Colors.UI_DIM, Colors.BG_PANEL);
        break;
      }
      case 'menu': {
        back.drawBox(cx - 18, cy - 5, 36, 11, Colors.UI_ACCENT, Colors.BG_PANEL, 'rounded');
        back.drawText(cx - 5, cy - 3, 'NOMU', Colors.UI_ACCENT, Colors.BG_PANEL, true);
        back.drawText(cx - 10, cy - 1, 'Rhythm Action Game', Colors.UI_TEXT, Colors.BG_PANEL);
        back.drawText(cx - 14, cy + 1, '[1] Zen Mode   (Relax)', Colors.UI_DIM, Colors.BG_PANEL);
        back.drawText(cx - 14, cy + 2, '[2] Groove Mode (Standard)', Colors.UI_TEXT, Colors.BG_PANEL);
        back.drawText(cx - 14, cy + 3, '[3] Chaos Mode  (Intense)', Colors.UI_WARNING, Colors.BG_PANEL);
        back.drawText(cx - 10, cy + 5, 'Press 1/2/3 to start', Colors.UI_ACCENT, Colors.BG_PANEL);
        break;
      }
    }
  }

  /**
   * Render hit effect at position
   */
  renderHitEffect(back: Buffer, position: Vec2, judgment: 'perfect' | 'great' | 'miss'): void {
    const x = Math.round(position.x);
    const y = Math.round(position.y);

    const effects = {
      perfect: { chars: ['✦', '✧', '✨'], colors: [Colors.UI_PERFECT, Colors.BRIGHT_CYAN, Colors.WHITE] },
      great: { chars: ['★', '☆', '·'], colors: [Colors.UI_GREAT, Colors.BRIGHT_YELLOW, Colors.YELLOW] },
      miss: { chars: ['✗', '✘', '×'], colors: [Colors.UI_MISS, Colors.BRIGHT_RED, Colors.RED] },
    };

    const effect = effects[judgment];
    // These would be handled by a particle system in practice
    // For now, just flash the cell
    if (x >= 0 && x < this.config.width && y >= 0 && y < this.config.height) {
      back.setCell(x, y, effect.chars[0], effect.colors[0], Colors.BG_DARK, true);
    }
  }

  /**
   * Render combo milestone effect
   */
  renderComboMilestone(back: Buffer, combo: number): void {
    if (combo % 10 !== 0) {
      return;
    }

    const cx = Math.floor(this.config.width / 2);
    const cy = Math.floor(this.config.height / 2) - 5;

    const messages: Record<number, string> = {
      10: 'COMBO 10! - BEAT RISES',
      20: 'COMBO 20! - SYNTH ENTERS',
      30: 'COMBO 30! - DRUMS INTENSIFY',
      40: 'COMBO 40! - MAX OVERDRIVE',
      50: 'COMBO 50! - GODLIKE',
    };

    const msg = messages[combo] || `COMBO ${combo}!`;
    const color = combo >= 40 ? Colors.UI_DANGER : combo >= 30 ? Colors.UI_WARNING : Colors.UI_ACCENT;

    back.drawBox(cx - Math.floor(msg.length / 2) - 2, cy - 1, msg.length + 4, 3, color, Colors.BG_PANEL, 'rounded');
    back.drawText(cx - Math.floor(msg.length / 2), cy, msg, color, Colors.BG_PANEL, true);
  }

  getFPS(): number {
    return this.fps;
  }
  getBuffer(): DoubleBuffer {
    return this.buffer;
  }
  getWidth(): number {
    return this.config.width;
  }
  getHeight(): number {
    return this.config.height;
  }
}

// Re-export for convenience
export { Colors, rgb, hsl } from './Buffer';
