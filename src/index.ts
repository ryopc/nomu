/**
 * nomu - Audio Engine Prototype
 *
 * Demonstrates the BeatClock and AudioEngine working together.
 * Press keys to test different sounds and BPM changes.
 */

import type { BeatInfo } from './audio/BeatClock';
import { BeatClock } from './audio/BeatClock';
import { AudioEngine, AudioScheduler, SoundGenerators } from './audio/AudioEngine';

// ============================================
// Configuration
// ============================================
const INITIAL_BPM = 120;
const TICK_RATE_MS = 10; // How often to process audio (ms)

// ============================================
// Global instances
// ============================================
const beatClock = new BeatClock({
  initialBPM: INITIAL_BPM,
  minBPM: 60,
  maxBPM: 200,
  beatsPerMeasure: 4,
});

const audioEngine = new AudioEngine({
  sampleRate: 44100,
  channels: 1,
  bufferSize: 1024,
});

const audioScheduler = new AudioScheduler(beatClock, audioEngine);

// ============================================
// State
// ============================================
let lastBeatNumber = -1;
const beatTimes: number[] = [];
let isProcessing = false;

// ============================================
// Setup Audio
// ============================================
function setupAudio(): void {
  audioEngine.init();
  audioEngine.preloadDefaults();

  // Schedule the main kick on every beat
  audioScheduler.scheduleRecurring('kick', 1, 1.0, 0);

  console.log('🎵 Audio engine initialized');
  console.log('   Sample rate: 44100 Hz');
  console.log(`   Initial BPM: ${INITIAL_BPM}`);
}

// ============================================
// Beat Callback - The heart of the game loop
// ============================================
function onBeat(beatInfo: BeatInfo): void {
  // Visual feedback in terminal
  const measureStr = `M${beatInfo.measureNumber + 1}`;
  const beatStr = `B${beatInfo.beatInMeasure + 1}`;
  const bpmStr = `${Math.round(beatInfo.bpm)} BPM`;

  // Visual beat indicator
  const indicator = beatInfo.beatInMeasure === 0 ? '▓▓▓' : '░░░';

  // Calculate timing accuracy
  const actualTime = performance.now();
  const scheduledTime = beatInfo.timestamp;
  const drift = actualTime - scheduledTime;

  process.stdout.write(
    `\r${indicator} | ${measureStr}:${beatStr} | ${bpmStr} | ` +
      `Drift: ${drift.toFixed(2)}ms | ` +
      `Next in: ${beatClock.getTimeUntilNextBeat().toFixed(1)}ms   `
  );

  // Process scheduled audio for this beat
  audioScheduler.processBeat(beatInfo.beatNumber);

  // Track timing for analysis
  beatTimes.push(actualTime);
  if (beatTimes.length > 100) {
    beatTimes.shift();
  }

  lastBeatNumber = beatInfo.beatNumber;
}

// ============================================
// Audio Processing Loop
// ============================================
function startAudioProcessing(): void {
  setInterval(() => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;
    audioEngine.process();
    isProcessing = false;
  }, TICK_RATE_MS);
}

// ============================================
// Input Handling
// ============================================
function setupInput(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }

  process.stdin.on('data', (key: string) => {
    // Exit on Ctrl+C
    if (key === '\u0003') {
      shutdown();
      return;
    }

    const currentBPM = beatClock.getBPM();

    switch (key) {
      case '+':
      case '=':
        // Increase BPM by 5 with 4-beat transition
        beatClock.setBPM(currentBPM + 5, 4);
        console.log(`\n📈 BPM: ${currentBPM} → ${currentBPM + 5} (transitioning...)`);
        break;

      case '-':
      case '_':
        // Decrease BPM by 5
        beatClock.setBPM(currentBPM - 5, 4);
        console.log(`\n📉 BPM: ${currentBPM} → ${currentBPM - 5} (transitioning...)`);
        break;

      case '1':
        // Immediate BPM change
        beatClock.setBPMImmediate(120);
        console.log('\n⚡ BPM set to 120 immediately');
        break;

      case '2':
        beatClock.setBPMImmediate(140);
        console.log('\n⚡ BPM set to 140 immediately');
        break;

      case '3':
        beatClock.setBPMImmediate(160);
        console.log('\n⚡ BPM set to 160 immediately');
        break;

      case 'k':
        // Trigger kick manually
        audioEngine.playSound('kick', 0, 0.8);
        console.log('\n🥁 Kick!');
        break;

      case 's':
        audioEngine.playSound('snare', 0, 0.8);
        console.log('\n🥁 Snare!');
        break;

      case 'h':
        audioEngine.playSound('hihat', 0, 0.6);
        console.log('\n🎵 Hi-hat!');
        break;

      case 'p':
        audioEngine.playSound('pluck', 0, 0.7);
        console.log('\n✨ Pluck!');
        break;

      case 'd':
        audioEngine.playSound('destroy', 0, 0.7);
        console.log('\n💥 Destroy!');
        break;

      case 'c':
        audioEngine.playSound('comboUp', 0, 0.6);
        console.log('\n⭐ Combo Up!');
        break;

      case 't':
        // Run timing test
        runTimingTest();
        break;

      case ' ': {
        // Space - simulate perfect hit
        const timeUntilNext = beatClock.getTimeUntilNextBeat();
        const intervalMs = 60000 / beatClock.getBPM();
        const accuracy = 1 - Math.abs(timeUntilNext - intervalMs / 2) / (intervalMs / 2);

        if (accuracy > 0.8) {
          audioEngine.playSound('pluck', 0, 0.8);
          console.log(`\n✨ PERFECT! (${(accuracy * 100).toFixed(0)}%)`);
        } else if (accuracy > 0.5) {
          console.log(`\n👍 Good (${(accuracy * 100).toFixed(0)}%)`);
        } else {
          console.log(`\n❌ Miss (${(accuracy * 100).toFixed(0)}%)`);
        }
        break;
      }

      case '?': {
        printHelp();
        break;
      }
    }
  });
}

// ============================================
// Timing Analysis
// ============================================
function runTimingTest(): void {
  console.log('\n📊 Timing Analysis (last 100 beats):');
  console.log('=====================================');

  if (beatTimes.length < 2) {
    console.log('Not enough data yet...');
    return;
  }

  const intervals: number[] = [];
  for (let i = 1; i < beatTimes.length; i++) {
    intervals.push(beatTimes[i] - beatTimes[i - 1]);
  }

  const expectedInterval = 60000 / beatClock.getBPM();
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const minInterval = Math.min(...intervals);
  const maxInterval = Math.max(...intervals);

  // Calculate jitter (standard deviation)
  const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  console.log(`Expected interval: ${expectedInterval.toFixed(3)}ms`);
  console.log(`Average interval:  ${avgInterval.toFixed(3)}ms`);
  console.log(`Min interval:      ${minInterval.toFixed(3)}ms`);
  console.log(`Max interval:      ${maxInterval.toFixed(3)}ms`);
  console.log(`Jitter (σ):        ${stdDev.toFixed(3)}ms`);
  console.log(`Drift from target: ${(avgInterval - expectedInterval).toFixed(3)}ms`);
  console.log('');

  // Quality assessment
  if (stdDev < 1.0) {
    console.log('✅ EXCELLENT - Rock solid timing');
  } else if (stdDev < 3.0) {
    console.log('✅ GOOD - Acceptable for rhythm game');
  } else if (stdDev < 5.0) {
    console.log('⚠️  FAIR - Noticeable jitter');
  } else {
    console.log('❌ POOR - Timing issues detected');
  }
}

// ============================================
// Help
// ============================================
function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    nomu - Audio Prototype                     ║
╠══════════════════════════════════════════════════════════════╣
║  SPACE     - Test timing (hit on beat)                        ║
║  + / -     - Increase/decrease BPM (smooth 4-beat transition) ║
║  1 / 2 / 3 - Set BPM to 120/140/160 immediately              ║
║  k / s / h - Play Kick / Snare / Hi-hat                       ║
║  p / d / c - Play Pluck / Destroy / Combo Up                  ║
║  t         - Run timing analysis                              ║
║  ?         - Show this help                                   ║
║  Ctrl+C    - Exit                                             ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

// ============================================
// Shutdown
// ============================================
function shutdown(): void {
  console.log('\n\n🛑 Shutting down...');
  beatClock.stop();
  audioEngine.destroy();

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  // Final timing report
  runTimingTest();

  process.exit(0);
}

// ============================================
// Main
// ============================================
function main(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  nomu - Rhythm Action Game Prototype                         ║
║  "Code-driven audio, terminal-based, BPM-synced"             ║
╚══════════════════════════════════════════════════════════════╝
  `);

  setupAudio();
  setupInput();
  startAudioProcessing();

  // Register beat callback
  beatClock.onBeat(onBeat);

  // Start the clock
  beatClock.start();

  printHelp();

  console.log('🎮 Running... Press SPACE on the beat!\n');
}

// Handle process signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Run
main();
