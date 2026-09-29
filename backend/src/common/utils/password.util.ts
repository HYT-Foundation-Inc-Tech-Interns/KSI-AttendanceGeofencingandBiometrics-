import { randomInt } from 'crypto';

/**
 * Ambiguous characters are omitted on purpose.
 *
 * These passwords are read off a phone screen or copied out of an email and
 * typed by hand, so `0`/`O`, `1`/`l`/`I` are removed rather than left as a
 * support call. 57 symbols still gives ~70 bits over 12 characters.
 */
const UNAMBIGUOUS_ALPHABET =
  'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Generate a random temporary password.
 *
 * Uses crypto.randomInt rather than Math.random: Math.random is seeded from
 * the process start time and is not a CSPRNG, so passwords derived from it are
 * predictable from observed output. randomInt is rejection-sampled and
 * unbiased, so no character is more likely than another.
 */
export function generateTemporaryPassword(length = 12): string {
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += UNAMBIGUOUS_ALPHABET[randomInt(UNAMBIGUOUS_ALPHABET.length)];
  }
  return password;
}

/**
 * Canonical form for an email address used as a login identifier.
 *
 * `users.email` is a plain unique text column, so it is case-sensitive in
 * Postgres: `Juan@x.ph` and `juan@x.ph` would be two rows, and a login attempt
 * would match only the exact casing that was typed at creation. Normalising on
 * every write and every lookup keeps one address to one account.
 */
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}
