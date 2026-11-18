export interface Me {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'email_unverified' | 'pending_approval' | 'approved' | 'rejected' | 'suspended' | 'banned';
  full_name: string;
  phone: string;
  location: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  is_seller: boolean;
  can_chat: boolean;
}

export interface Counts {
  unread_notifications: number;
  unread_messages: number;
}

export interface ListingCard {
  id: string;
  slug: string;
  title: string;
  price: number;
  currency: string;
  negotiable: boolean;
  location: string;
  condition: string;
  status: string;
  availability: string;
  is_featured: boolean;
  published_at: string | null;
  created_at: string;
  category: { name: string; slug: string };
  seller: { id: string; name: string; verified: boolean };
  image: string | null;
  is_favorite: boolean;
}

export interface ListingDetail extends ListingCard {
  description: string;
  category_id: string;
  subcategory_id: string | null;
  subcategory: { name: string; slug: string } | null;
  contact_phone: string | null;
  video_url: string | null;
  view_count: number;
  expires_at: string | null;
  sold_at: string | null;
  status_note?: string | null;
  images: { id: string; url: string; thumb: string; width: number; height: number }[];
  seller: ListingCard['seller'] & {
    avatar_url: string | null;
    location: string | null;
    member_since: string;
    active_listings: number;
    sold_listings: number;
  };
  is_owner: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  image_url: string | null;
  listing_count: number;
  subcategories: { id: string; name: string; slug: string }[];
}

export interface PublicSettings {
  site: {
    name: string;
    tagline: string;
    logo_url: string;
    favicon_url: string;
    primary_color: string;
    accent_color: string;
    default_currency: string;
    default_location: string;
    locations: string[];
  };
  contact: { email: string; phone: string; address: string; whatsapp: string };
  payments: { bank_transfer_enabled: boolean; gateway_enabled: boolean };
  listings: { max_images: number };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}
