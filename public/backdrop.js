/**
 * The animated field behind the page.
 *
 * A grid of dots with a scanning line travelling through it — the app is a
 * forensic instrument, so the background reads as one rather than as ambience.
 * It responds to what the app is doing: the sweep accelerates while detectors
 * are running, and the whole field takes on the verdict's colour once they
 * land, so the decoration carries state instead of just decorating.
 *
 * Purely decorative, so it is aria-hidden, pauses off-screen, and renders a
 * single static frame when the viewer prefers reduced motion.
 */

const SPACING = 30;          // px between dots at 1x
const POINTER_RADIUS = 150;  // how far the cursor's influence reaches

const HUES = { idle: 225, real: 152, uncertain: 42, ai: 12, none: 225 };
const SWEEP_SECONDS = { idle: 11, scanning: 2.4 };

export function createBackdrop(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let width = 0;
  let height = 0;
  let dots = [];
  let frame = null;
  let start = performance.now();

  let mode = 'idle';
  // On a light ground the dots have to darken rather than glow, or the field
  // washes out to nothing.
  let theme = 'dark';
  const dotLightness = () => (theme === 'light' ? 42 : 62);
  // Dark dots on a light ground need more opacity to read, not less.
  const alphaScale = () => (theme === 'light' ? 1.5 : 1);
  let hue = HUES.idle;
  let targetHue = HUES.idle;
  let intensity = 0;        // eased 0..1: how strongly the field is lit
  let targetIntensity = 0;

  const pointer = { x: -9999, y: -9999, strength: 0, target: 0 };

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Centre the grid so it doesn't crop unevenly at the edges.
    const cols = Math.ceil(width / SPACING) + 1;
    const rows = Math.ceil(height / SPACING) + 1;
    const offsetX = (width - (cols - 1) * SPACING) / 2;
    const offsetY = (height - (rows - 1) * SPACING) / 2;

    dots = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        dots.push({
          x: offsetX + col * SPACING,
          y: offsetY + row * SPACING,
          // A fixed offset per dot keeps the breathing from moving in lockstep.
          phase: (col * 0.35 + row * 0.5) % (Math.PI * 2),
        });
      }
    }
  }

  function draw(now) {
    const elapsed = (now - start) / 1000;
    ctx.clearRect(0, 0, width, height);

    hue += (targetHue - hue) * 0.04;
    intensity += (targetIntensity - intensity) * 0.05;
    pointer.strength += (pointer.target - pointer.strength) * 0.08;

    // The scan line's leading edge, travelling top to bottom on a loop.
    const period = SWEEP_SECONDS[mode] ?? SWEEP_SECONDS.idle;
    const sweepY = ((elapsed % period) / period) * (height + 260) - 130;

    for (const dot of dots) {
      const breath = Math.sin(elapsed * 0.6 + dot.phase) * 0.5 + 0.5;
      let alpha = 0.05 + breath * 0.05 + intensity * 0.05;
      let size = 1.4;
      let dotHue = hue;

      // The sweep lights dots as it passes and fades out behind itself.
      const fromSweep = Math.abs(dot.y - sweepY);
      if (fromSweep < 130) {
        const glow = (1 - fromSweep / 130) ** 2;
        alpha += glow * 0.5;
        size += glow * 1.5;
      }

      // The cursor pushes dots outward and brightens them.
      let { x, y } = dot;
      if (pointer.strength > 0.01) {
        const dx = dot.x - pointer.x;
        const dy = dot.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < POINTER_RADIUS) {
          const pull = (1 - distance / POINTER_RADIUS) ** 2 * pointer.strength;
          alpha += pull * 0.55;
          size += pull * 2.2;
          dotHue += pull * 26;
          const push = pull * 9;
          x += (dx / (distance || 1)) * push;
          y += (dy / (distance || 1)) * push;
        }
      }

      ctx.fillStyle = `hsla(${dotHue}, 78%, ${dotLightness() + intensity * 10}%, ${Math.min(alpha * alphaScale(), 0.85)})`;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }

    frame = requestAnimationFrame(draw);
  }

  /** One still frame, for reduced motion and for paused tabs. */
  function drawStatic() {
    ctx.clearRect(0, 0, width, height);
    for (const dot of dots) {
      ctx.fillStyle = `hsla(${targetHue}, 78%, ${dotLightness()}%, ${0.14 * alphaScale()})`;
      ctx.fillRect(dot.x - 0.7, dot.y - 0.7, 1.4, 1.4);
    }
  }

  function play() {
    if (frame !== null) return;
    if (reducedMotion.matches) return drawStatic();
    start = performance.now() - 1000; // resume mid-animation, not from a jolt
    frame = requestAnimationFrame(draw);
  }

  function pause() {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  }

  function resize() {
    layout();
    if (frame === null) drawStatic();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.target = 1;
  }, { passive: true });
  window.addEventListener('pointerleave', () => { pointer.target = 0; });
  // A background tab should not burn frames.
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  reducedMotion.addEventListener('change', () => {
    pause();
    play();
    if (reducedMotion.matches) drawStatic();
  });

  layout();
  play();

  return {
    /** 'idle' | 'scanning' — scanning speeds the sweep up while detectors run. */
    setMode(next) {
      mode = next;
      targetIntensity = next === 'scanning' ? 1 : targetIntensity;
      start = performance.now(); // restart the sweep so the change is visible
    },
    /** Keep the dots readable against whichever ground is behind them. */
    setTheme(next) {
      theme = next;
      if (frame === null) drawStatic();
    },
    /** Tint the whole field to match the verdict, or reset with null. */
    setVerdict(level) {
      targetHue = HUES[level] ?? HUES.idle;
      targetIntensity = level && level !== 'none' ? 0.85 : 0;
      mode = 'idle';
    },
  };
}
