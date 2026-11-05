/** The daily challenge: the same one for everybody, derived from the date. */

import { Composition } from './composition';

export type Locale = 'en' | 'es';

export interface Challenge {
  id: string;
  text: Record<Locale, string>;
  isMet: (composition: Composition) => boolean;
}

const distinctSteps = (composition: Composition): number =>
  new Set(composition.orbs.map((orb) => orb.step)).size;

const countBand = (composition: Composition, band: number): number =>
  composition.orbs.filter((orb) => orb.band === band).length;

export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'five-orbs',
    text: {
      en: 'Make a loop with exactly 5 orbs',
      es: 'Crea un bucle con solo 5 orbes',
    },
    isMet: (composition) => composition.orbs.length === 5,
  },
  {
    id: 'all-instruments',
    text: {
      en: 'Use all 3 instruments',
      es: 'Usa los 3 instrumentos',
    },
    isMet: (composition) =>
      [0, 1, 2].every((band) => countBand(composition, band) > 0),
  },
  {
    id: 'four-corners',
    text: {
      en: 'Place an orb on all 4 sides of you',
      es: 'Pon un orbe en tus 4 lados',
    },
    isMet: (composition) =>
      [0, 4, 8, 12].every((step) =>
        composition.orbs.some((orb) => orb.step === step),
      ),
  },
  {
    id: 'bass-line',
    text: {
      en: 'Build a bass line with 4 far orbs',
      es: 'Crea un bajo con 4 orbes lejanos',
    },
    isMet: (composition) => countBand(composition, 2) >= 4,
  },
  {
    id: 'eight-steps',
    text: {
      en: 'Fill 8 different moments of the loop',
      es: 'Llena 8 momentos distintos del bucle',
    },
    isMet: (composition) => distinctSteps(composition) >= 8,
  },
  {
    id: 'high-notes',
    text: {
      en: 'Reach up: 3 orbs at eye level or higher',
      es: 'Sube: 3 orbes a la altura de tus ojos',
    },
    isMet: (composition) =>
      composition.orbs.filter((orb) => orb.degree >= 8).length >= 3,
  },
  {
    id: 'room-band',
    text: {
      en: 'Make 3 kinds of surface sing',
      es: 'Haz cantar 3 tipos de superficie',
    },
    isMet: (composition) =>
      new Set(
        composition.orbs.filter((orb) => orb.spot !== undefined).map((orb) => orb.band),
      ).size >= 3,
  },
  {
    id: 'chord',
    text: {
      en: 'Stack a 3-note chord',
      es: 'Apila un acorde de 3 notas',
    },
    isMet: (composition) => {
      const perStep = new Array<number>(16).fill(0);
      for (const orb of composition.orbs) perStep[orb.step]++;
      return perStep.some((count) => count >= 3);
    },
  },
];

/** Local calendar day, so the challenge changes at the user's midnight. */
export function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function challengeFor(date: Date): Challenge {
  return CHALLENGES[hash(dateKey(date)) % CHALLENGES.length];
}
