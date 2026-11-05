import { describe, expect, it } from 'vitest';
import { PokePanel, PokeRect } from './poke';

const DT = 1 / 72;
const rects: PokeRect[] = [
  { x: -0.05, y: 0, width: 0.04, height: 0.04 },
  { x: 0.05, y: 0, width: 0.04, height: 0.04 },
];

function press(panel: PokePanel, x: number, y: number, depths: number[]) {
  return depths.map((z) => panel.update(x, y, z, DT).pressed);
}

describe('PokePanel', () => {
  it('presses a button when the finger arrives from the front', () => {
    const panel = new PokePanel(rects);
    const pressed = press(panel, -0.05, 0, [0.05, 0.03, 0.01, 0.0, -0.01]);
    expect(pressed.filter((index) => index === 0)).toHaveLength(1);
  });

  it('reports hover before contact', () => {
    const panel = new PokePanel(rects);
    expect(panel.update(0.05, 0, 0.04, DT).hovered).toBe(1);
    expect(panel.update(0, 0, 0.04, DT).hovered).toBe(-1);
    expect(panel.update(0.05, 0, 0.2, DT).hovered).toBe(-1);
  });

  it('catches a fast poke that crosses the plane in one frame', () => {
    const panel = new PokePanel(rects);
    expect(press(panel, 0.05, 0, [0.09, -0.02])).toEqual([-1, 1]);
  });

  it('does not repeat while the finger stays in', () => {
    const panel = new PokePanel(rects);
    press(panel, -0.05, 0, [0.03, 0]);
    expect(press(panel, -0.05, 0, new Array(40).fill(-0.005))).toEqual(
      new Array(40).fill(-1),
    );
  });

  it('presses again after pulling back', () => {
    const panel = new PokePanel(rects);
    press(panel, -0.05, 0, [0.03, 0]);
    press(panel, -0.05, 0, new Array(20).fill(0.03));
    expect(press(panel, -0.05, 0, [0.03, 0]).at(-1)).toBe(0);
  });

  it('ignores a finger that slides in sideways behind the surface', () => {
    const panel = new PokePanel(rects);
    panel.update(0, 0, 0.03, DT);
    for (let x = 0; x < 0.06; x += 0.005) {
      expect(panel.update(x, 0, 0, DT).pressed).toBe(-1);
    }
  });

  it('does not press the button the finger slides onto', () => {
    const panel = new PokePanel(rects);
    panel.update(-0.05, 0, 0.03, DT);
    expect(panel.update(0.05, 0, 0, DT).pressed).toBe(-1);
  });

  it('ignores a hand arriving from behind the panel', () => {
    const panel = new PokePanel(rects);
    expect(press(panel, -0.05, 0, [-0.2, -0.1, -0.03, 0.0])).toEqual([
      -1, -1, -1, -1,
    ]);
  });

  it('forgets an armed press on reset', () => {
    const panel = new PokePanel(rects);
    panel.update(-0.05, 0, 0.03, DT);
    panel.reset();
    expect(panel.update(-0.05, 0, 0, DT).pressed).toBe(-1);
  });
});
