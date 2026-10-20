import { api, okSchema } from '../../shared/api/client';
import { sessionSchema } from '../../shared/contracts/identity';
export const authService = {
  demo: () => api('/auth/demo', sessionSchema, { method: 'POST' }),
  completeReset: (body: { token: string; password: string }) =>
    api('/auth/reset/complete', okSchema, { method: 'POST', body }),
  session: (signal?: AbortSignal) => api('/auth/session', sessionSchema, { signal }),
  login: (body: { email: string; password: string }) =>
    api('/auth/login', sessionSchema, { method: 'POST', body }),
  logout: () => api('/auth/logout', okSchema, { method: 'POST' }),
  reset: (email: string) => api('/auth/reset', okSchema, { method: 'POST', body: { email } }),
};
