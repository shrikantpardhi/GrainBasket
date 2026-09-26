export type Locale = 'en' | 'hi' | 'mr';
export type Kind = 'FLOUR' | 'RICE';
export type Role = 'ADMIN' | 'STAFF';

export interface Session { admin: { id: string; storeId: string; loginName: string }; csrfToken: string }
export interface StoreHour {
  weekday: number; closed: boolean; opensAt: string | null;
  closesAt: string | null; orderCutoffAt: string | null;
}
export interface PickupTime { weekday: number; pickupAt: string }
export interface Rewards {
  pointsPerInr: string; minimumRedemptionPoints: number;
  pointValueInr: string; maximumRedemptionPoints: number;
}
export interface Store {
  id: string; name: string; address: string; contactPhone: string;
  timezone: string; preparationLeadMinutes: number | null; deliveryFee: string | null;
  orderingEnabled: boolean; hours: StoreHour[]; pickupTimes: PickupTime[];
  deliveryPincodes: string[]; rewards: Rewards | null;
}
export interface Category { id: string; kind: Kind; nameEn: string; descriptionEn: string | null; active: boolean }
export interface Product {
  id: string; categoryId: string; nameEn: string; descriptionEn: string | null;
  imageRef: string | null; active: boolean;
}
export interface Variant { id: string; productId: string; weightGrams: number; riceAge: string | null }
export interface Offer {
  storeId: string; variantId: string; priceInr: string; stockOnHand: number;
  stockReserved: number; active: boolean;
}
export interface Translation {
  categoryId: string | null; productId: string | null; language: Locale;
  name: string; description: string | null;
}
export interface Claim { productId: string; kind: 'ORGANIC' | 'NUTRITION'; textEn: string; evidenceRef: string }
export interface Catalog {
  categories: Category[]; products: Product[]; variants: Variant[]; offers: Offer[];
  translations: Translation[]; claims: Claim[];
  ageEvidence: { variantId: string; evidenceRef: string }[];
}
export interface Staff {
  id: string; storeId: string; loginName: string; role: Role; active: boolean; createdAt: string;
}
export interface Overview {
  orders: { total: number; completed: number; cancelled: number; placed: number };
  payments: { attempts: number; cash: number; online_failed: number; refunded: number };
  stock: { offers: number; available: number };
  staff: { active: number }; corrections: { stock: number };
}

let csrf: string | null = null;
export function setCsrf(value: string | null) { csrf = value; }

export async function api<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401 && path !== '/admin/login' && path !== '/admin/session') {
      window.dispatchEvent(new Event('grainbasket:unauthorized'));
    }
    const result: unknown = await response.json().catch(() => null);
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
