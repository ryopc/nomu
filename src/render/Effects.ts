/**
 * Effects - Visual effects system for nomu
 * Particles, screen shake, flashes, text popups
 */

import type { Buffer } from './Buffer';
import { Vec2 } from '../utils/Vec2';
import { Colors } from './Buffer';
import { rand } from '../utils/Random';

export interface ParticleConfig {
  position: Vec2;
  velocity: Vec2;
  char: string;
  color: number;
  life: number; // frames
  gravity?: number;
  fade?: boolean;
  size?: number;
}

export class Particle {
  position: Vec2;
  velocity: Vec2;
  char: string;
  color: number;
  life: number;
  maxLife: number;
  gravity: number;
  fade: boolean;
  active: boolean = true;

  constructor(config: ParticleConfig) {
    this.position = config.position.clone();
    this.velocity = config.velocity.clone();
    this.char = config.char;
    this.color = config.color;
    this.life = config.life;
    this.maxLife = config.life;
    this.gravity = config.gravity ?? 0;
    this.fade = config.fade ?? true;
  }

  update(dt: number = 1): void {
    if (!this.active) {
      return;
    }

    this.position.add(this.velocity);
    this.velocity.y += this.gravity * dt;
    this.life -= dt;

    if (this.life <= 0) {
      this.active = false;
    }
  }

  getRenderColor(): number {
    if (!this.fade) {
      return this.color;
    }

    const ratio = this.life / this.maxLife;
    const r = Math.floor(((this.color >> 16) & 0xff) * ratio);
    const g = Math.floor(((this.color >> 8) & 0xff) * ratio);
    const b = Math.floor((this.color & 0xff) * ratio);
    return (r << 16) | (g << 8) | b;
  }

  getRenderChar(): string {
    if (!this.fade) {
      return this.char;
    }
    const ratio = this.life / this.maxLife;
    if (ratio > 0.7) {
      return this.char;
    }
    if (ratio > 0.4) {
      return this.char === '✦' ? '✧' : this.char === '★' ? '☆' : '·';
    }
    return '.';
  }
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private maxParticles: number;
  private pool: Particle[] = [];

  constructor(maxParticles: number = 500) {
    this.maxParticles = maxParticles;
  }

  emit(config: ParticleConfig): void {
    if (this.particles.length >= this.maxParticles) {
      return;
    }

    let particle: Particle;
    if (this.pool.length > 0) {
      particle = this.pool.pop()!;
      particle.position.copy(config.position);
      particle.velocity.copy(config.velocity);
      particle.char = config.char;
      particle.color = config.color;
      particle.life = config.life;
      particle.maxLife = config.life;
      particle.gravity = config.gravity ?? 0;
      particle.fade = config.fade ?? true;
      particle.active = true;
    } else {
      particle = new Particle(config);
    }

    this.particles.push(particle);
  }

  // Burst emission (explosion, hit effect)
  burst(position: Vec2, count: number, baseColor: number, chars: string[] = ['✦', '✧', '★', '·']): void {
    for (let i = 0; i < count; i++) {
      const angle = ((Math.PI * 2) / count) * i + rand.floatRange(-0.3, 0.3);
      const speed = rand.floatRange(0.5, 2.0);
      this.emit({
        position: position.clone(),
        velocity: new Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed),
        char: rand.choice(chars),
        color: this.varyColor(baseColor, 0.3),
        life: rand.int(8, 20),
        gravity: 0.05,
        fade: true,
      });
    }
  }

  // Directional burst (hit spark)
  spark(position: Vec2, direction: Vec2, color: number, count: number = 8): void {
    const baseAngle = Math.atan2(direction.y, direction.x);
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + rand.floatRange(-Math.PI / 3, Math.PI / 3);
      const speed = rand.floatRange(1.5, 3.5);
      this.emit({
        position: position.clone(),
        velocity: new Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed),
        char: rand.choice(['│', '─', '╱', '╲', '✦']),
        color: this.varyColor(color, 0.2),
        life: rand.int(5, 12),
        gravity: 0.02,
        fade: true,
      });
    }
  }

  // Text popup (score, combo, etc.)
  textPopup(position: Vec2, text: string, color: number, life: number = 30, riseSpeed: number = 0.3): void {
    for (let i = 0; i < text.length; i++) {
      this.emit({
        position: new Vec2(position.x + i, position.y),
        velocity: new Vec2(0, -riseSpeed),
        char: text[i],
        color,
        life,
        fade: true,
      });
    }
  }

  private varyColor(baseColor: number, amount: number): number {
    const r = (baseColor >> 16) & 0xff;
    const g = (baseColor >> 8) & 0xff;
    const b = baseColor & 0xff;

    const vr = Math.max(0, Math.min(255, r + rand.int(-amount * 255, amount * 255)));
    const vg = Math.max(0, Math.min(255, g + rand.int(-amount * 255, amount * 255)));
    const vb = Math.max(0, Math.min(255, b + rand.int(-amount * 255, amount * 255)));

    return (vr << 16) | (vg << 8) | vb;
  }

  update(dt: number = 1): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (!p.active) {
        this.pool.push(this.particles.splice(i, 1)[0]);
      }
    }
  }

  render(buffer: Buffer): void {
    for (const p of this.particles) {
      if (!p.active) {
        continue;
      }
      const x = Math.round(p.position.x);
      const y = Math.round(p.position.y);
      if (x >= 0 && x < buffer.width && y >= 0 && y < buffer.height) {
        buffer.setCell(x, y, p.getRenderChar(), p.getRenderColor());
      }
    }
  }

  clear(): void {
    this.particles.forEach(p => this.pool.push(p));
    this.particles.length = 0;
  }

  getCount(): number {
    return this.particles.length;
  }
}

/**
 * Screen shake effect
 */
export class ScreenShake {
  private intensity: number = 0;
  private duration: number = 0;
  private timer: number = 0;
  private offsetX: number = 0;
  private offsetY: number = 0;

  start(intensity: number, durationFrames: number): void {
    this.intensity = intensity;
    this.duration = durationFrames;
    this.timer = durationFrames;
  }

  update(): { x: number; y: number } | null {
    if (this.timer <= 0) {
      this.intensity = 0;
      this.offsetX = 0;
      this.offsetY = 0;
      return null;
    }

    const progress = 1 - this.timer / this.duration;
    const currentIntensity = this.intensity * (1 - progress * 0.5); // Fade out

    this.offsetX = (rand.float() - 0.5) * 2 * currentIntensity;
    this.offsetY = (rand.float() - 0.5) * 2 * currentIntensity;
    this.timer--;

    return { x: this.offsetX, y: this.offsetY };
  }

  isActive(): boolean {
    return this.timer > 0;
  }
  getOffset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }
}

/**
 * Flash effect (full screen color flash)
 */
export class ScreenFlash {
  private color: number = 0;
  private intensity: number = 0;
  private timer: number = 0;
  private duration: number = 0;

  start(color: number, intensity: number, durationFrames: number): void {
    this.color = color;
    this.intensity = intensity;
    this.timer = durationFrames;
    this.duration = durationFrames;
  }

  update(): { color: number; alpha: number } | null {
    if (this.timer <= 0) {
      return null;
    }

    const progress = 1 - this.timer / this.duration;
    const alpha = this.intensity * (1 - progress * progress); // Quadratic fade
    this.timer--;

    return { color: this.color, alpha };
  }

  isActive(): boolean {
    return this.timer > 0;
  }
}

/**
 * EffectManager - Central manager for all effects
 */
export class EffectManager {
  particles: ParticleSystem;
  screenShake: ScreenShake;
  screenFlash: ScreenFlash;

  // Text popups queue
  private popups: Array<{
    text: string;
    position: Vec2;
    color: number;
    life: number;
    timer: number;
  }> = [];

  constructor(maxParticles: number = 500) {
    this.particles = new ParticleSystem(maxParticles);
    this.screenShake = new ScreenShake();
    this.screenFlash = new ScreenFlash();
  }

  update(): void {
    this.particles.update();
    this.screenShake.update();
    this.screenFlash.update();

    // Update popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].timer--;
      this.popups[i].position.y -= 0.1;
      if (this.popups[i].timer <= 0) {
        this.popups.splice(i, 1);
      }
    }
  }

  render(buffer: Buffer): void {
    // Render particles
    this.particles.render(buffer);

    // Render popups
    for (const popup of this.popups) {
      const x = Math.round(popup.position.x);
      const y = Math.round(popup.position.y);
      if (x >= 0 && x < buffer.width && y >= 0 && y < buffer.height) {
        const alpha = popup.timer / popup.life;
        const fadedColor = this.fadeColor(popup.color, alpha);
        buffer.drawText(x, y, popup.text, fadedColor);
      }
    }
  }

  // Convenience methods
  hitEffect(position: Vec2, judgment: 'perfect' | 'great' | 'miss'): void {
    const configs = {
      perfect: { color: Colors.UI_PERFECT, count: 16, chars: ['✦', '✧', '✨', '★'] },
      great: { color: Colors.UI_GREAT, count: 10, chars: ['★', '☆', '·'] },
      miss: { color: Colors.UI_MISS, count: 8, chars: ['✗', '×', '·'] },
    };
    const cfg = configs[judgment];
    this.particles.burst(position, cfg.count, cfg.color, cfg.chars);

    // Screen shake on miss
    if (judgment === 'miss') {
      this.screenShake.start(2, 6);
    }
    // Small flash on perfect
    if (judgment === 'perfect') {
      this.screenFlash.start(Colors.UI_PERFECT, 0.3, 4);
    }
  }

  enemyDestroyed(position: Vec2, enemyKind: string): void {
    const colors: Record<string, number> = {
      basic: Colors.ENEMY_BASIC,
      zigzag: Colors.ENEMY_ZIGZAG,
      rhythmic: Colors.ENEMY_RHYTHMIC,
      charger: Colors.ENEMY_CHARGER,
      splitter: Colors.ENEMY_SPLITTER,
      boss: Colors.ENEMY_BOSS,
    };
    const color = colors[enemyKind] || Colors.WHITE;

    this.particles.burst(position, 24, color, ['◆', '◇', '✦', '·']);
    this.screenShake.start(1.5, 8);
    this.screenFlash.start(color, 0.2, 6);
  }

  comboMilestone(combo: number, position: Vec2): void {
    const messages: Record<number, { text: string; color: number }> = {
      10: { text: 'COMBO 10!', color: Colors.UI_ACCENT },
      20: { text: 'COMBO 20!!', color: Colors.BRIGHT_YELLOW },
      30: { text: 'COMBO 30!!!', color: Colors.UI_WARNING },
      40: { text: 'MAX OVERDRIVE!', color: Colors.UI_DANGER },
      50: { text: 'GODLIKE!!!', color: Colors.MAGENTA },
    };

    const msg = messages[combo];
    if (msg) {
      this.popups.push({
        text: msg.text,
        position: position.clone(),
        color: msg.color,
        life: 40,
        timer: 40,
      });
      this.screenShake.start(1, 10);
      this.screenFlash.start(msg.color, 0.4, 8);
    }
  }

  scorePopup(position: Vec2, score: number): void {
    this.popups.push({
      text: `+${score}`,
      position: position.clone(),
      color: Colors.UI_ACCENT,
      life: 30,
      timer: 30,
    });
  }

  private fadeColor(color: number, alpha: number): number {
    const r = Math.floor(((color >> 16) & 0xff) * alpha);
    const g = Math.floor(((color >> 8) & 0xff) * alpha);
    const b = Math.floor((color & 0xff) * alpha);
    return (r << 16) | (g << 8) | b;
  }

  clear(): void {
    this.particles.clear();
    this.screenShake.start(0, 0);
    this.screenFlash.start(0, 0, 0);
    this.popups.length = 0;
  }
}
