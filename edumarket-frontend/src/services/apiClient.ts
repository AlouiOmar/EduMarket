/**
 * Shared API transport. Mock-backed domain services remain selected explicitly
 * with VITE_DATA_MODE=mock until their matching backend module is integrated.
 */

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  total?: number;
}

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init?.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch {
    throw Object.assign(new Error('NETWORK_ERROR'), { status: 0, code: 'NETWORK_ERROR' });
  }
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = new Error(payload?.error?.code || 'REQUEST_FAILED');
    Object.assign(error, { status: response.status, code: payload?.error?.code, details: payload?.error?.details });
    throw error;
  }
  return payload as T;
}

/** Downloads an authenticated file (GET by default; `init` allows a POST export such as the grade sheet). */
export async function downloadApiFile(path: string, filename: string, init?: RequestInit): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw Object.assign(new Error(payload?.error?.code || 'DOWNLOAD_FAILED'), { status: response.status, code: payload?.error?.code });
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export const usesApi = import.meta.env.VITE_DATA_MODE === 'api';

export interface Paginated<T> { data: T[]; pagination: { page: number; limit: number; total: number; pages: number } }

export const queryString = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') search.set(key, String(value)); });
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const delay = (ms = 150): Promise<void> => 
  new Promise((resolve) => setTimeout(resolve, ms));

export const createSuccessResponse = <T>(data: T, message?: string, total?: number): ApiResponse<T> => ({
  success: true,
  data,
  message,
  total,
});

export const createErrorResponse = <T>(message: string, fallbackData: T): ApiResponse<T> => ({
  success: false,
  data: fallbackData,
  message,
});

/** Course files are served by the API (`/courses/:id/assets/:assetId`, `/courses/:id/banner`); other URLs are left untouched. */
export const apiAssetUrl = (url?: string) => url && url.startsWith('/courses/') ? `${API_BASE_URL}${url}` : url || '';
