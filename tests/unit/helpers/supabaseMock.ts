import type { AppSupabaseClient } from '../../src/lib/supabase';

export interface QueryResult {
  data?: unknown;
  error?: unknown | null;
}

/**
 * Minimal chainable stand-in for the supabase-js query builder, so the
 * service layer can be unit-tested without a live Supabase.
 *
 * - Every chained method (from/select/eq/is/order/update/insert) records the
 *   call and returns the same chain object, mirroring the real builder.
 * - `.maybeSingle()` / `.single()` / `.rpc()` / awaiting the chain directly
 *   consume the next queued QueryResult in order.
 */
export class MockSupabase {
  private readonly responses: QueryResult[];
  public readonly calls: string[] = [];

  constructor(responses: QueryResult[] = []) {
    this.responses = [...responses];
  }

  private next(): Promise<QueryResult> {
    const r = this.responses.shift();
    if (r === undefined) return Promise.resolve({ data: null, error: null });
    return Promise.resolve(r);
  }

  client(): AppSupabaseClient {
    const chain: Record<string, unknown> = {};
    chain.from = (t?: string) => {
      this.calls.push('from:' + (t ?? ''));
      return chain;
    };
    chain.select = (s?: unknown) => {
      this.calls.push('select:' + JSON.stringify(s));
      return chain;
    };
    chain.eq = (col?: string, val?: unknown) => {
      this.calls.push('eq:' + col + '=' + JSON.stringify(val));
      return chain;
    };
    chain.is = (col?: string, val?: unknown) => {
      this.calls.push('is:' + col + '=' + JSON.stringify(val));
      return chain;
    };
    chain.order = (col?: unknown, opts?: unknown) => {
      this.calls.push('order:' + JSON.stringify(col) + (opts ? ':' + JSON.stringify(opts) : ''));
      return chain;
    };
    chain.update = (patch?: unknown) => {
      this.calls.push('update:' + JSON.stringify(patch));
      return chain;
    };
    chain.insert = (row?: unknown) => {
      this.calls.push('insert:' + JSON.stringify(row));
      return chain;
    };
    chain.maybeSingle = () => this.next();
    chain.single = () => this.next();
    // Awaiting the chain directly (e.g. `await from().update().eq(...)` or a
    // bare select) resolves with the next queued outcome.
    chain.then = (resolve: (v: QueryResult) => unknown) => this.next().then(resolve);
    chain.rpc = (name: string, args?: unknown) => {
      this.calls.push('rpc:' + name + ':' + JSON.stringify(args));
      return this.next();
    };
    return chain as unknown as AppSupabaseClient;
  }
}