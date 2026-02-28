/**
 * Persists a domain Itinerary to the MongoDB `itineraries` collection.
 *
 * Maps the in-memory domain Itinerary type to the MongoDB document shape:
 *   - Itinerary.name         → summary
 *   - Itinerary.totalCost    → totalCost.{min,max,currency} (derived from item prices)
 *   - ItineraryItem.event    → items[].event (snapshot — flattened to match JSON schema)
 *   - ItineraryItem.scheduledTime → items[].time.{start,end}
 *
 * The `createdBy` field (Supabase auth UUID) is indexed on the collection
 * for fast per-user queries.
 */

import ItineraryModel from '../mongodb/models/Itinerary.js';
import type { IEventSnapshot } from '../mongodb/models/Itinerary.js';
import type { Itinerary, Event } from '../types/index.js';

/**
 * Map a domain Event to the flattened event snapshot stored in MongoDB.
 * Matches the agreed itinerary JSON schema exactly.
 */
function eventToSnapshot(event: Event): IEventSnapshot {
  return {
    id:          event.id,
    name:        event.name,
    description: event.description,
    url:         event.sourceUrl ?? null,
    image:       event.imageUrl ?? null,
    venue:       event.location.name,
    location: {
      address: event.location.address,
      city:    'Singapore',
      country: 'SG',
    },
    startTime:    event.timeSlot.start,
    endTime:      event.timeSlot.end,
    price: event.price
      ? { min: event.price.min, max: event.price.max, currency: event.price.currency }
      : undefined,
    category:     event.category,
    tags:         [],          // domain Event has no tags field; default empty
    rating:       event.rating ?? null,
    availability: event.availability,
    source:       event.source,
  };
}

/**
 * Derive totalCost.{min,max} from individual item event prices.
 * If no items carry price data, falls back to the itinerary's scalar totalCost.
 */
function computeCostRange(itinerary: Itinerary): { min: number; max: number } {
  const hasItemPrices = itinerary.items.some((item) => item.event.price != null);

  if (!hasItemPrices) {
    return { min: itinerary.totalCost, max: itinerary.totalCost };
  }

  let min = 0;
  let max = 0;
  for (const item of itinerary.items) {
    if (item.event.price) {
      min += item.event.price.min;
      max += item.event.price.max;
    }
  }
  return { min, max };
}

export interface PersistResult {
  itineraryId: string;
  itemCount: number;
}

/**
 * Persist a domain Itinerary to MongoDB.
 *
 * @param userId    The authenticated user's UUID (from Supabase auth session)
 * @param itinerary The domain Itinerary produced by the planning pipeline
 * @returns         The MongoDB-generated _id (hex string) and number of items saved
 * @throws          If the MongoDB insert fails
 */
export async function persistItinerary(
  userId: string,
  itinerary: Itinerary,
): Promise<PersistResult> {
  const costRange = computeCostRange(itinerary);

  const doc = await ItineraryModel.create({
    createdBy:   userId,
    summary:     itinerary.name,
    plannedDate: itinerary.date ?? null,
    items: itinerary.items.map((item) => ({
      event: eventToSnapshot(item.event),
      time: {
        start: item.scheduledTime.start,
        end:   item.scheduledTime.end,
      },
      notes: item.notes ?? null,
    })),
    totalCost: {
      min:      costRange.min,
      max:      costRange.max,
      currency: 'SGD',
    },
  });

  const itineraryId = String(doc._id);

  console.log(
    `[persist] ✅ Itinerary saved to MongoDB — id: ${itineraryId}, items: ${itinerary.items.length}, user: ${userId}`,
  );

  return { itineraryId, itemCount: itinerary.items.length };
}
