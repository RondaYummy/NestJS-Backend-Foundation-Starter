/**
 * TTL-bound single-use store for password-reset tokens.
 *
 * Implementations must persist only a cryptographic hash of the raw token;
 * the raw token exists solely in the reset email delivered to the user.
 */
export interface IPasswordResetTokenStore {
  /**
   * Binds a hashed token to a user for `ttlSeconds`. Replaces (invalidates)
   * any previously issued token for the same user.
   */
  save(userId: string, tokenHash: string, ttlSeconds: number): Promise<void>;

  /**
   * Atomically consumes a hashed token: returns the bound user id and deletes
   * the binding, or returns `null` when the token is unknown, expired or was
   * already consumed. A given token can be consumed at most once.
   */
  consume(tokenHash: string): Promise<string | null>;
}
