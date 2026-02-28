/** Map timeOfDay enum to a concrete hour window string for the LLM */
export const TIME_OF_DAY_WINDOWS: Record<string, { label: string; range: string }> = {
  morning:   { label: 'Morning',   range: '08:00–12:00' },
  afternoon: { label: 'Afternoon', range: '12:00–17:00' },
  evening:   { label: 'Evening',   range: '17:00–23:00' },
  night:     { label: 'Night',     range: '20:00–02:00' },
};

/** When timeOfDay is 'flexible', pick a sensible default window based on occasion */
export const OCCASION_DEFAULT_WINDOWS: Record<string, { label: string; range: string }> = {
  date_night:       { label: 'Evening to Night', range: '17:00–23:00' },
  celebration:      { label: 'Evening to Night', range: '17:00–23:00' },
  friends_day_out:  { label: 'Afternoon to Evening', range: '12:00–22:00' },
  family_outing:    { label: 'Morning to Afternoon', range: '09:00–17:00' },
  solo_adventure:   { label: 'Morning to Evening', range: '09:00–21:00' },
  chill_hangout:    { label: 'Afternoon to Evening', range: '12:00–21:00' },
};

export const FLEXIBLE_FALLBACK = { label: 'Daytime', range: '10:00–21:00' };

/** Map duration enum to concrete hour limits for tight scheduling */
export const DURATION_HOURS: Record<string, number> = {
  '2_3_hours': 3,
  half_day: 4,
  full_day: 8,
};

/** Maximum idle gap (minutes) between consecutive activities */
export const MAX_GAP_MINUTES = 45;
