/**
 * The flat page shown before the headset session. The button matters beyond
 * looks: its click is the user gesture that lets audio start.
 */

import { t } from './strings';

export type OverlayState = 'loading' | 'ready' | 'unsupported' | 'demo';

export class EntryOverlay {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly link: HTMLAnchorElement;

  constructor(private readonly onEnter: () => void) {
    this.root = this.find('entry');
    this.button = this.find('entry-button') as HTMLButtonElement;
    this.note = this.find('entry-note');
    this.link = this.find('entry-demo') as HTMLAnchorElement;
    this.find('entry-tagline').textContent = t('tagline');
    this.link.textContent = t('watchDemo');
    this.link.href = `${location.pathname}?demo=1`;
    this.button.addEventListener('click', () => {
      this.button.disabled = true;
      this.button.textContent = t('entering');
      this.onEnter();
    });
  }

  show(state: OverlayState): void {
    this.root.hidden = false;
    this.button.hidden = state === 'unsupported';
    this.button.disabled = state === 'loading';
    this.link.hidden = state !== 'unsupported';
    this.button.textContent = t(state === 'demo' ? 'startDemo' : 'enter');
    this.note.textContent = t(state === 'unsupported' ? 'noXR' : 'hands');
  }

  showError(): void {
    this.show('ready');
    this.note.textContent = t('xrFailed');
  }

  hide(): void {
    this.root.hidden = true;
  }

  private find(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (element === null) throw new Error(`Missing #${id} in index.html`);
    return element;
  }
}
