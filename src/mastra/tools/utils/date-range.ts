/**
 * Compute end date from a start date string (YYYY-MM-DD).
 * Defaults to +3 days if no endDate is provided.
 */
export function resolveEndDate(startDate: string, endDate?: string, defaultDays = 3): string {
  if (endDate) return endDate;
  const d = new Date(startDate);
  d.setDate(d.getDate() + defaultDays);
  return d.toISOString().split('T')[0];
}
