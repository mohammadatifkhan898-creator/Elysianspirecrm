import { describe, it, expect } from 'vitest';
import { readClerkConfig } from '../../src/lib/clerk';

/* ═══════════════════════════════════════════════════════════════
   Clerk publishable-key validation.

   Regression cover for the production incident: a well-formed-looking key
   whose embedded Frontend API host is not a real Clerk instance left the app
   spinning on the splash screen forever. `readClerkConfig` now classifies a
   key as missing / malformed / ok so ClerkGate can render a named error
   screen instead of hanging.

   The keys below are structurally realistic (base64 of "<host>$") but are
   throwaway fixtures, NOT real credentials. They are never used against a
   live Clerk instance.
   ═══════════════════════════════════════════════════════════════ */

/** Build a structurally valid publishable key for an arbitrary host. */
function fakeKey(host: string, kind: 'test' | 'live' = 'test'): string {
  return `pk_${kind}_${btoa(`${host}$`)}`;
}

describe('readClerkConfig', () => {
  describe('missing keys', () => {
    it('classifies an empty string as missing', () => {
      const cfg = readClerkConfig('');
      expect(cfg.status).toBe('missing');
      expect(cfg.frontendApiHost).toBeNull();
      expect(cfg.problem).toMatch(/VITE_CLERK_PUBLISHABLE_KEY/);
    });

    it('classifies whitespace as missing', () => {
      expect(readClerkConfig('   \n  ').status).toBe('missing');
    });

    it('names the env var so the message is actionable', () => {
      expect(readClerkConfig('').problem).toContain('VITE_CLERK_PUBLISHABLE_KEY');
    });
  });

  describe('malformed keys', () => {
    it('rejects a key with no pk_ prefix', () => {
      const cfg = readClerkConfig('not-a-clerk-key');
      expect(cfg.status).toBe('malformed');
      expect(cfg.frontendApiHost).toBeNull();
    });

    it('rejects a pk_ key whose payload is not base64 of "<host>$"', () => {
      // Valid prefix, payload decodes to a bare string with no "$" sentinel.
      const cfg = readClerkConfig(`pk_test_${btoa('just-a-host-without-sentinel')}`);
      expect(cfg.status).toBe('malformed');
    });

    it('rejects a key whose decoded host is not a hostname', () => {
      const cfg = readClerkConfig(fakeKey('not a host'));
      expect(cfg.status).toBe('malformed');
    });

    it('rejects a key whose decoded host has no dot', () => {
      const cfg = readClerkConfig(fakeKey('localhost'));
      expect(cfg.status).toBe('malformed');
    });

    it('suggests the expected key format in the problem message', () => {
      expect(readClerkConfig('nope').problem).toMatch(/pk_test_|pk_live_/);
    });
  });

  describe('valid keys', () => {
    it('accepts a pk_test_ key and extracts the Frontend API host', () => {
      const cfg = readClerkConfig(fakeKey('clerk.example.com'));
      expect(cfg.status).toBe('ok');
      expect(cfg.problem).toBeNull();
      expect(cfg.frontendApiHost).toBe('clerk.example.com');
    });

    it('accepts a pk_live_ key', () => {
      const cfg = readClerkConfig(fakeKey('clerk.example.com', 'live'));
      expect(cfg.status).toBe('ok');
      expect(cfg.frontendApiHost).toBe('clerk.example.com');
    });

    it('ignores the trailing $ sentinel when extracting the host', () => {
      expect(readClerkConfig(fakeKey('clerk.example.com')).frontendApiHost).not.toContain('$');
    });

    it('tolerates surrounding whitespace on a valid key', () => {
      const cfg = readClerkConfig(`  ${fakeKey('clerk.example.com')}  `);
      expect(cfg.status).toBe('ok');
    });

    /* Structural validation CANNOT prove a host is provisioned — that is
       exactly why ClerkGate also runs a load watchdog. This test pins that
       limitation so nobody mistakes a passing check for a reachable host. */
    it('reports ok for a well-formed key on a host that does not exist', () => {
      const cfg = readClerkConfig(fakeKey('clerk.definitely-not-provisioned.invalid'));
      expect(cfg.status).toBe('ok');
      expect(cfg.frontendApiHost).toBe('clerk.definitely-not-provisioned.invalid');
    });
  });

  describe('secret hygiene', () => {
    it('never echoes key material into the problem message', () => {
      const secretish = 'sk_test_super_secret_value';
      expect(readClerkConfig(secretish).problem ?? '').not.toContain('super_secret_value');
    });

    it('never echoes key material for an empty key', () => {
      expect(readClerkConfig('').problem ?? '').not.toMatch(/pk_(test|live)_/);
    });
  });
});
