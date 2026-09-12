import { randomUUID } from 'node:crypto';

export type UuidSource = () => string;

export function normalizeRestaurantDisplayName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function normalizeRestaurantNameForComparison(value: string): string {
  return normalizeRestaurantDisplayName(value).toLowerCase();
}

export function normalizeEmailForComparison(value: string): string {
  return value.trim().toLowerCase();
}

export function generateRestaurantSlug(value: string): string {
  return normalizeRestaurantDisplayName(value)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{Nd}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

export function normalizePhoneForComparison(value: string): string {
  return value.replace(/[\u0020()\-]/g, '');
}

export function generateRestaurantVerificationToken(
  source: UuidSource = randomUUID,
): string {
  return source();
}

export function generatePrivateStatusToken(
  source: UuidSource = randomUUID,
): string {
  return source();
}

export function generateActionReference(
  source: UuidSource = randomUUID,
): string {
  return source();
}
