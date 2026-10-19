/**
 * InputManager - Raw mode keyboard input handling
 * Provides low-latency, non-blocking key state tracking
 */

export interface KeyState {
  pressed: boolean;
  justPressed: boolean;
  justReleased: boolean;
  pressTime: number; // ms since press
  repeatCount: number; // for key repeat
}

export interface InputConfig {
  repeatDelay?: number; // ms before repeat starts
  repeatInterval?: number; // ms between repeats
}

type KeyHandler = (key: string, state: KeyState) => void;

export class InputManager {
  private keyStates: Map<string, KeyState> = new Map();
  private keyHandlers: Map<string, KeyHandler[]> = new Map();
  private globalHandlers: KeyHandler[] = [];
  private config: Required<InputConfig>;
  private isRawMode: boolean = false;
  private lastUpdateTime: number = 0;
  private stdin: NodeJS.ReadStream | null = null;

  constructor(config: InputConfig = {}) {
    this.config = {
      repeatDelay: config.repeatDelay ?? 300,
      repeatInterval: config.repeatInterval ?? 50,
    };
  }

  /**
   * Initialize raw mode input
   */
  init(): void {
    if (this.isRawMode) {
      return;
    }

    this.stdin = process.stdin;
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(true);
      this.stdin.resume();
      this.stdin.setEncoding('utf8');
    }

    this.stdin.on('data', this.onData.bind(this));
    this.isRawMode = true;
  }

  /**
   * Cleanup raw mode
   */
  destroy(): void {
    if (!this.isRawMode) {
      return;
    }

    if (this.stdin) {
      this.stdin.off('data', this.onData.bind(this));
      if (this.stdin.isTTY) {
        this.stdin.setRawMode(false);
        this.stdin.pause();
      }
    }
    this.isRawMode = false;
    this.keyStates.clear();
    this.keyHandlers.clear();
    this.globalHandlers.length = 0;
  }

  private onData(data: string): void {
    // Handle escape sequences (arrow keys, etc.)
    const keys = this.parseInput(data);

    for (const key of keys) {
      this.updateKeyState(key, true);

      // Call specific handlers
      const handlers = this.keyHandlers.get(key);
      if (handlers) {
        const state = this.keyStates.get(key)!;
        handlers.forEach(h => h(key, state));
      }

      // Call global handlers
      this.globalHandlers.forEach(h => h(key, this.keyStates.get(key)!));
    }
  }

  private parseInput(data: string): string[] {
    const keys: string[] = [];
    let i = 0;

    while (i < data.length) {
      const char = data[i];
      const code = char.charCodeAt(0);

      // Escape sequence
      if (code === 0x1b && i + 1 < data.length) {
        const next = data[i + 1];

        // CSI sequence: \x1b[...
        if (next === '[' && i + 2 < data.length) {
          let j = i + 2;
          let params = '';
          while (j < data.length && data[j].match(/[0-9;]/)) {
            params += data[j];
            j++;
          }
          if (j < data.length) {
            const final = data[j];
            keys.push(this.parseCSI(params, final));
            i = j + 1;
            continue;
          }
        }

        // SS3 sequence: \x1bO... (some terminals)
        if (next === 'O' && i + 2 < data.length) {
          keys.push(this.parseCSI('', data[i + 2]));
          i += 3;
          continue;
        }

        // Alt+key
        keys.push(`Alt+${next}`);
        i += 2;
        continue;
      }

      // Control characters
      if (code < 0x20) {
        keys.push(this.controlCharToName(code));
        i++;
        continue;
      }

      // Regular character
      keys.push(char);
      i++;
    }

    return keys;
  }

  private parseCSI(params: string, final: string): string {
    const paramList = params.split(';').map(p => parseInt(p) || 1);

    // Arrow keys
    if (final === 'A') {
      return 'ArrowUp';
    }
    if (final === 'B') {
      return 'ArrowDown';
    }
    if (final === 'C') {
      return 'ArrowRight';
    }
    if (final === 'D') {
      return 'ArrowLeft';
    }
    if (final === 'H') {
      return 'Home';
    }
    if (final === 'F') {
      return 'End';
    }

    // Function keys (with modifiers in params)
    if (final === 'P') {
      return `F${paramList[0]}`;
    }
    if (final === 'Q') {
      return `F${paramList[0] + 4}`;
    }
    if (final === 'R') {
      return `F${paramList[0] + 8}`;
    }
    if (final === 'S') {
      return `F${paramList[0] + 12}`;
    }

    // Other common sequences
    if (final === 'Z') {
      return 'Shift+Tab';
    }
    if (final === '~') {
      const key = paramList[0];
      const names: Record<number, string> = {
        1: 'Home',
        2: 'Insert',
        3: 'Delete',
        4: 'End',
        5: 'PageUp',
        6: 'PageDown',
        7: 'Home',
        8: 'End',
        11: 'F1',
        12: 'F2',
        13: 'F3',
        14: 'F4',
        15: 'F5',
        17: 'F6',
        18: 'F7',
        19: 'F8',
        20: 'F9',
        21: 'F10',
        23: 'F11',
        24: 'F12',
      };
      return names[key] || `Key${key}`;
    }

    return `CSI[${params}]${final}`;
  }

  private controlCharToName(code: number): string {
    const names: Record<number, string> = {
      0: 'Ctrl+Space',
      1: 'Ctrl+A',
      2: 'Ctrl+B',
      3: 'Ctrl+C',
      4: 'Ctrl+D',
      5: 'Ctrl+E',
      6: 'Ctrl+F',
      7: 'Ctrl+G',
      8: 'Backspace',
      9: 'Tab',
      10: 'Enter',
      11: 'Ctrl+K',
      12: 'Ctrl+L',
      13: 'Enter',
      14: 'Ctrl+N',
      15: 'Ctrl+O',
      16: 'Ctrl+P',
      17: 'Ctrl+Q',
      18: 'Ctrl+R',
      19: 'Ctrl+S',
      20: 'Ctrl+T',
      21: 'Ctrl+U',
      22: 'Ctrl+V',
      23: 'Ctrl+W',
      24: 'Ctrl+X',
      25: 'Ctrl+Y',
      26: 'Ctrl+Z',
      27: 'Escape',
      28: 'Ctrl+\\',
      29: 'Ctrl+]',
      30: 'Ctrl+^',
      31: 'Ctrl+_',
      127: 'Backspace',
    };
    return names[code] || `Ctrl+${String.fromCharCode(code + 64)}`;
  }

  private updateKeyState(key: string, pressed: boolean): void {
    const now = Date.now();
    let state = this.keyStates.get(key);

    if (!state) {
      state = {
        pressed: false,
        justPressed: false,
        justReleased: false,
        pressTime: 0,
        repeatCount: 0,
      };
      this.keyStates.set(key, state);
    }

    if (pressed && !state.pressed) {
      // Just pressed
      state.pressed = true;
      state.justPressed = true;
      state.justReleased = false;
      state.pressTime = now;
      state.repeatCount = 0;
    } else if (!pressed && state.pressed) {
      // Just released
      state.pressed = false;
      state.justPressed = false;
      state.justReleased = true;
      state.pressTime = 0;
    } else if (pressed && state.pressed) {
      // Held - check for repeat
      state.justPressed = false;
      state.justReleased = false;
      const heldTime = now - state.pressTime;
      if (heldTime > this.config.repeatDelay) {
        const repeats = Math.floor((heldTime - this.config.repeatDelay) / this.config.repeatInterval);
        if (repeats > state.repeatCount) {
          state.repeatCount = repeats;
          state.justPressed = true; // Trigger repeat as "just pressed"
        }
      }
    } else {
      // Not pressed, not just released
      state.justPressed = false;
      state.justReleased = false;
    }
  }

  /**
   * Call this each frame to clear transient states
   */
  update(): void {
    for (const state of this.keyStates.values()) {
      state.justPressed = false;
      state.justReleased = false;
    }
  }

  /**
   * Register handler for specific key
   */
  on(key: string, handler: KeyHandler): () => void {
    const handlers = this.keyHandlers.get(key) || [];
    handlers.push(handler);
    this.keyHandlers.set(key, handlers);

    return () => {
      const h = this.keyHandlers.get(key);
      if (h) {
        const idx = h.indexOf(handler);
        if (idx >= 0) {
          h.splice(idx, 1);
        }
      }
    };
  }

  /**
   * Register global handler for all keys
   */
  onAny(handler: KeyHandler): () => void {
    this.globalHandlers.push(handler);
    return () => {
      const idx = this.globalHandlers.indexOf(handler);
      if (idx >= 0) {
        this.globalHandlers.splice(idx, 1);
      }
    };
  }

  /**
   * Get current key state
   */
  getKey(key: string): KeyState | undefined {
    return this.keyStates.get(key);
  }

  /**
   * Check if key is currently pressed
   */
  isPressed(key: string): boolean {
    return this.keyStates.get(key)?.pressed ?? false;
  }

  /**
   * Check if key was just pressed this frame
   */
  isJustPressed(key: string): boolean {
    return this.keyStates.get(key)?.justPressed ?? false;
  }

  /**
   * Check if key was just released this frame
   */
  isJustReleased(key: string): boolean {
    return this.keyStates.get(key)?.justReleased ?? false;
  }

  /**
   * Get all currently pressed keys
   */
  getPressedKeys(): string[] {
    const result: string[] = [];
    for (const [key, state] of this.keyStates) {
      if (state.pressed) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Convenience: check movement keys
   */
  getMovementVector(): { x: number; y: number } {
    let x = 0,
      y = 0;
    if (this.isPressed('ArrowLeft') || this.isPressed('a') || this.isPressed('A')) {
      x -= 1;
    }
    if (this.isPressed('ArrowRight') || this.isPressed('d') || this.isPressed('D')) {
      x += 1;
    }
    if (this.isPressed('ArrowUp') || this.isPressed('w') || this.isPressed('W')) {
      y -= 1;
    }
    if (this.isPressed('ArrowDown') || this.isPressed('s') || this.isPressed('S')) {
      y += 1;
    }
    return { x, y };
  }

  /**
   * Convenience: check action keys
   */
  isShootPressed(): boolean {
    return this.isJustPressed(' ') || this.isJustPressed('Space');
  }

  isPausePressed(): boolean {
    return this.isJustPressed('Escape') || this.isJustPressed('q') || this.isJustPressed('Q');
  }

  isRestartPressed(): boolean {
    return this.isJustPressed('r') || this.isJustPressed('R');
  }
}

// Singleton instance for easy access
let globalInputManager: InputManager | null = null;

export function createInputManager(config?: InputConfig): InputManager {
  globalInputManager = new InputManager(config);
  globalInputManager.init();
  return globalInputManager;
}

export function getInputManager(): InputManager | null {
  return globalInputManager;
}

export function destroyInputManager(): void {
  if (globalInputManager) {
    globalInputManager.destroy();
    globalInputManager = null;
  }
}
