/**
 * Buffer - Double-buffered terminal rendering
 * Uses ANSI escape sequences for direct terminal control
 * Supports TrueColor (24-bit), 256-color, and 16-color modes
 */

import type { Vec2 } from '../utils/Vec2';

export interface BufferConfig {
  width: number;
  height: number;
  useTrueColor?: boolean;
  useAltScreen?: boolean;
}

export interface Cell {
  char: string;
  fg: number; // Packed RGB: 0xRRGGBB
  bg: number; // Packed RGB: 0xRRGGBB
  bold: boolean;
  dirty: boolean;
}

export class Buffer {
  width: number;
  height: number;
  cells: Cell[];
  private useTrueColor: boolean;

  // Pre-allocated strings for performance
  private resetSeq = '\x1b[0m';
  private cursorHome = '\x1b[H';
  private cursorHide = '\x1b[?25l';
  private cursorShow = '\x1b[?25h';
  private altScreenEnter = '\x1b[?1049h';
  private altScreenExit = '\x1b[?1049l';
  private clearScreen = '\x1b[2J';

  constructor(config: BufferConfig) {
    this.width = config.width;
    this.height = config.height;
    this.useTrueColor = config.useTrueColor ?? true;
    this.cells = new Array(this.width * this.height);
    this.clear();
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  private clamp(x: number, y: number): { x: number; y: number } | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return { x, y };
  }

  clear(char: string = ' ', fg: number = 0xffffff, bg: number = 0x000000): void {
    const cell: Cell = { char, fg, bg, bold: false, dirty: true };
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = { ...cell };
    }
  }

  setCell(x: number, y: number, char: string, fg?: number, bg?: number, bold?: boolean): boolean {
    const pos = this.clamp(x, y);
    if (!pos) {
      return false;
    }

    const idx = this.index(pos.x, pos.y);
    const cell = this.cells[idx];

    const newChar = char.length > 0 ? char[0] : ' ';
    const newFg = fg ?? cell.fg;
    const newBg = bg ?? cell.bg;
    const newBold = bold ?? cell.bold;

    // Only mark dirty if actually changed
    if (cell.char !== newChar || cell.fg !== newFg || cell.bg !== newBg || cell.bold !== newBold) {
      cell.char = newChar;
      cell.fg = newFg;
      cell.bg = newBg;
      cell.bold = newBold;
      cell.dirty = true;
      return true;
    }
    return false;
  }

  setCellVec(pos: Vec2, char: string, fg?: number, bg?: number, bold?: boolean): boolean {
    return this.setCell(Math.floor(pos.x), Math.floor(pos.y), char, fg, bg, bold);
  }

  // Draw text string at position
  drawText(x: number, y: number, text: string, fg?: number, bg?: number, bold?: boolean): number {
    let drawn = 0;
    for (let i = 0; i < text.length; i++) {
      if (this.setCell(x + i, y, text[i], fg, bg, bold)) {
        drawn++;
      }
    }
    return drawn;
  }

  drawTextVec(pos: Vec2, text: string, fg?: number, bg?: number, bold?: boolean): number {
    return this.drawText(Math.floor(pos.x), Math.floor(pos.y), text, fg, bg, bold);
  }

  // Draw box/frame
  drawBox(
    x: number,
    y: number,
    w: number,
    h: number,
    fg?: number,
    bg?: number,
    style: 'single' | 'double' | 'rounded' = 'single'
  ): void {
    const chars = {
      single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
      double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
      rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
    }[style];

    // Corners
    this.setCell(x, y, chars.tl, fg, bg);
    this.setCell(x + w - 1, y, chars.tr, fg, bg);
    this.setCell(x, y + h - 1, chars.bl, fg, bg);
    this.setCell(x + w - 1, y + h - 1, chars.br, fg, bg);

    // Edges
    for (let i = 1; i < w - 1; i++) {
      this.setCell(x + i, y, chars.h, fg, bg);
      this.setCell(x + i, y + h - 1, chars.h, fg, bg);
    }
    for (let i = 1; i < h - 1; i++) {
      this.setCell(x, y + i, chars.v, fg, bg);
      this.setCell(x + w - 1, y + i, chars.v, fg, bg);
    }
  }

  // Fill rectangle
  fillRect(x: number, y: number, w: number, h: number, char: string = ' ', fg?: number, bg?: number): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.setCell(x + dx, y + dy, char, fg, bg);
      }
    }
  }

  // Draw horizontal line
  drawHLine(x: number, y: number, w: number, char: string = '─', fg?: number, bg?: number): void {
    for (let i = 0; i < w; i++) {
      this.setCell(x + i, y, char, fg, bg);
    }
  }

  // Draw vertical line
  drawVLine(x: number, y: number, h: number, char: string = '│', fg?: number, bg?: number): void {
    for (let i = 0; i < h; i++) {
      this.setCell(x, y + i, char, fg, bg);
    }
  }

  // Get cell for reading
  getCell(x: number, y: number): Cell | null {
    const pos = this.clamp(x, y);
    if (!pos) {
      return null;
    }
    return this.cells[this.index(pos.x, pos.y)];
  }

  // Convert RGB to ANSI escape sequence
  private rgbToAnsi(rgb: number, isFg: boolean): string {
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;

    if (this.useTrueColor) {
      return `\x1b[${isFg ? 38 : 48};2;${r};${g};${b}m`;
    }

    // Fallback to 256-color approximation
    const idx = this.rgbTo256(r, g, b);
    return `\x1b[${isFg ? 38 : 48};5;${idx}m`;
  }

  private rgbTo256(r: number, g: number, b: number): number {
    // Grayscale
    if (r === g && g === b) {
      if (r < 8) {
        return 16;
      }
      if (r > 248) {
        return 231;
      }
      return Math.round(((r - 8) / 247) * 24) + 232;
    }
    // Color cube (6x6x6)
    const ri = Math.round((r / 255) * 5);
    const gi = Math.round((g / 255) * 5);
    const bi = Math.round((b / 255) * 5);
    return 16 + ri * 36 + gi * 6 + bi;
  }

  // Generate output string for dirty cells only (differential rendering)
  flush(): string {
    let output = '';
    let currentFg = -1;
    let currentBg = -1;
    let currentBold = false;
    let lastX = -1;
    let lastY = -1;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[this.index(x, y)];

        if (!cell.dirty) {
          continue;
        }

        // Move cursor if not adjacent
        if (x !== lastX + 1 || y !== lastY) {
          output += `\x1b[${y + 1};${x + 1}H`;
        }

        // Apply color changes only when needed
        if (cell.fg !== currentFg) {
          output += this.rgbToAnsi(cell.fg, true);
          currentFg = cell.fg;
        }
        if (cell.bg !== currentBg) {
          output += this.rgbToAnsi(cell.bg, false);
          currentBg = cell.bg;
        }
        if (cell.bold !== currentBold) {
          output += cell.bold ? '\x1b[1m' : '\x1b[22m';
          currentBold = cell.bold;
        }

        output += cell.char;
        cell.dirty = false;
        lastX = x;
        lastY = y;
      }
    }

    // Reset at end
    if (currentFg !== -1 || currentBg !== -1 || currentBold) {
      output += this.resetSeq;
    }

    return output;
  }

  // Full frame render (for first frame or resize)
  renderFull(): string {
    let output = this.cursorHome;
    let currentFg = -1;
    let currentBg = -1;
    let currentBold = false;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[this.index(x, y)];

        if (cell.fg !== currentFg) {
          output += this.rgbToAnsi(cell.fg, true);
          currentFg = cell.fg;
        }
        if (cell.bg !== currentBg) {
          output += this.rgbToAnsi(cell.bg, false);
          currentBg = cell.bg;
        }
        if (cell.bold !== currentBold) {
          output += cell.bold ? '\x1b[1m' : '\x1b[22m';
          currentBold = cell.bold;
        }

        output += cell.char;
        cell.dirty = false;
      }
      if (y < this.height - 1) {
        output += '\n';
      }
    }

    output += this.resetSeq;
    return output;
  }

  // Terminal control sequences
  enterAltScreen(): string {
    return this.altScreenEnter + this.clearScreen + this.cursorHome + this.cursorHide;
  }
  exitAltScreen(): string {
    return this.cursorShow + this.altScreenExit;
  }
  hideCursor(): string {
    return this.cursorHide;
  }
  showCursor(): string {
    return this.cursorShow;
  }
  home(): string {
    return this.cursorHome;
  }
  clearScreenSeq(): string {
    return this.clearScreen + this.cursorHome;
  }

  resize(width: number, height: number): void {
    const oldCells = this.cells;
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height);
    this.clear(' ', 0xffffff, 0x000000);
    // Could copy overlapping region from oldCells here
  }

  getDirtyCount(): number {
    let count = 0;
    for (const cell of this.cells) {
      if (cell.dirty) {
        count++;
      }
    }
    return count;
  }
}

/**
 * DoubleBuffer - Manages front/back buffers for flicker-free rendering
 */
export class DoubleBuffer {
  front: Buffer;
  back: Buffer;
  private firstFrame: boolean = true;

  constructor(config: BufferConfig) {
    this.front = new Buffer(config);
    this.back = new Buffer(config);
  }

  getBack(): Buffer {
    return this.back;
  }
  getFront(): Buffer {
    return this.front;
  }

  // Call this to get buffer for drawing
  draw(): Buffer {
    return this.back;
  }

  // Swap and get output
  swap(): string {
    const output = this.firstFrame ? this.back.renderFull() : this.back.flush();
    this.firstFrame = false;

    // Swap references
    const temp = this.front;
    this.front = this.back;
    this.back = temp;

    // Clear new back buffer (inherit from front for persistence, or clear)
    this.back.clear();

    return output;
  }

  resize(width: number, height: number): void {
    this.front.resize(width, height);
    this.back.resize(width, height);
    this.firstFrame = true;
  }

  getWidth(): number {
    return this.front.width;
  }
  getHeight(): number {
    return this.front.height;
  }
}

// Color constants (packed RGB)
export const Colors = {
  // Basic
  BLACK: 0x000000,
  WHITE: 0xffffff,
  GRAY: 0x808080,
  DARK_GRAY: 0x404040,

  // Standard
  RED: 0xff0000,
  GREEN: 0x00ff00,
  BLUE: 0x0000ff,
  YELLOW: 0xffff00,
  CYAN: 0x00ffff,
  MAGENTA: 0xff00ff,

  // Bright
  BRIGHT_RED: 0xff4444,
  BRIGHT_GREEN: 0x44ff44,
  BRIGHT_BLUE: 0x4444ff,
  BRIGHT_YELLOW: 0xffff44,
  BRIGHT_CYAN: 0x44ffff,
  BRIGHT_MAGENTA: 0xff44ff,

  // Game specific
  PLAYER: 0x00ffff,
  PLAYER_BULLET: 0x00ffaa,
  ENEMY_BASIC: 0xff4444,
  ENEMY_ZIGZAG: 0xff44ff,
  ENEMY_RHYTHMIC: 0xffdd00,
  ENEMY_CHARGER: 0xff8800,
  ENEMY_SPLITTER: 0x44ffff,
  ENEMY_BOSS: 0xff00aa,

  // UI
  UI_TEXT: 0xcccccc,
  UI_DIM: 0x666666,
  UI_ACCENT: 0x00ffaa,
  UI_WARNING: 0xff8800,
  UI_DANGER: 0xff2222,
  UI_PERFECT: 0x00ff88,
  UI_GREAT: 0x88ff00,
  UI_MISS: 0xff2222,

  // Background
  BG_DARK: 0x080818,
  BG_PANEL: 0x101020,
  BG_HIGHLIGHT: 0x202040,

  // Beat indicator
  BEAT_STRONG: 0xffffff,
  BEAT_WEAK: 0x444466,
};

// Helper: RGB components
export const rgb = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;
export const hsl = (h: number, s: number, l: number): number => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return rgb(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
};
