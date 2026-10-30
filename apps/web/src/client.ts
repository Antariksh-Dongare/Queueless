export class ApiClientError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiClientError(response.status, body?.error?.message ?? "Request failed. Please try again.");
  return body as T;
}
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const remove = <T>(path: string) => api<T>(path, { method: "DELETE" });
