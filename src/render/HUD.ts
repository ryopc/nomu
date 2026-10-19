/**
 * HUD - Heads-up display rendering
 * Separated from main renderer for modularity
 */

import type { Buffer } from './Buffer';
import { Colors } from './Buffer';
import type { BeatClock, BeatInfo } from '../audio/BeatClock';
import type { ComboSystem } from '../game/ComboSystem';
import type { Player } from '../game/Player';
import { Vec2 } from '../utils/Vec2';

export interface HUDConfig {
  width: number;
  height: number;
  showFPS?: boolean;
  showDebug?: boolean;
}

export class HUD {
  private config: HUDConfig;
  private lastJudgment: 'perfect' | 'great' | 'miss' | null = null;
  private judgmentTimer: number = 0;
  private judgmentPosition: Vec2 = new Vec2(0, 0);

  constructor(config: HUDConfig) {
    this.config = config;
  }

  render(
    buffer: Buffer,
    player: Player,
    beatClock: BeatClock,
    comboSystem: ComboSystem,
    score: number,
    beatInfo?: BeatInfo
  ): void {
    const w = this.config.width;
    const h = this.config.height;

    // Top bar
    this.renderTopBar(buffer, beatClock, comboSystem, score, beatInfo);

    // Bottom bar
    this.renderBottomBar(buffer, player, beatClock, comboSystem, beatInfo);

    // Judgment display
    this.renderJudgment(buffer);

    // Debug info
    if (this.config.showDebug) {
      this.renderDebug(buffer, beatClock, comboSystem);
    }
  }

  private renderTopBar(
    buffer: Buffer,
    beatClock: BeatClock,
    comboSystem: ComboSystem,
    score: number,
    beatInfo?: BeatInfo
  ): void {
    const w = this.config.width;

    // Background
    buffer.fillRect(0, 0, w, 1, ' ', Colors.UI_TEXT, Colors.BG_PANEL);

    // Score (left)
    buffer.drawText(1, 0, `SCORE: ${score.toString().padStart(7, '0')}`, Colors.UI_TEXT, Colors.BG_PANEL);

    // Center: BPM with transition indicator
    const bpm = Math.round(beatClock.getBPM());
    const targetBpm = Math.round(comboSystem.getTargetBPM());
    const isTransitioning = beatClock.isTransitioning();

    let bpmDisplay = `${bpm}`;
    if (bpm !== targetBpm) {
      bpmDisplay = `${bpm}→${targetBpm}`;
    }

    const bpmColor = isTransitioning ? Colors.UI_WARNING : Colors.UI_ACCENT;
    const bpmX = Math.floor(w / 2) - Math.floor(bpmDisplay.length / 2) - 3;
    buffer.drawText(bpmX, 0, `BPM: ${bpmDisplay}`, bpmColor, Colors.BG_PANEL, isTransitioning);

    // Combo (right)
    const combo = comboSystem.getCombo();
    if (combo > 0) {
      const comboColor = this.getComboColor(combo);
      const comboStr = `COMBO: ${combo}`;
      buffer.drawText(w - comboStr.length - 1, 0, comboStr, comboColor, Colors.BG_PANEL, true);

      // Tier indicator
      const tier = comboSystem.getTier();
      if (tier > 0) {
        const tierNames = ['', 'GROOVE', 'FEVER', 'ECSTASY', 'TRANCE', 'OVERDRIVE'];
        const tierName = tierNames[Math.min(tier, tierNames.length - 1)];
        buffer.drawText(w - comboStr.length - tierName.length - 3, 0, tierName, comboColor, Colors.BG_PANEL);
      }
    } else {
      buffer.drawText(w - 12, 0, 'COMBO:   0', Colors.UI_DIM, Colors.BG_PANEL);
    }

    // Beat indicator (far right)
    if (beatInfo) {
      const beatChars = ['▇', '▅', '▃', '▁'];
      const beatChar = beatChars[beatInfo.beatInMeasure];
      const beatColor = beatInfo.beatInMeasure === 0 ? Colors.BEAT_STRONG : Colors.BEAT_WEAK;
      buffer.setCell(w - 2, 0, beatChar, beatColor, Colors.BG_PANEL);
    }
  }

  private renderBottomBar(
    buffer: Buffer,
    player: Player,
    beatClock: BeatClock,
    comboSystem: ComboSystem,
    beatInfo?: BeatInfo
  ): void {
    const w = this.config.width;
    const h = this.config.height;

    // Background
    buffer.fillRect(0, h - 2, w, 2, ' ', Colors.UI_DIM, Colors.BG_PANEL);

    // Shoot readiness
    const cooldown = player.getShootCooldownRemaining(beatClock.getBeatNumber());
    const ready = cooldown === 0;
    buffer.drawText(
      2,
      h - 1,
      ready ? '✦ SHOOT READY' : `⏳ COOLDOWN ${cooldown}`,
      ready ? Colors.UI_PERFECT : Colors.UI_WARNING,
      Colors.BG_PANEL
    );

    // Beat timing visualization (16 segments = 4 beats × 4 subdivisions)
    const segments = 16;
    const startX = Math.floor(w / 2) - segments * 1.5;

    if (beatInfo) {
      const beatProgress = 1 - beatClock.getTimeUntilNextBeat() / (60000 / beatClock.getBPM());
      const absolutePos = (beatInfo.beatInMeasure + beatProgress) / 4; // 0-1 over measure

      for (let i = 0; i < segments; i++) {
        const segmentPos = i / segments;
        const x = Math.round(startX + i * 3);
        const isMeasureStart = i % 4 === 0;

        if (Math.abs(segmentPos - absolutePos) < 0.06) {
          // Current position marker
          buffer.setCell(x, h - 2, isMeasureStart ? '▼' : '▽', Colors.UI_PERFECT, Colors.BG_PANEL);
        } else if (isMeasureStart) {
          buffer.setCell(x, h - 2, '◆', Colors.BEAT_WEAK, Colors.BG_PANEL);
        } else {
          buffer.setCell(x, h - 2, '·', Colors.UI_DIM, Colors.BG_PANEL);
        }
      }
    }

    // Accuracy stats (right side)
    const accuracy = comboSystem.getAccuracy() * 100;
    const perfectRate = comboSystem.getPerfectRate() * 100;
    buffer.drawText(
      w - 28,
      h - 1,
      `ACC: ${accuracy.toFixed(1)}% P: ${perfectRate.toFixed(1)}%`,
      Colors.UI_DIM,
      Colors.BG_PANEL
    );
  }

  private renderJudgment(buffer: Buffer): void {
    if (this.judgmentTimer <= 0 || !this.lastJudgment) {
      return;
    }

    const w = this.config.width;
    const h = this.config.height;
    const x = Math.round(this.judgmentPosition.x);
    const y = Math.round(this.judgmentPosition.y);

    const texts = {
      perfect: { text: 'PERFECT!', color: Colors.UI_PERFECT, bg: Colors.BG_DARK },
      great: { text: 'GREAT', color: Colors.UI_GREAT, bg: Colors.BG_DARK },
      miss: { text: 'MISS', color: Colors.UI_MISS, bg: Colors.BG_DARK },
    };

    const j = texts[this.lastJudgment];
    const alpha = this.judgmentTimer / 20; // 20 frames fade
    const fadedColor = this.fadeColor(j.color, alpha);
    const fadedBg = this.fadeColor(j.bg, alpha * 0.5);

    buffer.drawText(x - Math.floor(j.text.length / 2), y, j.text, fadedColor, fadedBg, true);

    this.judgmentTimer--;
  }

  private renderDebug(buffer: Buffer, beatClock: BeatClock, comboSystem: ComboSystem): void {
    const h = this.config.height;
    const debugY = h - 4;

    buffer.drawText(
      1,
      debugY,
      `BPM: ${beatClock.getBPM().toFixed(1)}/${comboSystem.getTargetBPM().toFixed(1)}`,
      Colors.UI_DIM,
      Colors.BG_DARK
    );
    buffer.drawText(
      1,
      debugY + 1,
      `Beat: ${beatClock.getBeatNumber()} | Measure: ${beatClock.getMeasureNumber()}`,
      Colors.UI_DIM,
      Colors.BG_DARK
    );
    buffer.drawText(
      1,
      debugY + 2,
      `Next beat in: ${beatClock.getTimeUntilNextBeat().toFixed(1)}ms`,
      Colors.UI_DIM,
      Colors.BG_DARK
    );
  }

  private getComboColor(combo: number): number {
    if (combo >= 50) {
      return Colors.MAGENTA;
    }
    if (combo >= 40) {
      return Colors.UI_DANGER;
    }
    if (combo >= 30) {
      return Colors.UI_WARNING;
    }
    if (combo >= 20) {
      return Colors.BRIGHT_YELLOW;
    }
    if (combo >= 10) {
      return Colors.UI_ACCENT;
    }
    return Colors.UI_TEXT;
  }

  private fadeColor(color: number, alpha: number): number {
    const r = Math.floor(((color >> 16) & 0xff) * alpha);
    const g = Math.floor(((color >> 8) & 0xff) * alpha);
    const b = Math.floor((color & 0xff) * alpha);
    return (r << 16) | (g << 8) | b;
  }

  // Public API for showing judgments
  showJudgment(judgment: 'perfect' | 'great' | 'miss', position: Vec2): void {
    this.lastJudgment = judgment;
    this.judgmentTimer = 20; // frames
    this.judgmentPosition.copy(position);
  }

  clearJudgment(): void {
    this.judgmentTimer = 0;
    this.lastJudgment = null;
  }
}
