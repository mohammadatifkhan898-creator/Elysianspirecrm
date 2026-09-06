/* ═══════════════════════════════════════════════════════════════
   Clerk error helpers — map raw Clerk errors to safe, human-friendly
   messages for the custom auth UI. Never echoes the password or any raw
   API payload to the page.

   Clerk throws structured errors of the shape:
     { errors: ClerkAPIError[] }
   where each ClerkAPIError is:
     { code: string; message: string; longMessage?: string;
       meta?: { paramName?: string; ... } }

   We key off the error `code` (and `meta.paramName` as a fallback) rather
   than random message text, so the mapping stays correct across locales
   and backend rewording.
   ═══════════════════════════════════════════════════════════════ */

export interface ClerkApiError {
  code: string;
  message?: string;
  longMessage?: string;
  meta?: { paramName?: string };
}

export interface ClerkErrLike {
  errors?: ClerkApiError[];
}

/** Pull the flat list of Clerk API errors out of any thrown value. */
export function parseClerkErrors(err: unknown): ClerkApiError[] {
  if (!err) return [];
  const e = err as ClerkErrLike;
  const list = Array.isArray(e?.errors) ? e.errors : [];
  return list.filter((x): x is ClerkApiError => Boolean(x && typeof x.code === 'string'));
}

/** Best-effort readable message from a thrown Clerk error. */
export function clerkErrorMessage(err: unknown, fallback: string): string {
  const first = parseClerkErrors(err)[0];
  const msg = first?.longMessage || first?.message;
  return msg && msg.trim() ? msg.trim() : fallback;
}

/* ── Friendly, user-safe messages (Task: clean UX, no scary terms) ── */
export const SIGNUP_EMAIL_INVALID_MSG = 'Please enter a valid email address.';
export const SIGNUP_EMAIL_EXISTS_MSG = 'An account with this email already exists. Please sign in instead.';
export const SIGNUP_PASSWORD_SECURITY_MSG = 'For your security, please choose a different password.';
export const SIGNUP_PASSWORD_REQ_MSG = 'Please make sure your password meets all the requirements.';
export const SIGNUP_PASSWORD_MISMATCH_MSG = 'Passwords do not match.';
export const SIGNUP_GENERIC_MSG = 'Unable to create your account. Please try again.';

/** Result of mapping one Clerk error onto the Signup form's fields. */
export interface SignupFieldErrors {
  name?: string;
  email?: string;
  pass?: string;
  confirm?: string;
  general?: string;
}

/**
 * Clerk error codes that a password violates the configured security/breach rules.
 * `form_password_pwned`  → found in the HaveIBeenPwned breach corpus.
 * `form_password_compromised` → known to be compromised.
 * Both must read as a neutral "choose a different password", never as
 * scary breach/security terminology.
 */
const PASSWORD_SECURITY_CODES = new Set([
  'form_password_pwned',
  'form_password_compromised',
  'form_password_breached',
]);

/** Codes for a password that fails the configured length/complexity rules. */
const PASSWORD_REQUIREMENT_CODES = new Set([
  'form_password_length_too_short',
  'form_password_too_short',
  'form_password_length_too_long',
  'form_password_too_long',
  'form_password_requirements_not_met',
  'form_password_incorrect',
]);

/** Codes meaning an account already exists for the entered email. */
const EMAIL_EXISTS_CODES = new Set([
  'form_identifier_exists',
  'form_email_address_exists',
  'form_email_address_already_exists',
  'email_address_exists',
]);

/** Codes meaning the email (or identifier) is malformed. */
const EMAIL_INVALID_CODES = new Set([
  'form_param_format_invalid',
  'form_identifier_invalid',
  'form_email_address_invalid',
  'form_param_nil',
]);

/**
 * Map a thrown Clerk error onto the Signup fields. Prefer `code`, fall back
 * to `meta.paramName` so an unrecognised code that targets a known field
 * still lands under the correct input instead of being dumped on the email.
 */
export function mapSignupError(err: unknown): SignupFieldErrors {
  const errors = parseClerkErrors(err);
  if (errors.length === 0) return { general: SIGNUP_GENERIC_MSG };

  const result: SignupFieldErrors = {};

  for (const e of errors) {
    const param = (e.meta?.paramName ?? '').toLowerCase();

    if (PASSWORD_SECURITY_CODES.has(e.code)) {
      result.pass = SIGNUP_PASSWORD_SECURITY_MSG;
      continue;
    }
    if (PASSWORD_REQUIREMENT_CODES.has(e.code)) {
      result.pass = SIGNUP_PASSWORD_REQ_MSG;
      continue;
    }
    if (EMAIL_EXISTS_CODES.has(e.code)) {
      result.email = SIGNUP_EMAIL_EXISTS_MSG;
      continue;
    }
    if (EMAIL_INVALID_CODES.has(e.code)) {
      if (param.includes('password') || param.includes('confirm')) {
        result.pass = SIGNUP_PASSWORD_REQ_MSG;
      } else {
        result.email = SIGNUP_EMAIL_INVALID_MSG;
      }
      continue;
    }

    // Unknown code — try to route by the field it targets.
    if (param.includes('email')) {
      result.email = SIGNUP_EMAIL_INVALID_MSG;
      continue;
    }
    if (param.includes('password') || param.includes('confirm')) {
      result.pass = SIGNUP_PASSWORD_REQ_MSG;
      continue;
    }
    if (param.includes('name')) {
      result.name = 'Please enter your full name.';
      continue;
    }

    // Cannot be associated with a specific field.
    result.general = SIGNUP_GENERIC_MSG;
  }

  return result;
}
