/**
 * BeatClock - The heart of nomu's rhythm system.
 * Manages BPM, calculates precise beat timing, and handles dynamic tempo changes.
 * Uses performance.now() for high-resolution timing.
 */

export interface BeatClockConfig {
  initialBPM: number;
  minBPM?: number;
  maxBPM?: number;
  beatsPerMeasure?: number;
}

export interface BeatInfo {
  beatNumber: number;
  measureNumber: number;
  beatInMeasure: number;
  timestamp: number;
  bpm: number;
  intervalMs: number;
}

export type BeatCallback = (beatInfo: BeatInfo) => void;

export class BeatClock {
  private config: Required<BeatClockConfig>;
  private currentBPM: number;
  private targetBPM: number;
  private beatNumber: number = 0;
  private measureNumber: number = 0;
  private beatInMeasure: number = 0;
  
  private isRunning: boolean = false;
  private startTime: number = 0;
  private nextBeatTime: number = 0;
  private timeoutId: NodeJS.Timeout | null = null;
  
  private onBeatCallbacks: Set<BeatCallback> = new Set();
  private onBPMChangeCallbacks: Set<(bpm: number) => void> = new Set();
  
  // For smooth BPM transitions
  private bpmTransitionStartTime: number = 0;
  private bpmTransitionDuration: number = 0;
  private bpmTransitionStartBPM: number = 0;
  private bpmTransitionTargetBPM: number = 0;

  constructor(config: BeatClockConfig) {
    this.config = {
      initialBPM: config.initialBPM,
      minBPM: config.minBPM ?? 60,
      maxBPM: config.maxBPM ?? 200,
      beatsPerMeasure: config.beatsPerMeasure ?? 4,
    };
    this.currentBPM = this.config.initialBPM;
    this.targetBPM = this.config.initialBPM;
  }

  /**
   * Start the beat clock
   */
  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.startTime = performance.now();
    this.nextBeatTime = this.startTime;
    this.beatNumber = 0;
    this.measureNumber = 0;
    this.beatInMeasure = 0;
    
    this.tick();
  }

  /**
   * Stop the beat clock
   */
  stop(): void {
    this.isRunning = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Main tick loop - uses setTimeout for scheduling precision
   */
  private tick = (): void => {
    if (!this.isRunning) return;

    const now = performance.now();
    
    // Handle BPM transition
    this.updateBPMTransition(now);
    
    // Process all beats that should have fired by now
    while (this.nextBeatTime <= now && this.isRunning) {
      this.fireBeat(now);
    }
    
    // Schedule next tick
    // We schedule slightly ahead to account for callback execution time
    const timeUntilNextBeat = this.nextBeatTime - now;
    if (timeUntilNextBeat > 0) {
      // Use setTimeout for precise scheduling
      this.timeoutId = setTimeout(this.tick, Math.max(0, timeUntilNextBeat - 1));
    } else {
      // If we're behind, tick immediately
      this.tick();
    }
  };

  /**
   * Update current BPM during transition
   */
  private updateBPMTransition(now: number): void {
    if (this.bpmTransitionDuration > 0) {
      const elapsed = now - this.bpmTransitionStartTime;
      const progress = Math.min(elapsed / this.bpmTransitionDuration, 1);
      
      // Ease-in-out for musical feel
      const easedProgress = this.easeInOutCubic(progress);
      
      this.currentBPM = this.bpmTransitionStartBPM + 
        (this.bpmTransitionTargetBPM - this.bpmTransitionStartBPM) * easedProgress;
      
      if (progress >= 1) {
        this.currentBPM = this.bpmTransitionTargetBPM;
        this.bpmTransitionDuration = 0;
      }
    }
  }

  /**
   * Easing function for smooth BPM transitions
   */
  private easeInOutCubic(t: number): number {
    return t < 0.5 
      ? 4 * t * t * t 
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Fire a beat event
   */
  private fireBeat(actualTime: number): void {
    const intervalMs = 60000 / this.currentBPM;
    
    const beatInfo: BeatInfo = {
      beatNumber: this.beatNumber,
      measureNumber: this.measureNumber,
      beatInMeasure: this.beatInMeasure,
      timestamp: this.nextBeatTime, // The theoretical perfect time
      bpm: this.currentBPM,
      intervalMs,
    };

    // Notify all callbacks
    this.onBeatCallbacks.forEach(callback => {
      try {
        callback(beatInfo);
      } catch (e) {
        console.error('Beat callback error:', e);
      }
    });

    // Advance counters
    this.beatNumber++;
    this.beatInMeasure++;
    
    if (this.beatInMeasure >= this.config.beatsPerMeasure) {
      this.beatInMeasure = 0;
      this.measureNumber++;
    }

    // Calculate next beat time based on CURRENT BPM at the moment of this beat
    // This ensures beats stay perfectly aligned even during BPM changes
    this.nextBeatTime += intervalMs;
    
    // Prevent drift: if we're more than half a beat behind, snap forward
    const drift = actualTime - this.nextBeatTime;
    if (drift > intervalMs / 2) {
      this.nextBeatTime = actualTime + intervalMs;
    }
  }

  /**
   * Register a callback to be called on each beat
   */
  onBeat(callback: BeatCallback): () => void {
    this.onBeatCallbacks.add(callback);
    return () => this.onBeatCallbacks.delete(callback);
  }

  /**
   * Register a callback for BPM changes
   */
  onBPMChange(callback: (bpm: number) => void): () => void {
    this.onBPMChangeCallbacks.add(callback);
    return () => this.onBPMChangeCallbacks.delete(callback);
  }

  /**
   * Set target BPM with smooth transition over specified beats
   */
  setBPM(targetBPM: number, transitionBeats: number = 4): void {
    const clampedBPM = Math.max(this.config.minBPM, Math.min(this.config.maxBPM, targetBPM));
    
    if (clampedBPM === this.currentBPM && this.bpmTransitionDuration === 0) return;

    this.targetBPM = clampedBPM;
    this.bpmTransitionStartTime = performance.now();
    this.bpmTransitionStartBPM = this.currentBPM;
    this.bpmTransitionTargetBPM = clampedBPM;
    
    // Transition duration based on current tempo and desired beats
    const currentIntervalMs = 60000 / this.currentBPM;
    this.bpmTransitionDuration = currentIntervalMs * transitionBeats;

    this.onBPMChangeCallbacks.forEach(cb => cb(this.currentBPM));
  }

  /**
   * Immediate BPM change (no transition)
   */
  setBPMImmediate(bpm: number): void {
    const clampedBPM = Math.max(this.config.minBPM, Math.min(this.config.maxBPM, bpm));
    this.currentBPM = clampedBPM;
    this.targetBPM = clampedBPM;
    this.bpmTransitionDuration = 0;
    this.onBPMChangeCallbacks.forEach(cb => cb(this.currentBPM));
  }

  /**
   * Get current BPM
   */
  getBPM(): number {
    return this.currentBPM;
  }

  /**
   * Get target BPM (during transition)
   */
  getTargetBPM(): number {
    return this.targetBPM;
  }

  /**
   * Get current beat number
   */
  getBeatNumber(): number {
    return this.beatNumber;
  }

  /**
   * Get current measure number
   */
  getMeasureNumber(): number {
    return this.measureNumber;
  }

  /**
   * Get beat in current measure (0-indexed)
   */
  getBeatInMeasure(): number {
    return this.beatInMeasure;
  }

  /**
   * Get time until next beat in milliseconds
   */
  getTimeUntilNextBeat(): number {
    return Math.max(0, this.nextBeatTime - performance.now());
  }

  /**
   * Check if currently transitioning BPM
   */
  isTransitioning(): boolean {
    return this.bpmTransitionDuration > 0;
  }

  /**
   * Get the theoretical perfect time of the next beat
   */
  getNextBeatTime(): number {
    return this.nextBeatTime;
  }

  /**
   * Calculate beat timing info for a given timestamp
   */
  getBeatInfoAt(timestamp: number): BeatInfo {
    const intervalMs = 60000 / this.currentBPM;
    const beatsSinceStart = Math.floor((timestamp - this.startTime) / intervalMs);
    
    return {
      beatNumber: beatsSinceStart,
      measureNumber: Math.floor(beatsSinceStart / this.config.beatsPerMeasure),
      beatInMeasure: beatsSinceStart % this.config.beatsPerMeasure,
      timestamp,
      bpm: this.currentBPM,
      intervalMs,
    };
  }
}