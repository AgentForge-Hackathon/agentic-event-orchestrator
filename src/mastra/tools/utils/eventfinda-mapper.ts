import type { Event } from '../../../types/index.js';
import type { EventFindaEvent } from './eventfinda-types.js';
import { inferCategoryFromEventFinda } from './category.js';

const SINGAPORE_CENTER = { lat: 1.3521, lng: 103.8198 };

export function mapEventFindaToEvent(raw: EventFindaEvent): Event | null {
  if (!raw.name || !raw.url) return null;
  if (raw.is_cancelled) return null;

  // Parse dates
  const startDate = raw.datetime_start
    ? new Date(raw.datetime_start).toISOString()
    : new Date().toISOString();
  const endDate = raw.datetime_end
    ? new Date(raw.datetime_end).toISOString()
    : new Date(Date.parse(startDate) + 2 * 60 * 60 * 1000).toISOString();

  // Extract price from ticket_types
  let price: Event['price'] | undefined;
  const ticketTypes = raw.ticket_types?.ticket_types;
  if (ticketTypes?.length && !raw.is_free) {
    const prices = ticketTypes
      .map((tt) => parseFloat(tt.price ?? ''))
      .filter((p) => !isNaN(p) && p > 0);

    if (prices.length > 0) {
      price = {
        min: Math.min(...prices),
        max: Math.max(...prices),
        currency: 'SGD',
      };
    }
  }

  if (raw.is_free) {
    price = { min: 0, max: 0, currency: 'SGD' };
  }

  // Extract image URL (first transform of first image)
  let imageUrl: string | undefined;
  const firstImage = raw.images?.images?.[0];
  if (firstImage?.transforms?.transforms?.length) {
    imageUrl = firstImage.transforms.transforms[0].url;
  }

  // Location
  const lat = raw.point?.lat ?? SINGAPORE_CENTER.lat;
  const lng = raw.point?.lng ?? SINGAPORE_CENTER.lng;
  const locationName = raw.location?.name ?? raw.location_summary ?? 'Singapore';
  const address = raw.address ?? raw.location_summary ?? 'Singapore';

  // Category inference — prefer EventFinda's own category, fall back to keywords
  const efCategorySlug = raw.category?.url_slug;
  const category = inferCategoryFromEventFinda(raw.name, raw.description, efCategorySlug);

  return {
    id: `ef_${raw.id ?? Math.random().toString(36).slice(2)}`,
    name: raw.name,
    description: (raw.description ?? '').slice(0, 500),
    category,
    location: {
      name: locationName,
      address,
      lat,
      lng,
    },
    timeSlot: {
      start: startDate,
      end: endDate,
    },
    price,
    sourceUrl: raw.url,
    source: 'eventfinda',
    imageUrl,
    availability: 'unknown',
    bookingRequired: !raw.is_free,
  };
}
