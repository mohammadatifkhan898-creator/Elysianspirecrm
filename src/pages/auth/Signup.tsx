import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSignUp } from '@clerk/react/legacy';
import { ROUTES } from '../../routing/routes';
import { useStore, toast } from '../../store/store';
import { AuthVisual } from '../../components/ui/Overlay';
import { Icon } from '../../components/ui/Icon';
import { ICON } from '../../lib/svg';
import { emailRe } from '../../lib/utils';
import {
  clerkErrorMessage,
  mapSignupError,
  SIGNUP_EMAIL_INVALID_MSG,
  SIGNUP_EMAIL_EXISTS_MSG,
  SIGNUP_PASSWORD_REQ_MSG,
  SIGNUP_PASSWORD_MISMATCH_MSG,
} from './clerkError';
import { GoogleAuthButton } from '../../components/auth/GoogleAuthButton';
import { BrandLockup } from '../../components/ui/BrandLockup';

/* ═══════════════════════════════════════════════════════════════
   Create Account — ported verbatim from the vanilla `#view-signup`
   (custom UI preserved). Includes the mandatory Terms checkbox and
   password strength meter. Credentials are created against Clerk; when
   the instance requires it, an in-app email-code (OTP) verification
   step is shown before the session is activated.
   ═══════════════════════════════════════════════════════════════ */

const STRENGTH_CAPS = ['Weak', 'Fair', 'Good', 'Strong', 'Excellent'];

function passScore(v: string): number {
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 10) score++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
  return score;
}

/* Live password requirements — validated in real time as the user types.
   Aligned with Clerk's default password policy (which the instance enforces
   server-side); mirror it exactly so the checklist never fights the backend. */
interface PasswordRule {
  key: string;
  label: string;
  test: (v: string) => boolean;
}

const PASSWORD_RULES: PasswordRule[] = [
  { key: 'length', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { key: 'upper', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { key: 'lower', label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { key: 'number', label: 'One number', test: (v) => /\d/.test(v) },
  { key: 'special', label: 'One special character', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

/* Small circle shown for an unmet requirement. */
const UNMET_CIRCLE = '<circle cx="12" cy="12" r="5.5"/>';

export function Signup() {
  const navigate = useNavigate();
  const { s, notify } = useStore();
  const { isLoaded, signUp, setActive } = useSignUp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Email-verification (OTP) state, shown only when the instance requires it.
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);

  const score = passScore(pass);

  // Live password requirements — recompute on every keystroke.
  const ruleStates = PASSWORD_RULES.map((r) => ({ ...r, met: r.test(pass) }));
  const allRulesMet = ruleStates.every((r) => r.met);

  // Panel slides open immediately once the field is focused or has content,
  // and collapses again only when the field is both empty and out of focus.
  const passInUse = pass.length > 0 || passFocused;

  // The Create Account button stays disabled until every field is valid.
  const allFieldsValid =
    name.trim().length > 0 &&
    emailRe.test(email) &&
    allRulesMet &&
    confirm.length > 0 &&
    confirm === pass &&
    terms;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    let ok = true;
    if (!name) {
      next.name = 'Full name is required';
      ok = false;
    }
    if (!email) {
      next.email = 'Email is required';
      ok = false;
    } else if (!emailRe.test(email)) {
      next.email = SIGNUP_EMAIL_INVALID_MSG;
      ok = false;
    }
    if (!pass) {
      next.pass = 'Password is required';
      ok = false;
    } else if (!allRulesMet) {
      next.pass = SIGNUP_PASSWORD_REQ_MSG;
      ok = false;
    }
    if (!confirm) {
      next.confirm = 'Please confirm your password';
      ok = false;
    } else if (confirm !== pass) {
      next.confirm = SIGNUP_PASSWORD_MISMATCH_MSG;
      ok = false;
    }
    if (!terms) {
      next.terms = 'You must agree to continue';
      ok = false;
    }
    setErrs(next);
    if (!ok) return;

    if (!isLoaded || !signUp) return;

    setBusy(true);
    try {
      const [firstName = name, ...lastParts] = name.trim().split(/\s+/);
      const res = await signUp.create({
        firstName,
        lastName: lastParts.join(' '),
        emailAddress: email,
        password: pass,
      });

      if (res.status === 'complete' && res.createdSessionId) {
        const rest = 'Elysian Spire';
        s.settings.name = rest;
        notify();
        await setActive({ session: res.createdSessionId });
        toast('Your ' + rest + ' workspace is ready.', 'success', 'Account created');
        navigate(ROUTES.dashboard);
        return;
      }

      // Email (or phone) verification is required → show the in-app OTP step.
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setVerifying(true);
      toast('We sent a verification code to ' + email + '.', 'info', 'Verify your email');
    } catch (err) {
      // Route each Clerk error to the field it belongs to. Errors we can't
      // associate with a specific field surface as a general toast.
      const mapped = mapSignupError(err);
      if (mapped.general) {
        setErrs({});
        toast(mapped.general, 'error', 'Account creation failed');
      } else {
        const fieldErrs: Record<string, string> = {};
        if (mapped.name) fieldErrs.name = mapped.name;
        if (mapped.email) fieldErrs.email = mapped.email;
        if (mapped.pass) fieldErrs.pass = mapped.pass;
        if (mapped.confirm) fieldErrs.confirm = mapped.confirm;
        setErrs(fieldErrs);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUp) return;
    if (!code) {
      setCodeErr('Enter the verification code');
      return;
    }
    setCodeErr('');
    setCodeBusy(true);
    try {
      const res = await signUp.attemptEmailAddressVerification({ code });
      if (res.status === 'complete' && res.createdSessionId) {
        const rest = 'Elysian Spire';
        s.settings.name = rest;
        notify();
        await setActive({ session: res.createdSessionId });
        toast('Your ' + rest + ' workspace is ready.', 'success', 'Account created');
        navigate(ROUTES.dashboard);
      } else {
        setCodeErr('The verification code was not accepted. Please try again.');
      }
    } catch (err) {
      setCodeErr(clerkErrorMessage(err, 'The verification code is incorrect.'));
    } finally {
      setCodeBusy(false);
    }
  };

  const resendCode = async () => {
    if (!signUp) return;
    setCodeErr('');
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      toast('A fresh verification code is on its way to ' + email + '.', 'info', 'Code resent');
    } catch (err) {
      setCodeErr(clerkErrorMessage(err, 'We could not resend the code. Please try again.'));
    }
  };

  const strengthLabel = pass ? 'Strength: ' + STRENGTH_CAPS[score] : 'Password strength';

  return (
    <div className="auth" id="authRoot">
      <section className="auth-section" style={{ display: 'contents' }}>
        <AuthVisual quote={'\u201CA single pane of glass for the art of hospitality.\u201D'} cite="The Elysian Standard" meta="Reservations · Service · Reports · Guests" />
        <div className="auth-panel">
          <div className="auth-card">
            <div className="auth-logo">
              <BrandLockup iconSize={56} />
            </div>

            {verifying ? (
              <>
                <h1 className="auth-h1">Verify your email</h1>
                <p className="auth-sub">
                  Enter the code we sent to <b>{email}</b> to finish setting up your workspace.
                </p>
                <form className="auth-form" noValidate onSubmit={submitCode}>
                  <div className={'field' + (codeErr ? ' invalid' : '')}>
                    <label htmlFor="su_code">Verification Code</label>
                    <input
                      className="input"
                      type="text"
                      id="su_code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                    <span className="err">{codeErr || ''}</span>
                  </div>
                  <button className="btn btn-primary" type="submit" style={{ width: '100%', padding: 12 }} disabled={codeBusy}>
                    <span className="btn-label">{codeBusy ? 'Verifying…' : 'Verify & Create Account'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: '100%', padding: 12, marginTop: 10 }}
                    onClick={resendCode}
                    disabled={codeBusy}
                  >
                    <span className="btn-label">Resend code</span>
                  </button>
                </form>
                <div className="auth-foot">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setVerifying(false);
                      setCode('');
                      setCodeErr('');
                    }}
                  >
                    <Icon d={ICON.arrowLeft} size={14} strokeWidth={1.8} /> Back to details
                  </a>
                </div>
              </>
            ) : (
              <>
                <h1 className="auth-h1">Create your account</h1>
                <p className="auth-sub">Set up your Elysian Spire workspace.</p>
                <form className="auth-form" noValidate onSubmit={submit}>
                  <div className={'field' + (errs.name ? ' invalid' : '')}>
                    <label htmlFor="su_name">Full Name</label>
                    <input className="input" type="text" id="su_name" placeholder="Alexandra Reed" value={name} onChange={(e) => { setName(e.target.value); if (errs.name) setErrs((prev) => ({ ...prev, name: '' })); }} />
                    <span className="err">{errs.name || ''}</span>
                  </div>
                  <div className={'field' + (errs.email ? ' invalid' : '')}>
                    <label htmlFor="su_email">Work Email</label>
                    <input className="input" type="email" id="su_email" placeholder="you@restaurant.com" value={email} onChange={(e) => { setEmail(e.target.value); if (errs.email) setErrs((prev) => ({ ...prev, email: '' })); }} />
                    <span className="err">
                      {errs.email === SIGNUP_EMAIL_EXISTS_MSG ? (
                        <>
                          An account with this email already exists.{' '}
                          <a
                            className="err-link"
                            href={'#' + ROUTES.login}
                            onClick={(e) => { e.preventDefault(); navigate(ROUTES.login); }}
                          >
                            Sign in instead
                          </a>
                        </>
                      ) : (errs.email || '')}
                    </span>
                  </div>
                  <div className={'field' + (errs.pass ? ' invalid' : '')}>
                    <label htmlFor="su_password">Password</label>
                    <div className="password-wrap">
                      <input
                        className="input"
                        type={showPass ? 'text' : 'password'}
                        id="su_password"
                        placeholder="Create a strong password"
                        value={pass}
                        onFocus={() => setPassFocused(true)}
                        onBlur={() => setPassFocused(false)}
                        onChange={(e) => { setPass(e.target.value); if (errs.pass) setErrs((prev) => ({ ...prev, pass: '' })); }}
                      />
                      <button type="button" className="pw-toggle" aria-label="Toggle password visibility" onClick={() => setShowPass((v) => !v)}>
                        <Icon d={showPass ? ICON.eyeOff : ICON.eye} strokeWidth={1.7} />
                      </button>
                    </div>
                    <div className="strength">
                      <div className="strength-bar">
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            style={{
                              background: i < score ? (i < 3 ? '#B98A3C' : '#4E7A5A') : 'var(--sand)',
                            }}
                          ></span>
                        ))}
                      </div>
                      <div className="strength-label">{strengthLabel}</div>
                    </div>
                    <div className={'pw-reqs' + (passInUse ? ' pw-open' : '')} id="pw_reqs" aria-hidden={!passInUse}>
                      <div className="pw-reqs-inner">
                        <div className="pw-reqs-box">
                          {ruleStates.map((r) => (
                            <div key={r.key} className={'pw-req' + (r.met ? ' met' : '')}>
                              <span className="req-ico">
                                {r.met ? (
                                  <Icon d={ICON.check} size={13} strokeWidth={2.6} />
                                ) : (
                                  <Icon d={UNMET_CIRCLE} size={13} strokeWidth={2} />
                                )}
                              </span>
                              <span>{r.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <span className="err">{errs.pass || ''}</span>
                  </div>
                  <div className={'field' + (errs.confirm ? ' invalid' : '')}>
                    <label htmlFor="su_confirm">Confirm Password</label>
                    <div className="password-wrap">
                      <input
                        className="input"
                        type={showConfirm ? 'text' : 'password'}
                        id="su_confirm"
                        placeholder="Re-enter your password"
                        value={confirm}
                        onChange={(e) => { setConfirm(e.target.value); if (errs.confirm) setErrs((prev) => ({ ...prev, confirm: '' })); }}
                      />
                      <button type="button" className="pw-toggle" aria-label="Toggle password visibility" onClick={() => setShowConfirm((v) => !v)}>
                        <Icon d={showConfirm ? ICON.eyeOff : ICON.eye} strokeWidth={1.7} />
                      </button>
                    </div>
                    <span className="err">{errs.confirm || ''}</span>
                  </div>
                  <div className={'field' + (errs.terms ? ' invalid' : '')}>
                    <label className="checkbox" style={{ alignItems: 'flex-start', lineHeight: 1.4 }}>
                      <input type="checkbox" id="su_terms" style={{ marginTop: 2 }} checked={terms} onChange={(e) => { setTerms(e.target.checked); if (errs.terms) setErrs((prev) => ({ ...prev, terms: '' })); }} />
                      <span>
                        I agree to the <a className="link" href="#">Terms</a> and <a className="link" href="#">Privacy Policy</a>
                      </span>
                    </label>
                    <span className="err">{errs.terms || ''}</span>
                  </div>
                  <button className="btn btn-primary" type="submit" style={{ width: '100%', padding: 12 }} disabled={busy || !isLoaded || !allFieldsValid}>
                    <span className="btn-label">{busy ? 'Creating account…' : 'Create Account'}</span>
                  </button>
                </form>
                <div className="auth-divider" role="separator" aria-label="or">
                  <span className="auth-divider-line" />
                  <span className="auth-divider-text">or</span>
                  <span className="auth-divider-line" />
                </div>
                <GoogleAuthButton mode="signup" redirectUrl={ROUTES.dashboard} />
              </>
            )}

            {!verifying && (
              <div className="auth-foot">
                Already have an account?{' '}
                <a href={'#' + ROUTES.login} onClick={(e) => { e.preventDefault(); navigate(ROUTES.login); }}>
                  Sign In
                </a>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
