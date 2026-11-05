import { describe, expect, it } from 'vitest';
import { shouldPlay } from './session';

describe('shouldPlay', () => {
  it('follows the page when there is no XR session', () => {
    expect(shouldPlay(null, false)).toBe(true);
    expect(shouldPlay(null, true)).toBe(false);
  });

  it('pauses when the system menu covers the session', () => {
    expect(shouldPlay('visible-blurred', false)).toBe(false);
    expect(shouldPlay('hidden', false)).toBe(false);
  });

  it('ignores a page reported as hidden during an immersive session', () => {
    expect(shouldPlay('visible', true)).toBe(true);
  });
});
