/** Colour scenes. A scene only changes colour: the music stays the same. */

export type Rgb = readonly [number, number, number];

export const rgb = (hex: number): Rgb => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

export interface Palette {
  name: string;
  /** Orb colour per instrument, in the order of `BAND_ROOT_MIDI`. */
  instruments: readonly Rgb[];
  beam: Rgb;
  skyTop: Rgb;
  skyBottom: Rgb;
}

export const PALETTES: readonly Palette[] = [
  {
    name: 'Aurora',
    instruments: [
      rgb(0x63f5d8), rgb(0xb48cff), rgb(0xff7ac8),
      rgb(0x7cc8ff), rgb(0xffd36e), rgb(0xff8d6b), rgb(0xa6f08c), rgb(0xe6e6ff),
    ],
    beam: rgb(0xa8ecff),
    skyTop: rgb(0x0c1230),
    skyBottom: rgb(0x03040e),
  },
  {
    name: 'Ember',
    instruments: [
      rgb(0xffcc70), rgb(0xff7d5c), rgb(0xf04f9a),
      rgb(0xffe0a8), rgb(0xffa94d), rgb(0xd9415f), rgb(0xff9ec4), rgb(0xfff0e0),
    ],
    beam: rgb(0xffd9a8),
    skyTop: rgb(0x2a0f1c),
    skyBottom: rgb(0x0a0408),
  },
  {
    name: 'Tide',
    instruments: [
      rgb(0x7fe0ff), rgb(0x5a94ff), rgb(0x9b84ff),
      rgb(0xa8f0ff), rgb(0x5fe0c0), rgb(0x4060ff), rgb(0xc0a8ff), rgb(0xe0f4ff),
    ],
    beam: rgb(0xb8e4ff),
    skyTop: rgb(0x07203a),
    skyBottom: rgb(0x02060f),
  },
  {
    name: 'Bloom',
    instruments: [
      rgb(0xc4ff80), rgb(0xffe873), rgb(0xff94ac),
      rgb(0xfff6a8), rgb(0x9dff9d), rgb(0xff7a5c), rgb(0xffc2e0), rgb(0xf0ffe0),
    ],
    beam: rgb(0xe9ffc2),
    skyTop: rgb(0x10261c),
    skyBottom: rgb(0x030a07),
  },
];
