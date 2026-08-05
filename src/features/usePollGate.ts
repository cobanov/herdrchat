import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Whether this screen's poll loop should be running.
 *
 * True only when the app is in the foreground AND this screen is the one on
 * top. Both halves matter and neither was checked before: a backgrounded app
 * polled a host nobody was watching, and the chat list kept polling underneath
 * an open conversation because a pushed route does not unmount what it covers.
 *
 * Returned as a boolean rather than a subscription so the caller's effect can
 * simply depend on it — flipping to false tears the loop down through the
 * normal cleanup path, and flipping back to true starts a fresh one that polls
 * immediately. That immediate poll is the point of resuming: after a suspend
 * the SSH socket is usually dead, and the sooner we find out the sooner the
 * native layer re-dials.
 */
export function usePollGate(): boolean {
  const focused = useIsFocused();
  const [active, setActive] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  return active && focused;
}
