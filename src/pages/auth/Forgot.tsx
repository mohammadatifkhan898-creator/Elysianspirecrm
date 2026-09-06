import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSignIn } from '@clerk/react/legacy';
import { ROUTES } from '../../routing/routes';
import { toast } from '../../store/store';
import { AuthVisual } from '../../components/ui/Overlay';
import { ICON } from '../../lib/svg';
import { Icon } from '../../components/ui/Icon';
import { emailRe } from '../../lib/utils';
import { clerkErrorMessage } from './clerkError';
import { BrandLockup } from '../../components/ui/BrandLockup';

/* ═══════════════════════════════════════════════════════════════
   Forgot Password — ported from the vanilla `#view-forgot` (custom UI
   preserved) and wired to the Clerk reset-password custom flow. The
   three in-app steps mirror the original send-link pattern:
     1) request reset by email  → 2) enter the emailed code  → 3) set a new password.
   ═══════════════════════════════════════════════════════════════ */

type ForgotStep = 'email' | 'code' | 'newpass' | 'done';

export function Forgot() {
  const navigate = useNavigate();
  const { isLoaded, signIn, setActive } = useSignIn();

  const [step, setStep] = useState<ForgotStep>('email');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);

  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [passErr, setPassErr] = useState('');
  const [passBusy, setPassBusy] = useState(false);

  /** Step 1 — request a reset by identifier. */
  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setErr('Email is required');
      return;
    }
    if (!emailRe.test(email)) {
      setErr('Enter a valid email');
      return;
    }
    if (!isLoaded || !signIn) return;
    setErr('');
    setBusy(true);
    try {
      await signIn.create({ identifier: email });
      const factor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === 'reset_password_email_code'
      );
      if (!factor?.emailAddressId) {
        throw new Error('reset_code_unavailable');
      }
      await signIn.prepareFirstFactor({
        strategy: 'reset_password_email_code',
        emailAddressId: factor.emailAddressId,
      });
      setStep('code');
      toast('If an account exists, a reset code is on its way.', 'info', 'Check your inbox');
    } catch (resErr) {
      setErr(
        clerkErrorMessage(
          resErr,
          'We could not send a reset link to that address. Please try again.'
        )
      );
    } finally {
      setBusy(false);
    }
  };

  /** Step 2 — verify the emailed code. */
  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signIn) return;
    if (!code) {
      setCodeErr('Enter the verification code');
      return;
    }
    setCodeErr('');
    setCodeBusy(true);
    try {
      await signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code });
      setStep('newpass');
      toast('Code verified. Now choose a new password.', 'success', 'Verified');
    } catch (resErr) {
      setCodeErr(clerkErrorMessage(resErr, 'The verification code is incorrect.'));
    } finally {
      setCodeBusy(false);
    }
  };

  /** Step 3 — set and confirm the new password, then activate the session. */
  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signIn) return;
    if (pass.length < 8) {
      setPassErr('Use at least 8 characters');
      return;
    }
    if (confirm !== pass) {
      setPassErr('Passwords do not match');
      return;
    }
    setPassErr('');
    setPassBusy(true);
    try {
      const res = await signIn.resetPassword({ password: pass });
      if (res.status === 'complete' && res.createdSessionId) {
        await setActive({ session: res.createdSessionId });
        setStep('done');
        toast('Your password has been reset.', 'success', 'Password updated');
      } else {
        setPassErr(clerkErrorMessage(res, 'We could not reset your password. Please try again.'));
      }
    } catch (resErr) {
      setPassErr(clerkErrorMessage(resErr, 'We could not reset your password. Please try again.'));
    } finally {
      setPassBusy(false);
    }
  };

  return (
    <div className="auth" id="authRoot">
      <section className="auth-section" style={{ display: 'contents' }}>
        <AuthVisual quote={'\u201CEvery guest matters — and so does every password.\u201D'} cite="The Elysian Standard" meta="Secure access · Account recovery · Service continuity" />
        <div className="auth-panel">
          <div className="auth-card">
            <div className="auth-logo">
              <BrandLockup iconSize={56} />
            </div>

            {step === 'email' && (
              <>
                <h1 className="auth-h1">Reset your password</h1>
                <p className="auth-sub">Enter your email and we'll send a reset code.</p>
                <form className="auth-form" noValidate onSubmit={requestReset}>
                  <div className={'field' + (err ? ' invalid' : '')}>
                    <label htmlFor="fg_email">Email Address</label>
                    <input className="input" type="email" id="fg_email" autoComplete="email" placeholder="you@elysianspire.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <span className="err">{err || ''}</span>
                  </div>
                  <button className="btn btn-primary" type="submit" style={{ width: '100%', padding: 12 }} disabled={busy || !isLoaded}>
                    <span className="btn-label">{busy ? 'Sending…' : 'Send Reset Code'}</span>
                  </button>
                </form>
              </>
            )}

            {step === 'code' && (
              <>
                <h1 className="auth-h1">Check your email</h1>
                <p className="auth-sub">
                  Enter the code we sent to <b>{email}</b> to continue resetting your password.
                </p>
                <form className="auth-form" noValidate onSubmit={verifyCode}>
                  <div className={'field' + (codeErr ? ' invalid' : '')}>
                    <label htmlFor="fg_code">Reset Code</label>
                    <input className="input" type="text" id="fg_code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                    <span className="err">{codeErr || ''}</span>
                  </div>
                  <button className="btn btn-primary" type="submit" style={{ width: '100%', padding: 12 }} disabled={codeBusy}>
                    <span className="btn-label">{codeBusy ? 'Verifying…' : 'Verify Code'}</span>
                  </button>
                </form>
              </>
            )}

            {step === 'newpass' && (
              <>
                <h1 className="auth-h1">Choose a new password</h1>
                <p className="auth-sub">Set a strong password for your Elysian Spire account.</p>
                <form className="auth-form" noValidate onSubmit={resetPassword}>
                  <div className={'field' + (passErr ? ' invalid' : '')}>
                    <label htmlFor="fg_pass">New Password</label>
                    <div className="password-wrap">
                      <input
                        className="input"
                        type={showPass ? 'text' : 'password'}
                        id="fg_pass"
                        autoComplete="new-password"
                        placeholder="Create a strong password"
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
                    <span className="err">{passErr || ''}</span>
                  </div>
                  <div className="field">
                    <label htmlFor="fg_confirm">Confirm New Password</label>
                    <input
                      className="input"
                      type={showPass ? 'text' : 'password'}
                      id="fg_confirm"
                      autoComplete="new-password"
                      placeholder="Re-enter your password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-primary" type="submit" style={{ width: '100%', padding: 12 }} disabled={passBusy}>
                    <span className="btn-label">{passBusy ? 'Updating…' : 'Update Password'}</span>
                  </button>
                </form>
              </>
            )}

            {step === 'done' && (
              <>
                <h1 className="auth-h1">Password updated</h1>
                <p className="auth-sub">Your password has been reset and you are signed in again.</p>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: 12 }}
                  onClick={() => navigate(ROUTES.dashboard)}
                >
                  <span className="btn-label">Go to Dashboard</span>
                </button>
              </>
            )}

            {step !== 'done' && (
              <div className="auth-foot">
                <a
                  href={'#' + ROUTES.login}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(ROUTES.login);
                  }}
                >
                  <Icon d={ICON.arrowLeft} size={14} strokeWidth={1.8} /> Back to Sign In
                </a>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
