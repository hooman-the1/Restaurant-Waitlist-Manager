import { InjectionToken } from '@angular/core';

export const API_BASE_URL = new InjectionToken<string>('ApiBaseUrl');
export const LOCAL_API_BASE_URL = 'http://localhost:8000';

export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
