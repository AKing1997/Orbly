/**
 * Decides when sound should run. The rule lives in `shouldPlay` so it can be
 * tested: during an XR session only the session's visibility counts, because
 * a headset browser may report its page as hidden while immersive.
 */

import { World } from '@iwsdk/core';

export function shouldPlay(
  sessionVisibility: XRVisibilityState | null,
  documentHidden: boolean,
): boolean {
  if (sessionVisibility !== null) return sessionVisibility === 'visible';
  return !documentHidden;
}

export interface SessionCallbacks {
  onStart: (session: XRSession) => void;
  onEnd: () => void;
  /** True when the app is in the foreground and sound should run. */
  onActiveChange: (active: boolean) => void;
}

export class SessionLifecycle {
  private session: XRSession | null = null;
  private active = true;
  private readonly refresh = (): void => {
    const active = shouldPlay(
      this.session?.visibilityState ?? null,
      document.hidden,
    );
    if (active === this.active) return;
    this.active = active;
    this.callbacks.onActiveChange(active);
  };

  constructor(
    private readonly world: World,
    private readonly callbacks: SessionCallbacks,
  ) {
    const { xr } = world.renderer;
    xr.addEventListener('sessionstart', this.handleStart);
    xr.addEventListener('sessionend', this.handleEnd);
    document.addEventListener('visibilitychange', this.refresh);
  }

  private readonly handleStart = (): void => {
    const session = this.world.renderer.xr.getSession();
    if (session === null) return;
    this.session = session;
    session.addEventListener('visibilitychange', this.refresh);
    this.callbacks.onStart(session);
    this.refresh();
  };

  private readonly handleEnd = (): void => {
    this.session?.removeEventListener('visibilitychange', this.refresh);
    this.session = null;
    this.callbacks.onEnd();
    this.refresh();
  };
}
