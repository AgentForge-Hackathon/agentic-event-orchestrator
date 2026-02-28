export interface EventbriteJsonLdOffer {
  price?: string;
  priceCurrency?: string;
  lowPrice?: string;
  highPrice?: string;
  availability?: string;
}

export interface EventbriteJsonLdEvent {
  name?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  url?: string;
  image?: string;
  location?: {
    name?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      postalCode?: string;
      addressCountry?: string;
    };
    geo?: {
      latitude?: number;
      longitude?: number;
    };
  };
  offers?: EventbriteJsonLdOffer | EventbriteJsonLdOffer[];
  eventAttendanceMode?: string;
}
