/**
 * Metadata bound to a one-time OAuth `state` value at flow start.
 */
export type GoogleOAuthStatePayload = {
  /** Allowlist-validated absolute URL to redirect to after a session-cookie sign-in. */
  returnUrl?: string;
};

export interface IGoogleOAuthStateStore {
  save(state: string, payload: GoogleOAuthStatePayload, ttlSeconds: number): Promise<void>;

  /**
   * Atomically consumes the state (single use). Returns the bound payload or
   * `null` when the state is unknown, expired, or already consumed.
   */
  consume(state: string): Promise<GoogleOAuthStatePayload | null>;
}
