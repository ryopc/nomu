/**
 * ComboSystem - Manages combo, BPM scaling, and rhythm rewards
 * Core mechanic: "Play well → BPM goes up → Game gets faster/harder but more rewarding"
 */

import type { BeatClock } from '../audio/BeatClock';
import type { AudioScheduler } from '../audio/AudioEngine';
import type { HitJudgment } from './Collision';

export interface ComboConfig {
  baseBPM: number;
  minBPM: number;
  maxBPM: number;
  bpmPerComboTier: number; // BPM increase per tier
  combosPerTier: number; // Combos needed for next tier
  missBPMPenalty: number; // BPM decrease on miss
  transitionBeats: number; // Beats for BPM transition
}

export interface ComboState {
  combo: number;
  maxCombo: number;
  tier: number; // Current BPM tier (0-based)
  bpm: number;
  targetBPM: number;
  isTransitioning: boolean;
  perfectCount: number;
  greatCount: number;
  missCount: number;
}

export class ComboSystem {
  private config: ComboConfig;
  private state: ComboState;
  private beatClock: BeatClock;
  private audioScheduler: AudioScheduler;

  // Callbacks
  private onComboChangeCallbacks: Array<(combo: number) => void> = [];
  private onTierChangeCallbacks: Array<(tier: number, newBPM: number) => void> = [];
  private onJudgmentCallbacks: Array<(judgment: HitJudgment, combo: number) => void> = [];

  constructor(beatClock: BeatClock, audioScheduler: AudioScheduler, config?: Partial<ComboConfig>) {
    this.beatClock = beatClock;
    this.audioScheduler = audioScheduler;

    this.config = {
      baseBPM: config?.baseBPM || 120,
      minBPM: config?.minBPM || 60,
      maxBPM: config?.maxBPM || 180,
      bpmPerComboTier: config?.bpmPerComboTier || 10,
      combosPerTier: config?.combosPerTier || 10,
      missBPMPenalty: config?.missBPMPenalty || 5,
      transitionBeats: config?.transitionBeats || 4,
    };

    this.state = {
      combo: 0,
      maxCombo: 0,
      tier: 0,
      bpm: this.config.baseBPM,
      targetBPM: this.config.baseBPM,
      isTransitioning: false,
      perfectCount: 0,
      greatCount: 0,
      missCount: 0,
    };

    // Initialize BeatClock
    this.beatClock.setBPMImmediate(this.config.baseBPM);
    this.setupBeatClockListener();
  }

  private setupBeatClockListener(): void {
    this.beatClock.onBPMChange(bpm => {
      this.state.bpm = bpm;
      this.state.isTransitioning = this.beatClock.isTransitioning();
    });
  }

  /**
   * Process a hit judgment
   */
  processJudgment(judgment: HitJudgment): void {
    switch (judgment.timing) {
      case 'perfect':
        this.state.perfectCount++;
        this.incrementCombo();
        break;
      case 'great':
        this.state.greatCount++;
        this.incrementCombo();
        break;
      case 'miss':
        this.state.missCount++;
        this.resetCombo();
        break;
    }

    this.onJudgmentCallbacks.forEach(cb => cb(judgment, this.state.combo));
  }

  private incrementCombo(): void {
    this.state.combo++;
    if (this.state.combo > this.state.maxCombo) {
      this.state.maxCombo = this.state.combo;
    }

    // Check for tier up
    const newTier = Math.floor(this.state.combo / this.config.combosPerTier);
    if (newTier > this.state.tier) {
      this.state.tier = newTier;
      this.updateTargetBPM();
    }

    this.onComboChangeCallbacks.forEach(cb => cb(this.state.combo));
  }

  private resetCombo(): void {
    if (this.state.combo > 0) {
      this.state.combo = 0;
      this.onComboChangeCallbacks.forEach(cb => cb(0));
    }

    // BPM penalty on miss
    this.applyMissPenalty();
  }

  private applyMissPenalty(): void {
    const newTargetBPM = Math.max(this.config.minBPM, this.state.targetBPM - this.config.missBPMPenalty);
    if (newTargetBPM !== this.state.targetBPM) {
      this.state.targetBPM = newTargetBPM;
      this.state.tier = Math.floor((this.state.targetBPM - this.config.baseBPM) / this.config.bpmPerComboTier);
      this.beatClock.setBPM(this.state.targetBPM, this.config.transitionBeats);
      this.audioScheduler.scheduleOnBeat(0, 'comboUp', 0.3); // Small sound feedback
    }
  }

  private updateTargetBPM(): void {
    this.state.targetBPM = Math.min(
      this.config.maxBPM,
      this.config.baseBPM + this.state.tier * this.config.bpmPerComboTier
    );

    this.beatClock.setBPM(this.state.targetBPM, this.config.transitionBeats);

    // Play tier-up sound
    this.audioScheduler.scheduleOnBeat(0, 'comboUp', 0.5);

    this.onTierChangeCallbacks.forEach(cb => cb(this.state.tier, this.state.targetBPM));
  }

  /**
   * Force set combo (for testing/debugging)
   */
  setCombo(combo: number): void {
    this.state.combo = combo;
    const newTier = Math.floor(combo / this.config.combosPerTier);
    if (newTier !== this.state.tier) {
      this.state.tier = newTier;
      this.updateTargetBPM();
    }
    this.onComboChangeCallbacks.forEach(cb => cb(combo));
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = {
      combo: 0,
      maxCombo: 0,
      tier: 0,
      bpm: this.config.baseBPM,
      targetBPM: this.config.baseBPM,
      isTransitioning: false,
      perfectCount: 0,
      greatCount: 0,
      missCount: 0,
    };
    this.beatClock.setBPMImmediate(this.config.baseBPM);
    this.onComboChangeCallbacks.forEach(cb => cb(0));
  }

  // Event registration
  onComboChange(callback: (combo: number) => void): () => void {
    this.onComboChangeCallbacks.push(callback);
    return () => {
      const idx = this.onComboChangeCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.onComboChangeCallbacks.splice(idx, 1);
      }
    };
  }

  onTierChange(callback: (tier: number, newBPM: number) => void): () => void {
    this.onTierChangeCallbacks.push(callback);
    return () => {
      const idx = this.onTierChangeCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.onTierChangeCallbacks.splice(idx, 1);
      }
    };
  }

  onJudgment(callback: (judgment: HitJudgment, combo: number) => void): () => void {
    this.onJudgmentCallbacks.push(callback);
    return () => {
      const idx = this.onJudgmentCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.onJudgmentCallbacks.splice(idx, 1);
      }
    };
  }

  // Getters
  getCombo(): number {
    return this.state.combo;
  }
  getMaxCombo(): number {
    return this.state.maxCombo;
  }
  getTier(): number {
    return this.state.tier;
  }
  getBPM(): number {
    return this.state.bpm;
  }
  getTargetBPM(): number {
    return this.state.targetBPM;
  }
  getAccuracy(): number {
    const total = this.state.perfectCount + this.state.greatCount + this.state.missCount;
    if (total === 0) {
      return 1;
    }
    return (this.state.perfectCount + this.state.greatCount) / total;
  }
  getPerfectRate(): number {
    const total = this.state.perfectCount + this.state.greatCount + this.state.missCount;
    if (total === 0) {
      return 0;
    }
    return this.state.perfectCount / total;
  }
  getState(): Readonly<ComboState> {
    return this.state;
  }
  getConfig(): Readonly<ComboConfig> {
    return this.config;
  }

  /**
   * Get score multiplier based on current combo
   */
  getScoreMultiplier(): number {
    return 1.0 + Math.min(this.state.combo, 50) * 0.02; // Max 2.0x at combo 50
  }

  /**
   * Get current difficulty modifier (0-1+)
   */
  getDifficultyModifier(): number {
    return this.state.bpm / this.config.baseBPM;
  }
}
