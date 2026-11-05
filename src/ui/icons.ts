/** Menu icons, drawn as vector paths into one texture atlas. */

export const ICON_NAMES = [
  'minus',
  'plus',
  'play',
  'pause',
  'undo',
  'rotate',
  'palette',
  'room',
  'stars',
  'save',
  'trash',
  'home',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export const ATLAS_COLUMNS = 4;
export const ATLAS_ROWS = 3;
const CELL = 128;

type Draw = (c: CanvasRenderingContext2D) => void;

const DRAW: Record<IconName, Draw> = {
  minus: (c) => {
    c.beginPath();
    c.moveTo(-26, 0);
    c.lineTo(26, 0);
    c.stroke();
  },
  plus: (c) => {
    c.beginPath();
    c.moveTo(-26, 0);
    c.lineTo(26, 0);
    c.moveTo(0, -26);
    c.lineTo(0, 26);
    c.stroke();
  },
  play: (c) => {
    c.beginPath();
    c.moveTo(-18, -28);
    c.lineTo(28, 0);
    c.lineTo(-18, 28);
    c.closePath();
    c.fill();
  },
  pause: (c) => {
    c.fillRect(-22, -27, 15, 54);
    c.fillRect(7, -27, 15, 54);
  },
  undo: (c) => {
    c.beginPath();
    c.arc(4, 4, 24, Math.PI * 1.15, Math.PI * 0.72, false);
    c.stroke();
    c.beginPath();
    c.moveTo(-34, -2);
    c.lineTo(-23, -30);
    c.lineTo(-4, -6);
    c.closePath();
    c.fill();
  },
  rotate: (c) => {
    c.beginPath();
    c.arc(0, 2, 27, Math.PI * 1.6, Math.PI * 1.1, false);
    c.stroke();
    c.beginPath();
    c.moveTo(4, -38);
    c.lineTo(28, -24);
    c.lineTo(4, -8);
    c.closePath();
    c.fill();
  },
  palette: (c) => {
    c.beginPath();
    c.arc(0, 0, 31, 0, Math.PI * 2);
    c.stroke();
    for (const [x, y] of [[-13, -9], [3, -16], [15, -3], [-6, 11]]) {
      c.beginPath();
      c.arc(x, y, 5.5, 0, Math.PI * 2);
      c.fill();
    }
  },
  room: (c) => {
    c.strokeRect(-32, -22, 64, 44);
    c.beginPath();
    c.moveTo(-32, 6);
    c.lineTo(-10, -8);
    c.lineTo(4, 4);
    c.lineTo(14, -4);
    c.lineTo(32, 10);
    c.stroke();
  },
  stars: (c) => {
    for (const [x, y, r] of [[-12, -8, 19], [20, 14, 11], [18, -22, 8]]) {
      c.beginPath();
      c.moveTo(x, y - r);
      c.quadraticCurveTo(x, y, x + r, y);
      c.quadraticCurveTo(x, y, x, y + r);
      c.quadraticCurveTo(x, y, x - r, y);
      c.quadraticCurveTo(x, y, x, y - r);
      c.fill();
    }
  },
  save: (c) => {
    c.beginPath();
    c.moveTo(0, -30);
    c.lineTo(0, 10);
    c.stroke();
    c.beginPath();
    c.moveTo(-17, -6);
    c.lineTo(0, 12);
    c.lineTo(17, -6);
    c.stroke();
    c.beginPath();
    c.moveTo(-29, 30);
    c.lineTo(29, 30);
    c.stroke();
  },
  trash: (c) => {
    c.beginPath();
    c.moveTo(-28, -20);
    c.lineTo(28, -20);
    c.moveTo(-9, -20);
    c.lineTo(-7, -31);
    c.lineTo(7, -31);
    c.lineTo(9, -20);
    c.stroke();
    c.beginPath();
    c.moveTo(-21, -20);
    c.lineTo(-16, 31);
    c.lineTo(16, 31);
    c.lineTo(21, -20);
    c.stroke();
  },
  home: (c) => {
    c.beginPath();
    c.moveTo(-32, 2);
    c.lineTo(0, -28);
    c.lineTo(32, 2);
    c.stroke();
    c.beginPath();
    c.moveTo(-21, -6);
    c.lineTo(-21, 29);
    c.lineTo(21, 29);
    c.lineTo(21, -6);
    c.stroke();
  },
};

export function drawIconAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * ATLAS_COLUMNS;
  canvas.height = CELL * ATLAS_ROWS;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D canvas is not available');
  context.fillStyle = '#fff';
  context.strokeStyle = '#fff';
  context.lineWidth = 8;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  ICON_NAMES.forEach((name, index) => {
    context.save();
    context.translate(
      (index % ATLAS_COLUMNS) * CELL + CELL / 2,
      Math.floor(index / ATLAS_COLUMNS) * CELL + CELL / 2,
    );
    DRAW[name](context);
    context.restore();
  });
  return canvas;
}

/** Bottom-left UV of an icon's atlas cell. */
export function iconUv(name: IconName): [number, number] {
  const index = ICON_NAMES.indexOf(name);
  return [
    (index % ATLAS_COLUMNS) / ATLAS_COLUMNS,
    1 - (Math.floor(index / ATLAS_COLUMNS) + 1) / ATLAS_ROWS,
  ];
}
