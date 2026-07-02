import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

const TOKEN_KEY = "auth_token";

export async function saveToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}
export async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}
export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

async function request<T = any>(
  method: string,
  path: string,
  body?: any,
  auth: boolean = true,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const tok = await getToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || res.statusText || "Request failed";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, body?: any, auth: boolean = true) =>
    request<T>("POST", p, body, auth),
  put: <T = any>(p: string, body?: any) => request<T>("PUT", p, body),
  del: <T = any>(p: string) => request<T>("DELETE", p),
};
