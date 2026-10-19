/**
 * AudioEngine - Low-level audio synthesis and playback for nomu.
 * Generates PCM audio data programmatically and streams to speaker.
 * Designed for precise, low-latency synchronization with BeatClock.
 */

import Speaker from 'speaker';

export interface AudioEngineConfig {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  bufferSize?: number;
}

export interface SoundDef {
  name: string;
  generate: (sampleRate: number, duration: number) => Float32Array;
}

// Pre-defined sound generators
export const SoundGenerators = {
  /**
   * Kick drum - low frequency sine wave with pitch and amplitude envelope
   */
  kick: (sampleRate: number, duration: number = 0.15): Float32Array => {
    const samples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(samples);
    const baseFreq = 60; // Hz
    
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      // Pitch envelope: starts high, drops quickly
      const pitchEnv = Math.exp(-t * 30);
      const freq = baseFreq + 40 * pitchEnv;
      
      // Amplitude envelope: sharp attack, exponential decay
      const ampEnv = Math.exp(-t * 20);
      
      buffer[i] = Math.sin(2 * Math.PI * freq * t) * ampEnv * 0.8;
    }
    return buffer;
  },

  /**
   * Snare - noise burst with bandpass character
   */
  snare: (sampleRate: number, duration: number = 0.12): Float32Array => {
    const samples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(samples);
    
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      // White noise
      const noise = (Math.random() * 2 - 1);
      // Amplitude envelope: very sharp attack, quick decay
      const ampEnv = Math.exp(-t * 40);
      // Add a bit of tonal character (bandpass-ish)
      const tone = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 30) * 0.3;
      
      buffer[i] = (noise * 0.7 + tone) * ampEnv * 0.6;
    }
    return buffer;
  },

  /**
   * Hi-hat closed - short noise burst
   */
  hihat: (sampleRate: number, duration: number = 0.05): Float32Array => {
    const samples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(samples);
    
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const noise = (Math.random() * 2 - 1);
      const ampEnv = Math.exp(-t * 100);
      buffer[i] = noise * ampEnv * 0.4;
    }
    return buffer;
  },

  /**
   * Synth plucky - for Perfect hit feedback
   */
  pluck: (sampleRate: number, duration: number = 0.3, freq: number = 880): Float32Array => {
    const samples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(samples);
    
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      // Karplus-Strong-ish plucky sound
      const ampEnv = Math.exp(-t * 8);
      const harmonic = Math.sin(2 * Math.PI * freq * t) * 0.6 +
                       Math.sin(2 * Math.PI * freq * 2 * t) * 0.3 +
                       Math.sin(2 * Math.PI * freq * 3 * t) * 0.1;
      buffer[i] = harmonic * ampEnv * 0.5;
    }
    return buffer;
  },

  /**
   * Enemy destroy - noise with descending pitch
   */
  destroy: (sampleRate: number, duration: number = 0.2): Float32Array => {
    const samples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(samples);
    
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const noise = (Math.random() * 2 - 1);
      const pitch = 400 * Math.exp(-t * 15);
      const tone = Math.sin(2 * Math.PI * pitch * t) * 0.4;
      const ampEnv = Math.exp(-t * 12);
      buffer[i] = (noise * 0.5 + tone) * ampEnv * 0.5;
    }
    return buffer;
  },

  /**
   * Combo milestone - ascending arpeggio
   */
  comboUp: (sampleRate: number, duration: number = 0.5): Float32Array => {
    const samples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(samples);
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      let sum = 0;
      notes.forEach((freq, idx) => {
        const noteStart = idx * 0.1;
        if (t >= noteStart) {
          const noteTime = t - noteStart;
          const ampEnv = Math.exp(-noteTime * 10);
          sum += Math.sin(2 * Math.PI * freq * noteTime) * ampEnv;
        }
      });
      buffer[i] = sum * 0.25;
    }
    return buffer;
  },
};

export class AudioEngine {
  private config: Required<AudioEngineConfig>;
  private speaker: Speaker | null = null;
  private sampleRate: number;
  private channels: number;
  private bufferSize: number;
  
  // Sound cache
  private soundCache: Map<string, Float32Array> = new Map();
  
  // Mixing buffer
  private mixBuffer: Float32Array | null = null;
  private mixBufferWritePos: number = 0;
  private mixBufferDuration: number = 0; // seconds
  
  // Output gain
  private masterGain: number = 0.3;

  constructor(config: AudioEngineConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate ?? 44100,
      channels: config.channels ?? 1,
      bitDepth: config.bitDepth ?? 16,
      bufferSize: config.bufferSize ?? 4096,
    };
    this.sampleRate = this.config.sampleRate;
    this.channels = this.config.channels;
    this.bufferSize = this.config.bufferSize;
    
    // Initialize mix buffer (2 seconds of audio)
    this.mixBufferDuration = 2.0;
    const mixBufferSize = Math.floor(this.sampleRate * this.mixBufferDuration);
    this.mixBuffer = new Float32Array(mixBufferSize);
  }

  /**
   * Initialize the speaker output
   */
  init(): void {
    if (this.speaker) return;
    
    this.speaker = new Speaker({
      channels: this.channels,
      bitDepth: this.config.bitDepth,
      sampleRate: this.sampleRate,
    });

    this.speaker.on('error', (err: Error) => {
      console.error('Speaker error:', err);
    });
  }

  /**
   * Pre-generate and cache a sound
   */
  preloadSound(name: string, generator: (sr: number, dur: number) => Float32Array, duration: number = 0.5): void {
    const buffer = generator(this.sampleRate, duration);
    this.soundCache.set(name, buffer);
  }

  /**
   * Preload all default sounds
   */
  preloadDefaults(): void {
    this.preloadSound('kick', SoundGenerators.kick, 0.2);
    this.preloadSound('snare', SoundGenerators.snare, 0.15);
    this.preloadSound('hihat', SoundGenerators.hihat, 0.05);
    this.preloadSound('pluck', SoundGenerators.pluck, 0.3);
    this.preloadSound('destroy', SoundGenerators.destroy, 0.2);
    this.preloadSound('comboUp', SoundGenerators.comboUp, 0.5);
  }

  /**
   * Play a cached sound at the next available mix position (scheduled)
   */
  playSound(name: string, delaySeconds: number = 0, gain: number = 1.0): boolean {
    const sound = this.soundCache.get(name);
    if (!sound || !this.mixBuffer) return false;

    const startSample = Math.floor((this.mixBufferWritePos + delaySeconds * this.sampleRate) % this.mixBuffer.length);
    this.mixIntoBuffer(sound, startSample, gain * this.masterGain);
    return true;
  }

  /**
   * Play a sound at a specific absolute time (for precise scheduling)
   */
  playSoundAt(name: string, absoluteTime: number, gain: number = 1.0): boolean {
    const sound = this.soundCache.get(name);
    if (!sound || !this.mixBuffer) return false;

    const startSample = Math.floor(absoluteTime * this.sampleRate) % this.mixBuffer.length;
    this.mixIntoBuffer(sound, startSample, gain * this.masterGain);
    return true;
  }

  /**
   * Mix a sound buffer into the circular mix buffer
   */
  private mixIntoBuffer(source: Float32Array, startSample: number, gain: number): void {
    if (!this.mixBuffer) return;
    
    const bufLen = this.mixBuffer.length;
    const srcLen = source.length;
    
    for (let i = 0; i < srcLen; i++) {
      const idx = (startSample + i) % bufLen;
      this.mixBuffer[idx] = Math.max(-1, Math.min(1, this.mixBuffer[idx] + source[i] * gain));
    }
  }

  /**
   * Process audio callback - called regularly to feed the speaker
   * This should be called from a high-priority timer or audio thread
   */
  process(): void {
    if (!this.speaker || !this.mixBuffer) return;

    const chunkSize = this.bufferSize;
    const outputBuffer = Buffer.alloc(chunkSize * this.channels * 2); // 16-bit = 2 bytes
    
    for (let i = 0; i < chunkSize; i++) {
      const sample = this.mixBuffer[this.mixBufferWritePos];
      // Clear the buffer as we read (circular buffer)
      this.mixBuffer[this.mixBufferWritePos] = 0;
      this.mixBufferWritePos = (this.mixBufferWritePos + 1) % this.mixBuffer.length;
      
      // Convert float32 [-1, 1] to int16
      const int16 = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      outputBuffer.writeInt16LE(int16, i * 2);
    }
    
    this.speaker.write(outputBuffer);
  }

  /**
   * Set master gain (0.0 - 1.0)
   */
  setMasterGain(gain: number): void {
    this.masterGain = Math.max(0, Math.min(1, gain));
  }

  /**
   * Get current master gain
   */
  getMasterGain(): number {
    return this.masterGain;
  }

  /**
   * Stop and cleanup
   */
  destroy(): void {
    if (this.speaker) {
      this.speaker.end();
      this.speaker = null;
    }
  }
}

/**
 * High-level AudioScheduler - bridges BeatClock and AudioEngine
 * Handles precise scheduling of sounds on beats
 */
export class AudioScheduler {
  private beatClock: any; // BeatClock type - avoid circular import
  private audioEngine: AudioEngine;
  private scheduledSounds: Map<number, Array<{name: string, gain: number}>> = new Map();
  private lookaheadBeats: number = 2;

  constructor(beatClock: any, audioEngine: AudioEngine) {
    this.beatClock = beatClock;
    this.audioEngine = audioEngine;
  }

  /**
   * Schedule a sound to play on a specific beat (relative to current)
   */
  scheduleOnBeat(beatOffset: number, soundName: string, gain: number = 1.0): void {
    const currentBeat = this.beatClock.getBeatNumber();
    const targetBeat = currentBeat + beatOffset;
    
    if (!this.scheduledSounds.has(targetBeat)) {
      this.scheduledSounds.set(targetBeat, []);
    }
    this.scheduledSounds.get(targetBeat)!.push({ name: soundName, gain });
  }

  /**
   * Schedule a recurring sound on every beat (or every N beats)
   */
  scheduleRecurring(soundName: string, intervalBeats: number = 1, gain: number = 1.0, offsetBeats: number = 0): void {
    const currentBeat = this.beatClock.getBeatNumber();
    const startBeat = currentBeat + offsetBeats;
    
    // Schedule for the next several measures
    for (let beat = startBeat; beat < startBeat + 32; beat += intervalBeats) {
      this.scheduleOnBeat(beat - currentBeat, soundName, gain);
    }
  }

  /**
   * Process scheduled sounds - call this on each beat
   */
  processBeat(beatNumber: number): void {
    const sounds = this.scheduledSounds.get(beatNumber);
    if (sounds) {
      const now = performance.now() / 1000; // seconds
      const nextBeatTime = this.beatClock.getNextBeatTime() / 1000;
      
      sounds.forEach(({ name, gain }) => {
        // Schedule at the exact beat time
        this.audioEngine.playSoundAt(name, nextBeatTime, gain);
      });
      this.scheduledSounds.delete(beatNumber);
    }
    
    // Clean up old scheduled sounds
    for (const [beat] of this.scheduledSounds) {
      if (beat < beatNumber - 4) {
        this.scheduledSounds.delete(beat);
      }
    }
  }

  /**
   * Clear all scheduled sounds
   */
  clear(): void {
    this.scheduledSounds.clear();
  }
}