import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

// ─── Domain types — mirror the MongoDB document shape ─────────────────────

export interface EventLocation {
  address: string;
  city: string;
  country: string;
}

export interface EventPrice {
  min: number;
  max: number;
  currency: string;
}

/** Flattened event snapshot stored inside each itinerary item. */
export interface EventSnapshot {
  id: string;
  name: string;
  description?: string;
  url?: string | null;
  image?: string | null;
  venue?: string;
  location?: EventLocation;
  startTime?: string;
  endTime?: string;
  price?: EventPrice;
  category?: string;
  tags?: string[];
  rating?: number | null;
  availability?: string;
  source?: string;
}

export interface ItineraryItem {
  event: EventSnapshot;
  /** Scheduled time block for this item within the itinerary. */
  time: { start: string; end: string };
  notes?: string | null;
}

export interface Itinerary {
  /** MongoDB ObjectId serialised to a hex string. */
  _id: string;
  /** Supabase auth UUID of the user who created this itinerary. */
  createdBy: string;
  /** AI-generated plan name / summary sentence. */
  summary?: string | null;
  /** ISO 8601 date string for the planned day, e.g. "2026-03-15T00:00:00.000Z". */
  plannedDate?: string | null;
  items: ItineraryItem[];
  totalCost?: EventPrice;
  /** ISO timestamp — added automatically by Mongoose `timestamps: true`. */
  createdAt: string;
  updatedAt: string;
}

interface GetItinerariesResponse {
  itineraries: Itinerary[];
  total: number;
}

// ─── Formatting helpers ────────────────────────────────────────────────────

/** Format an ISO timestamp to a Singapore-locale time string, e.g. "7:00 PM". */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Singapore',
  });
}

/** Format an ISO timestamp to a short date, e.g. "27 Feb 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  });
}

/**
 * Format a cost range to a readable string.
 * - Same min/max → "$85 SGD"
 * - Different    → "$50–$120 SGD"
 */
export function formatCost(cost: EventPrice | undefined): string {
  if (!cost) return '';
  const { min, max, currency } = cost;
  if (min === max) return `$${min} ${currency}`;
  return `$${min}–$${max} ${currency}`;
}

// ─── Query ─────────────────────────────────────────────────────────────────

async function fetchItineraries(): Promise<Itinerary[]> {
  const { data, error } = await apiClient.get<GetItinerariesResponse>('/itineraries');
  if (error || !data) throw new Error(error ?? 'Failed to load itineraries');
  return data.itineraries;
}

/**
 * Fetches the authenticated user's itineraries from MongoDB.
 * Results are keyed by `['itineraries']` and shared across the app
 * via the React Query cache — both DashboardPage and ItinerariesPage
 * use this hook without triggering duplicate network requests.
 */
export function useItineraries() {
  return useQuery({
    queryKey: ['itineraries'],
    queryFn: fetchItineraries,
  });
}
