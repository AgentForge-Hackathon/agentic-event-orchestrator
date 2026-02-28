import type { Event } from '../../../types/index.js';
import type { EventbriteJsonLdEvent, EventbriteJsonLdOffer } from './eventbrite-types.js';
import { inferCategory } from './category.js';
export function generateEventId(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `eb_${Math.abs(hash).toString(36)}`;
}

export function normalizeOffers(
  offers: EventbriteJsonLdOffer | EventbriteJsonLdOffer[] | undefined,
): EventbriteJsonLdOffer | undefined {
  if (!offers) return undefined;
  if (Array.isArray(offers)) {
    return offers[0];
  }
  return offers;
}

export function mapToEvent(raw: EventbriteJsonLdEvent): Event | null {
  if (!raw.name || !raw.url) return null;

  const location = raw.location;
  const address = location?.address;
  const geo = location?.geo;

  const startDate = raw.startDate ?? new Date().toISOString();
  const endDate = raw.endDate ?? new Date(Date.parse(startDate) + 2 * 60 * 60 * 1000).toISOString();

  const offer = normalizeOffers(raw.offers);
  let price: Event['price'] | undefined;
  if (offer) {
    const lowPrice = parseFloat(offer.lowPrice ?? offer.price ?? '');
    const highPrice = parseFloat(offer.highPrice ?? offer.price ?? '');
    const hasLow = !isNaN(lowPrice);
    const hasHigh = !isNaN(highPrice);
    if (hasLow || hasHigh) {
      price = {
        min: hasLow ? lowPrice : 0,
        max: hasHigh ? highPrice : lowPrice,
        currency: offer.priceCurrency ?? 'SGD',
      };
    }
  }

  // Schema.org availability values: InStock, LimitedAvailability, SoldOut, PreOrder, etc.
  let availability: Event['availability'] = 'unknown';
  if (offer?.availability) {
    const avail = offer.availability.toLowerCase();
    if (avail.includes('instock') || avail.includes('available')) {
      availability = 'available';
    } else if (avail.includes('limited')) {
      availability = 'limited';
    } else if (avail.includes('soldout') || avail.includes('sold_out')) {
      availability = 'sold_out';
    }
  }

  return {
    id: generateEventId(raw.url),
    name: raw.name,
    description: (raw.description ?? '').slice(0, 500),
    category: inferCategory(raw.name, raw.description),
    location: {
      name: location?.name ?? 'Singapore',
      address: address
        ? [address.streetAddress, address.addressLocality, address.postalCode]
            .filter(Boolean)
            .join(', ')
        : 'Singapore',
      lat: geo?.latitude ?? 1.3521,
      lng: geo?.longitude ?? 103.8198,
    },
    timeSlot: {
      start: startDate,
      end: endDate,
    },
    price,
    sourceUrl: raw.url,
    source: 'eventbrite',
    imageUrl: raw.image ?? undefined,
    availability,
    bookingRequired: true,
  };
}

