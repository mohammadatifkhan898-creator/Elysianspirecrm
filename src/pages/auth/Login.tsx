import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSignIn } from '@clerk/react/legacy';
import { ROUTES } from '../../routing/routes';
import { toast } from '../../store/store';
import { AuthVisual } from '../../components/ui/Overlay';
import { Icon } from '../../components/ui/Icon';
import { ICON } from '../../lib/svg';
import { emailRe, nameFromEmail } from '../../lib/utils';
import { clerkErrorMessage } from './clerkError';
import { GoogleAuthButton } from '../../components/auth/GoogleAuthButton';
import { BrandLockup } from '../../components/ui/BrandLockup';

/* ═══════════════════════════════════════════════════════════════
   Sign In — ported verbatim from the vanilla `#view-login` (custom
   auth UI preserved). Credentials now authenticate against Clerk via
   the custom-flow `useSignIn()` hook — Clerk is the single auth
   authority. On success the returned session is set active, which lets
   the route guards and `s.user` mirror react accordingly.
   ═══════════════════════════════════════════════════════════════ */

export function Login() {
  const navigate = useNavigate();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [errs, setErrs] = useState<{ email?: string; pass?: string }>({});
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: { email?: string; pass?: string } = {};
    let ok = true;
    if (!email) {
      next.email = 'Email is required';
      ok = false;
    } else if (!emailRe.test(email)) {
      next.email = 'Enter a valid email address';
      ok = false;
    }
    if (!pass) {
      next.pass = 'Password is required';
      ok = false;
    }
    setErrs(next);
    if (!ok) return;

    if (!isLoaded || !signIn) return;

    setFormErr('');
    setBusy(true);
    try {
      const res = await signIn.create({ identifier: email, password: pass });
      if (res.status === 'complete' && res.createdSessionId) {
        await setActive({ session: res.createdSessionId });
        const first = res.userData?.firstName || nameFromEmail(email).split(' ')[0];
        toast('Welcome back, ' + first + '. Have a great service today!', 'success', 'Signed in');
        navigate(ROUTES.dashboard);
      } else {
        // Multi-factor or an additional step is required. The prebuilt flow
        // handles these; keep the user informed rather than failing silently.
        setFormErr(
          'Additional verification is required for this account. Please complete your sign-in through the normal flow, then try again.'
        );
        toast('This account requires additional verification.', 'error', 'Sign in failed');
      }
    } catch (err) {
      const fallback =
        'The email or password you entered is incorrect. Check your credentials and try again.';
      setFormErr(clerkErrorMessage(err, fallback));
      setErrs({ pass: 'Incorrect email or password.' });
      toast('We could not sign you in with those credentials.', 'error', 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth" id="authRoot">
      <section className="auth-section" style={{ display: 'contents' }}>
        <AuthVisual quote={'\u201CWhere every table tells a story, and every guest returns for the second chapter.\u201D'} cite="The Elysian Standard" meta="Fine dining operations · Reservations · Service excellence" />
        <div className="auth-panel">
          <div className="auth-card">
            <div className="auth-logo">
              <BrandLockup iconSize={56} />
            </div>
            <h1 className="auth-h1">Welcome back</h1>
            <p className="auth-sub">Sign in to manage your restaurant operations.</p>
            <form className="auth-form" noValidate onSubmit={submit}>
              <div className={'field' + (errs.email ? ' invalid' : '')}>
                <label htmlFor="login_email">Email Address</label>
                <input
                  className="input"
                  type="email"
                  id="login_email"
                  autoComplete="email"
                  placeholder="you@elysianspire.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <span className="err">{errs.email || ''}</span>
              </div>
              <div className={'field' + (errs.pass ? ' invalid' : '')}>
                <label htmlFor="login_password">Password</label>
                <div className="password-wrap">
                  <input
                    className="input"
                    type={showPass ? 'text' : 'password'}
                    id="login_password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    aria-label="Toggle password visibility"
                    onClick={() => setShowPass((v) => !v)}
                  >
                    <Icon d={showPass ? ICON.eyeOff : ICON.eye} strokeWidth={1.7} />
                  </button>
                </div>
                <span className="err">{errs.pass || ''}</span>
              </div>
              <div className="auth-options">
                <label className="checkbox">
                  <input type="checkbox" id="remember" defaultChecked /> Remember me
                </label>
                <a className="link" href={'#' + ROUTES.forgot} onClick={(e) => { e.preventDefault(); navigate(ROUTES.forgot); }}>
                  Forgot password?
                </a>
              </div>
              <button className="btn btn-primary" type="submit" style={{ width: '100%', padding: 12 }} disabled={busy || !isLoaded}>
                <span className="btn-label">{busy ? 'Signing in…' : 'Sign In'}</span>
              </button>
              {formErr ? <div className="auth-error">{formErr}</div> : null}
            </form>
            <div className="auth-divider" role="separator" aria-label="or">
              <span className="auth-divider-line" />
              <span className="auth-divider-text">or</span>
              <span className="auth-divider-line" />
            </div>
            <GoogleAuthButton mode="signin" redirectUrl={ROUTES.dashboard} />
            <div className="auth-foot">
              Don't have an account?{' '}
              <a href={'#' + ROUTES.signup} onClick={(e) => { e.preventDefault(); navigate(ROUTES.signup); }}>
                Create account
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
