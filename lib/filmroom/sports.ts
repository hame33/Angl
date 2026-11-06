/*
 * What the film room assumes about a sport, ported from classic Angl's
 * SPORT_PROFILES (index.html). Only the parts the clip editor uses live here:
 * the categories a team's first film starts with, the category a clip falls
 * back to, and the emoji palette. The dictation vocabulary (protected phrases,
 * length words) comes across with the parser in Phase 6.
 */
export interface SportProfile {
  id: string;
  name: string;
  defaultEmoji: string;
  categories: { name: string; emoji: string }[];
  fallbackCategory: { name: string; emoji: string };
  labelPlaceholder: string;
}

export const DEFAULT_SPORT = 'basketball';
export const NEUTRAL_EMOJIS = ['🎬', '⚡', '🔥', '🛡️', '🎯', '💡', '📌'];

export const SPORTS: Record<string, SportProfile> = {
  basketball: {
    id: 'basketball', name: 'Basketball', defaultEmoji: '🏀',
    categories: [{ name: 'Offence', emoji: '⚡' }, { name: 'Defence', emoji: '🛡️' }, { name: 'Highlights', emoji: '🔥' }],
    fallbackCategory: { name: 'General', emoji: '🏀' },
    labelPlaceholder: 'Pick & roll, fast break…',
  },
  netball: {
    id: 'netball', name: 'Netball', defaultEmoji: '🥅',
    categories: [{ name: 'Attack', emoji: '⚡' }, { name: 'Defence', emoji: '🛡️' }, { name: 'Highlights', emoji: '🔥' }],
    fallbackCategory: { name: 'General', emoji: '🥅' },
    labelPlaceholder: 'Centre pass, turnover…',
  },
};

/* An unknown or missing sport is basketball, as in classic Angl: every team
 * saved before sports existed was one. */
export function sport(id: string | null | undefined): SportProfile {
  return (id && SPORTS[id]) || SPORTS[DEFAULT_SPORT]!;
}

/* The sport's own emoji first, then the neutral ones. */
export function emojiChoices(id: string | null | undefined): string[] {
  const own = sport(id).defaultEmoji;
  return [own, ...NEUTRAL_EMOJIS.filter(e => e !== own)];
}
