import type { ResolvedHostTheme } from '@/lib/theme/resolve';

/**
 * What the Host theme row says, from the switch and the host's resolved file.
 *
 * Pure and apart from the row so the wording is pinned by a test: a row that
 * says a theme applies when the app is drawing its own colours sends a person
 * looking for a bug in the wrong place.
 */
export interface HostThemeSummary {
  /** The value on the right: Off, Default, the theme's name, or Custom. */
  value: string;
  /** The line under the label, or null when there is nothing to add. */
  detail: string | null;
  /** True when the detail reports something wrong, so it takes the attention colour. */
  attention: boolean;
}

const colourCount = (count: number) => `${count} ${count === 1 ? 'colour' : 'colours'}`;

export function hostThemeSummary(
  enabled: boolean,
  theme: ResolvedHostTheme | undefined,
  hostName: string
): HostThemeSummary {
  if (!enabled) return { value: 'Off', detail: null, attention: false };
  // Not checked yet renders the defaults, the same as no file at all.
  if (theme === undefined || theme.status === 'missing') {
    return { value: 'Default', detail: null, attention: false };
  }
  // The file is there but could not be used at all (unreadable, not JSON,
  // empty): the app is on its own colours, and the reason is the problem.
  if (theme.status === 'unreadable' || (theme.problems.length > 0 && theme.colours === 0 && theme.ignored === 0)) {
    return { value: 'Default', detail: 'theme.json could not be used', attention: true };
  }
  const value = theme.name ?? 'Custom';
  if (theme.ignored > 0) {
    return { value, detail: `${colourCount(theme.colours)}, ${theme.ignored} ignored`, attention: true };
  }
  return { value, detail: `${colourCount(theme.colours)} from ${hostName}`, attention: false };
}
