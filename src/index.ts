/**
 * nomu - Rhythm Action Game
 * Main entry point
 */

import { GameState, GameMode, GameStateType } from './game/GameState';
import { BeatClock } from './audio/BeatClock';
import { AudioEngine } from './audio/AudioEngine';

// Handle graceful shutdown
let game: GameState | null = null;

function shutdown(): void {
  if (game) {
    game.destroy();
    game = null;
  }
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  shutdown();
});

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  nomu - Rhythm Action Game                                   ║
║  "Code-driven audio, terminal-based, BPM-synced"             ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Initialize game
  game = new GameState({
    screenWidth: 80,
    screenHeight: 24,
    useTrueColor: true,
    targetFPS: 60,
    mode: GameMode.Groove,
  });

  // Enter alt screen and render menu
  process.stdout.write(game.renderMenu());

  // Start the game (this runs the game loop)
  game.start();
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  shutdown();
});
