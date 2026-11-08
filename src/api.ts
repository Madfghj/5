import { Capacitor } from '@capacitor/core';
import { desktop, publicHttpsOrigin } from './desktop';
import type { Provider, Snapshot, User } from './types';
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const native = Capacitor.isNativePlatform();
export class ApiError extends Error { code: string; status: number; constructor(message: string, code: string, status: number) { super(message); this.code=code; this.status=status; } }
export async function api<T>(path: string, token?: string | null, body?: unknown, method?: string): Promise<T> {
  if(native && !API_BASE) throw new ApiError('Native API URL is not configured', 'native_api_missing', 503);
  if(desktop && !publicHttpsOrigin(API_BASE)) throw new ApiError('Desktop API URL is not configured with a public HTTPS origin', 'native_api_missing', 503);
  const response = await fetch(`${API_BASE}/api${path}`, { method:method || (body === undefined ? 'GET':'POST'), headers: { ...(body !== undefined ? {'Content-Type':'application/json'}:{}), ...(token ? {Authorization:`Bearer ${token}`}:{}) }, ...(body !== undefined ? {body:JSON.stringify(body)}:{}) });
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new ApiError(data.error || `HTTP ${response.status}`,data.code || 'request_failed',response.status);
  return data as T;
}
export const getState = (token: string) => api<Snapshot>('/state',token);
export const providers = () => api<Provider[]>('/auth/providers');
export const createSession = (name: string, locale: string) => api<{token:string;user:User}>('/session',null,{name,locale});
export async function live(_token: string, signal: AbortSignal, change: ()=>Promise<boolean>, connection: (value:boolean)=>void) {
  while(!signal.aborted) {
    try { const ok=await change(); if(!signal.aborted) connection(ok); }
    catch { if(!signal.aborted) connection(false); }
    if(signal.aborted) return;
    await new Promise<void>(resolve=>{ const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,5000);signal.addEventListener('abort',done,{once:true}); });
  }
}
