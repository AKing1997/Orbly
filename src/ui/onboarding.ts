/** The four tutorial steps. Pure: the app reports what the user just did. */

export type TutorialStep = 'pinch' | 'raise' | 'throw' | 'palm' | 'done';

export class OnboardingFlow {
  private current: TutorialStep = 'pinch';

  get step(): TutorialStep {
    return this.current;
  }

  /** Step number from 1, for a progress hint. */
  get index(): number {
    return ['pinch', 'raise', 'throw', 'palm', 'done'].indexOf(this.current) + 1;
  }

  /** The beam played an orb the user placed. */
  orbSounded(): boolean {
    return this.advance('pinch', 'raise');
  }

  /** An orb was dropped higher than where it started. */
  orbRaised(): boolean {
    return this.advance('raise', 'throw');
  }

  /** A thrown orb landed on the room. */
  orbThrown(): boolean {
    return this.advance('throw', 'palm');
  }

  menuOpened(): boolean {
    return this.advance('palm', 'done');
  }

  /** Every orb is gone, so the next steps have nothing to move. */
  orbsGone(): boolean {
    return this.advance('raise', 'pinch') || this.advance('throw', 'pinch');
  }

  skip(): void {
    this.current = 'done';
  }

  private advance(from: TutorialStep, to: TutorialStep): boolean {
    if (this.current !== from) return false;
    this.current = to;
    return true;
  }
}
