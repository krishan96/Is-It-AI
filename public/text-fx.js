/**
 * Text animations. Both are on a theme: the app decodes files, so its text
 * resolves rather than simply appearing.
 *
 * Accessibility rule for everything here: the animation runs on an aria-hidden
 * element and the real string stays readable to assistive tech, so a screen
 * reader is never handed a frame of scrambled characters.
 */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$?/\\<>[]{}=+*';
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

/**
 * Resolve text left to right out of random glyphs.
 * Whitespace is never scrambled, so the shape of the line holds steady.
 */
export function scramble(element, text = element.textContent, { speed = 34, settle = 2.2 } = {}) {
  element.setAttribute('aria-hidden', 'true');
  const label = element.closest('[data-label-target]') ?? element.parentElement;
  if (label && !label.getAttribute('aria-label')) label.setAttribute('aria-label', text);

  if (prefersReducedMotion()) {
    element.textContent = text;
    return;
  }

  const characters = [...text];
  let revealed = 0;
  let tick = 0;
  clearInterval(element._scrambleTimer);

  element._scrambleTimer = setInterval(() => {
    tick += 1;
    if (tick % settle < 1) revealed += 1;

    element.textContent = characters
      .map((character, index) => {
        if (index < revealed || character.trim() === '') return character;
        return randomGlyph();
      })
      .join('');

    if (revealed >= characters.length) {
      clearInterval(element._scrambleTimer);
      element.textContent = text;
    }
  }, speed);
}

/**
 * Count a readout up to its value, easing out so it settles like an instrument
 * rather than ticking linearly to a stop.
 */
export function countUp(element, to, { duration = 900 } = {}) {
  cancelAnimationFrame(element._countFrame);

  if (prefersReducedMotion() || to === null) {
    element.textContent = to === null ? '—' : String(to);
    return;
  }

  const from = Number(element.textContent) || 0;
  const startedAt = performance.now();

  const step = (now) => {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = String(Math.round(from + (to - from) * eased));
    if (progress < 1) element._countFrame = requestAnimationFrame(step);
  };
  element._countFrame = requestAnimationFrame(step);
}

/** Stagger children into view once, for a list that has just been built. */
export function revealChildren(parent, { step = 55 } = {}) {
  if (prefersReducedMotion()) return;
  [...parent.children].forEach((child, index) => {
    child.style.setProperty('--reveal-delay', `${index * step}ms`);
    child.classList.remove('is-revealing');
    void child.offsetWidth; // restart the animation on re-render
    child.classList.add('is-revealing');
  });
}
