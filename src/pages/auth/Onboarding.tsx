/* Onboarding — first restaurant setup for a new Owner (Phase 2B).

   Rendered on the dedicated /onboarding route, only reachable when signed in
   (it lives inside RequireAuth). Collects a restaurant name (required) plus
   optional email/phone, then calls the atomic provision_owner RPC (migration
   0002). The submit button is disabled while a request is in flight, and the
   RPC itself is idempotent (profiles.id PK + in-function guard), so duplicate
   clicks/retries cannot double-provision.

   Identity is NOT supplied by this form — Clerk is the single auth authority
   and the server derives the profile id from auth.jwt()->>'sub'. The name/
   email passed are display/auxiliary values only. */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/react';
import { useSupabase } from '../../lib/useSupabase';
import { getProfileState, provisionRestaurant } from '../../services';
import { ROUTES } from '../../routing/routes';
import { toast } from '../../store/store';
import { emailRe } from '../../lib/utils';
import { BrandLockup } from '../../components/ui/BrandLockup';
import { AuthVisual } from '../../components/ui/Overlay';

export function Onboarding() {
  const navigate = useNavigate();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errs, setErrs] = useState<{ name?: string; email?: string }>({});
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  const configured = isSupabaseConfigured && !!supabase;

  // If the user is already provisioned, hop straight to the dashboard rather
  // than showing onboarding (covers refresh + direct nav as a ready user).
  useEffect(() => {
    let cancelled = false;

    if (!configured || !supabase || !user?.id) {
      setChecking(false);
      return;
    }

    getProfileState(supabase, user.id)
      .then((state) => {
        if (cancelled) return;
        setChecking(false);
        if (state.phase === 'ready') navigate(ROUTES.dashboard, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [configured, supabase, user?.id, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: { name?: string; email?: string } = {};
    let ok = true;

    if (!name.trim()) {
      next.name = 'Restaurant name is required';
      ok = false;
    }
    if (email && !emailRe.test(email)) {
      next.email = 'Enter a valid email address';
      ok = false;
    }
    setErrs(next);
    if (!ok) return;

    if (!configured || !supabase) {
      setFormErr('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to set up your workspace.');
      return;
    }

    setFormErr('');
    setBusy(true);
    try {
      const result = await provisionRestaurant(supabase, {
        restaurantName: name.trim(),
        restaurantEmail: email.trim() || undefined,
        restaurantPhone: phone.trim() || undefined,
        userName: user?.fullName ?? undefined,
        userEmail: user?.primaryEmailAddress?.emailAddress ?? undefined,
      });

      // created / claimed / already are ALL success — none is a dead-end. The
      // RPC is idempotent, so an `already` return simply means the records
      // exist (e.g. a retry that already provisioned).
      toast(
        result.status === 'already' || result.status === 'claimed'
          ? 'Your workspace is ready.'
          : 'Welcome to Elysian Spire! Your restaurant is ready.',
        'success',
        'Workspace ready',
      );

      // Re-fetch the AUTHORITATIVE profile state from Supabase and navigate
      // only once we can confirm the user is provisioned (`ready`). SessionGate
      // performs the same lookup on its next mount, so it will then allow
      // AppShell to render.
      const state = await getProfileState(supabase, user?.id ?? '');
      if (state.phase === 'ready') {
        navigate(ROUTES.dashboard, { replace: true });
      } else {
        setFormErr('Your workspace is ready — please retry to continue.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Provisioning failed. Please try again.';
      setFormErr(msg);
      toast('We could not create your workspace. Please try again.', 'error', 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth" id="authRoot">
      <section className="auth-section" style={{ display: 'contents' }}>
        <AuthVisual
          quote={'\u201CSet the table for what is to come. This is the beginning of something excellent.\u201D'}
          cite="The Elysian Standard"
          meta="One restaurant · One owner · Endless possibility"
        />
        <div className="auth-panel">
          <div className="auth-card">
            <div className="auth-logo">
              <BrandLockup iconSize={56} />
            </div>
            <h1 className="auth-h1">Set up your restaurant</h1>
            <p className="auth-sub">Tell us a little about your venue to create your workspace.</p>

            {!configured ? (
              <div className="auth-error">
                Supabase is not configured on this device. Add VITE_SUPABASE_URL and
                VITE_SUPABASE_PUBLISHABLE_KEY to continue.
              </div>
            ) : (
              <form className="auth-form" noValidate onSubmit={submit}>
                <div className={'field' + (errs.name ? ' invalid' : '')}>
                  <label htmlFor="onb_name">Restaurant Name</label>
                  <input
                    className="input"
                    type="text"
                    id="onb_name"
                    placeholder="Elysian Spire"
                    value={name}
                    autoComplete="organization"
                    onChange={(e) => setName(e.target.value)}
                  />
                  <span className="err">{errs.name || ''}</span>
                </div>
                <div className={'field' + (errs.email ? ' invalid' : '')}>
                  <label htmlFor="onb_email">Restaurant Email (optional)</label>
                  <input
                    className="input"
                    type="email"
                    id="onb_email"
                    placeholder="hello@elysianspire.com"
                    value={email}
                    autoComplete="email"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <span className="err">{errs.email || ''}</span>
                </div>
                <div className="field">
                  <label htmlFor="onb_phone">Phone (optional)</label>
                  <input
                    className="input"
                    type="tel"
                    id="onb_phone"
                    placeholder="+91 00000 00000"
                    value={phone}
                    autoComplete="tel"
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <button className="btn btn-primary" type="submit" style={{ width: '100%', padding: 12 }} disabled={busy || checking || !configured}>
                  <span className="btn-label">{busy ? 'Creating workspace…' : 'Create my workspace'}</span>
                </button>
                {formErr ? <div className="auth-error">{formErr}</div> : null}
              </form>
            )}

            <div className="auth-divider" role="separator" aria-label="or">
              <span className="auth-divider-line" />
              <span className="auth-divider-text">Signed in as {user?.primaryEmailAddress?.emailAddress ?? 'you'}</span>
              <span className="auth-divider-line" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
