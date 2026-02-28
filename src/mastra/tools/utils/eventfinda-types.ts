export interface EventFindaSession {
  timezone?: string;
  datetime_start?: string;
  datetime_end?: string;
  is_cancelled?: boolean;
}

export interface EventFindaCategory {
  id?: number;
  name?: string;
  url_slug?: string;
}

export interface EventFindaLocation {
  id?: number;
  name?: string;
  summary?: string;
}

export interface EventFindaImage {
  id?: number;
  transforms?: {
    transforms?: Array<{
      url?: string;
      width?: number;
      height?: number;
    }>;
  };
}

export interface EventFindaTicketType {
  name?: string;
  price?: string;
  is_free?: boolean;
}

export interface EventFindaEvent {
  id?: number;
  name?: string;
  description?: string;
  url?: string;
  url_slug?: string;
  address?: string;
  location_summary?: string;
  datetime_start?: string;
  datetime_end?: string;
  datetime_summary?: string;
  is_free?: boolean;
  is_featured?: boolean;
  is_cancelled?: boolean;
  restrictions?: string;
  point?: {
    lat?: number;
    lng?: number;
  };
  category?: EventFindaCategory;
  location?: EventFindaLocation;
  images?: {
    images?: EventFindaImage[];
  };
  sessions?: {
    sessions?: EventFindaSession[];
  };
  ticket_types?: {
    ticket_types?: EventFindaTicketType[];
  };
}

export interface EventFindaApiResponse {
  '@attributes'?: {
    count?: number;
  };
  events?: EventFindaEvent[];
}
