/**
 * ScoreSystem - Score calculation, high scores, persistence
 */

import * as fs from 'fs';
import type { HitJudgment } from './Collision';
import type { ComboSystem } from './ComboSystem';

export interface ScoreConfig {
  baseEnemyScore: number;
  perfectMultiplier: number;
  greatMultiplier: number;
  comboScoreBonus: number; // Per combo point
  maxComboBonus: number;
  survivalBonus: number; // Per beat survived
  bossBonus: number;
}

export interface HighScoreEntry {
  score: number;
  maxCombo: number;
  accuracy: number;
  perfectRate: number;
  date: string;
  mode: string;
  duration: number; // seconds
}

export class ScoreSystem {
  private config: ScoreConfig;
  private currentScore: number = 0;
  private currentMaxCombo: number = 0;
  private currentPerfectCount: number = 0;
  private currentGreatCount: number = 0;
  private currentMissCount: number = 0;
  private startTime: number = 0;
  private beatsSurvived: number = 0;
  private highScores: HighScoreEntry[] = [];
  private highScoreFile: string;
  private maxHighScores: number = 10;

  constructor(config?: Partial<ScoreConfig>) {
    this.config = {
      baseEnemyScore: config?.baseEnemyScore || 100,
      perfectMultiplier: config?.perfectMultiplier || 1.5,
      greatMultiplier: config?.greatMultiplier || 1.0,
      comboScoreBonus: config?.comboScoreBonus || 10,
      maxComboBonus: config?.maxComboBonus || 5000,
      survivalBonus: config?.survivalBonus || 1,
      bossBonus: config?.bossBonus || 10000,
    };

    this.highScoreFile = `${process.env.HOME}/.nomu_highscores.json`;
    this.loadHighScores();
  }

  startGame(): void {
    this.currentScore = 0;
    this.currentMaxCombo = 0;
    this.currentPerfectCount = 0;
    this.currentGreatCount = 0;
    this.currentMissCount = 0;
    this.startTime = Date.now();
    this.beatsSurvived = 0;
  }

  onBeat(): void {
    this.beatsSurvived++;
    // Survival bonus
    this.currentScore += this.config.survivalBonus;
  }

  onEnemyKilled(enemyBaseScore: number, comboSystem: ComboSystem, judgment: HitJudgment): void {
    const combo = comboSystem.getCombo();
    const comboMultiplier = comboSystem.getScoreMultiplier();
    const timingMultiplier = judgment.scoreMultiplier;

    let score = enemyBaseScore * comboMultiplier * timingMultiplier;

    // Flat combo bonus
    score += combo * this.config.comboScoreBonus;

    this.currentScore = Math.floor(score + this.currentScore);
  }

  onJudgment(judgment: HitJudgment): void {
    switch (judgment.timing) {
      case 'perfect':
        this.currentPerfectCount++;
        break;
      case 'great':
        this.currentGreatCount++;
        break;
      case 'miss':
        this.currentMissCount++;
        break;
    }
  }

  onComboChange(combo: number): void {
    if (combo > this.currentMaxCombo) {
      this.currentMaxCombo = combo;
    }
  }

  onBossDefeated(): void {
    this.currentScore += this.config.bossBonus;
  }

  endGame(mode: string): HighScoreEntry {
    const duration = (Date.now() - this.startTime) / 1000;
    const totalHits = this.currentPerfectCount + this.currentGreatCount + this.currentMissCount;
    const accuracy = totalHits > 0 ? (this.currentPerfectCount + this.currentGreatCount) / totalHits : 1;
    const perfectRate = totalHits > 0 ? this.currentPerfectCount / totalHits : 0;

    const entry: HighScoreEntry = {
      score: this.currentScore,
      maxCombo: this.currentMaxCombo,
      accuracy,
      perfectRate,
      date: new Date().toISOString(),
      mode,
      duration,
    };

    this.addHighScore(entry);
    return entry;
  }

  private addHighScore(entry: HighScoreEntry): void {
    this.highScores.push(entry);
    this.highScores.sort((a, b) => b.score - a.score);
    this.highScores = this.highScores.slice(0, this.maxHighScores);
    this.saveHighScores();
  }

  private saveHighScores(): void {
    try {
      const dir = `${process.env.HOME}/.nomu`;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.highScoreFile, JSON.stringify(this.highScores, null, 2));
    } catch {
      // Silently fail - high scores are not critical
    }
  }

  private loadHighScores(): void {
    try {
      if (fs.existsSync(this.highScoreFile)) {
        const data = fs.readFileSync(this.highScoreFile, 'utf8');
        this.highScores = JSON.parse(data);
      }
    } catch {
      this.highScores = [];
    }
  }

  getHighScores(): HighScoreEntry[] {
    return [...this.highScores];
  }

  getCurrentScore(): number {
    return this.currentScore;
  }
  getCurrentMaxCombo(): number {
    return this.currentMaxCombo;
  }
  getStats(): { perfect: number; great: number; miss: number; accuracy: number; perfectRate: number } {
    const total = this.currentPerfectCount + this.currentGreatCount + this.currentMissCount;
    return {
      perfect: this.currentPerfectCount,
      great: this.currentGreatCount,
      miss: this.currentMissCount,
      accuracy: total > 0 ? (this.currentPerfectCount + this.currentGreatCount) / total : 1,
      perfectRate: total > 0 ? this.currentPerfectCount / total : 0,
    };
  }

  getBeatsSurvived(): number {
    return this.beatsSurvived;
  }
}
