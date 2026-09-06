/* ═══════════════════════════════════════════════════════════════
   Shared service-layer conventions (Phase 4B — Step 3).

   Every CRM service function in Phase 4B follows these rules:
     - AUTH: uses the token-aware client (Clerk session on every
       request, see lib/supabase.ts). The anon/service_roles keys are
       NEVER used. If it is not configured, the caller bails early.
     - TENANCY: derived by RLS from the caller's profile. Services
       NEVER accept or send a client-supplied `restaurant_id`.
     - RESPONSE: every call returns a discriminated union
       `ServiceResult<T>` = `{ ok: true, data: T } | { ok: false,
       error: ServiceError }`. This keeps loading/error handling
       uniform across consumers.
     - ERROR: PostgREST errors are normalized via `toServiceError` to
       a stable `code` + message, so UI and logging can branch on it.
     - LOADING: consumers model loading locally (a `loading` flag on
       hooks); the service itself is asynchronous and returns a result.
     - IDS: row primary keys are UUIDs (or TEXT for profiles.id). The
       public display codes (orders.code, reservations.code,
       restaurant_tables.label) are SEPARATE columns and are never used
       as keys in the service layer.
   ═══════════════════════════════════════════════════════════════ */

export type ServiceErrorCode =
  | 'NOT_CONFIGURED'
  | 'NETWORK'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'UNKNOWN';

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
  /** Raw PostgREST error, present for diagnostics only (never the UI). */
  raw?: unknown;
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceError };

/** Friendly message for common permission / access errors. Never exposes internal slugs or PostgREST text. */
function friendlyPermissionMsg(): string {
  return "You don't have permission to perform this action. Please contact a manager or administrator.";
}

/** Build a normalized ServiceError from an unknown thrown/PostgREST value. */
export function toServiceError(err: unknown): ServiceError {
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string; details?: string };
    const rawMessage = e.message || 'An unexpected error occurred.';
    let code: ServiceErrorCode = 'UNKNOWN';
    let message = rawMessage;

    if (e.code === 'PGRST116') {
      code = 'NOT_FOUND';
    } else if (e.code === '42501') {
      code = 'FORBIDDEN';
      message = friendlyPermissionMsg();
    } else if (/failed|network|fetch|ECONN/i.test(rawMessage)) {
      code = 'NETWORK';
    } else if (/row-level security/i.test(rawMessage)) {
      code = 'FORBIDDEN';
      message = friendlyPermissionMsg();
    }

    return { code, message, raw: { message: rawMessage, code: e.code, details: e.details } };
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : 'An unexpected error occurred.',
    raw: err,
  };
}

/** Shortcut for the "Supabase not configured / client missing" case. */
export const NOT_CONFIGURED: ServiceError = {
  code: 'NOT_CONFIGURED',
  message: 'Supabase is not configured. Please check your environment.',
};
