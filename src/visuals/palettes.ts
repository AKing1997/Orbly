/** Colour scenes. A scene only changes colour: the music stays the same. */

export type Rgb = readonly [number, number, number];

export const rgb = (hex: number): Rgb => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

export interface Palette {
  name: string;
  /** Orb colour per band: pluck, pad, bass. */
  instruments: readonly [Rgb, Rgb, Rgb];
  beam: Rgb;
  skyTop: Rgb;
  skyBottom: Rgb;
}

export const PALETTES: readonly Palette[] = [
  {
    name: 'Aurora',
    instruments: [rgb(0x63f5d8), rgb(0xb48cff), rgb(0xff7ac8)],
    beam: rgb(0xa8ecff),
    skyTop: rgb(0x0c1230),
    skyBottom: rgb(0x03040e),
  },
  {
    name: 'Ember',
    instruments: [rgb(0xffcc70), rgb(0xff7d5c), rgb(0xf04f9a)],
    beam: rgb(0xffd9a8),
    skyTop: rgb(0x2a0f1c),
    skyBottom: rgb(0x0a0408),
  },
  {
    name: 'Tide',
    instruments: [rgb(0x7fe0ff), rgb(0x5a94ff), rgb(0x9b84ff)],
    beam: rgb(0xb8e4ff),
    skyTop: rgb(0x07203a),
    skyBottom: rgb(0x02060f),
  },
  {
    name: 'Bloom',
    instruments: [rgb(0xc4ff80), rgb(0xffe873), rgb(0xff94ac)],
    beam: rgb(0xe9ffc2),
    skyTop: rgb(0x10261c),
    skyBottom: rgb(0x030a07),
  },
];
