/** In-app copy. English by default, Spanish when the browser asks for it. */

import { Locale } from '../state/challenge';

const STRINGS = {
  en: {
    tagline: 'Place light around you. Hear it become music.',
    enter: 'Enter orbly',
    entering: 'Starting…',
    hands: 'Hands only · seated · sound on',
    noXR: 'Open this page in the Meta Quest browser to play.',
    watchDemo: 'Watch the demo',
    startDemo: 'Start demo',
    xrFailed: 'Could not start the headset session. Please try again.',
    tutorialPinch: 'Pinch to create',
    tutorialRaise: 'Move an orb higher',
    tutorialThrow: 'Throw an orb at your room',
    tutorialPalm: 'Turn your left palm up',
    tutorialDone: 'You are making music',
    skip: 'Skip',
    newLoop: 'New',
    today: "Today's challenge",
    saved: 'Saved',
    cleared: 'Cleared',
    full: 'That is all the orbs',
    challengeDone: 'Challenge complete!',
    paused: 'Paused',
  },
  es: {
    tagline: 'Coloca luz a tu alrededor. Escucha cómo se vuelve música.',
    enter: 'Entrar en orbly',
    entering: 'Iniciando…',
    hands: 'Solo manos · sentado · con sonido',
    noXR: 'Abre esta página en el navegador de Meta Quest para jugar.',
    watchDemo: 'Ver la demo',
    startDemo: 'Iniciar demo',
    xrFailed: 'No se pudo iniciar la sesión del visor. Inténtalo de nuevo.',
    tutorialPinch: 'Pellizca para crear',
    tutorialRaise: 'Mueve un orbe más arriba',
    tutorialThrow: 'Lanza un orbe a tu habitación',
    tutorialPalm: 'Gira la palma izquierda',
    tutorialDone: 'Ya estás haciendo música',
    skip: 'Saltar',
    newLoop: 'Nuevo',
    today: 'Reto de hoy',
    saved: 'Guardado',
    cleared: 'Borrado',
    full: 'No caben más orbes',
    challengeDone: '¡Reto completado!',
    paused: 'En pausa',
  },
} as const;

export type StringKey = keyof typeof STRINGS.en;

export const locale: Locale =
  typeof navigator !== 'undefined' && navigator.language.startsWith('es')
    ? 'es'
    : 'en';

export function t(key: StringKey): string {
  return STRINGS[locale][key];
}
