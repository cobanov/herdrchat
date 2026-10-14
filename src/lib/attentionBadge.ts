/**
 * The count of chats that want you, as a sheet over the chats shows it beside
 * Done (Hosts, Settings). The tab bar's badge used to be the only sign of a
 * blocked agent while one of those was open; this is that sign again, on the
 * control that goes back to them.
 *
 * Nothing at zero, so a quiet host draws no badge at all, and capped so a
 * three-digit count cannot push "Done" off the title line.
 */
export const ATTENTION_BADGE_MAX = 99;

export function attentionBadge(count: number): { text: string; spoken: string } | null {
  if (!Number.isFinite(count) || count < 1) return null;
  const whole = Math.floor(count);
  const text = whole > ATTENTION_BADGE_MAX ? `${ATTENTION_BADGE_MAX}+` : String(whole);
  return { text, spoken: whole === 1 ? '1 chat needs you' : `${text} chats need you` };
}
