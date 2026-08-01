/// <reference types="jest" />

import { getViolatedConstraint, isUniqueViolation } from './pg-error.util';

describe('pg-error.util', () => {
  describe('isUniqueViolation', () => {
    it('detects a top-level Postgres 23505 error', () => {
      expect(isUniqueViolation({ code: '23505', constraint: 'users_email_unique' })).toBe(true);
    });

    it('detects a Drizzle-style wrapper with cause carrying 23505', () => {
      const wrapped = Object.assign(new Error('Failed query: insert into "users"'), {
        cause: { code: '23505', constraint: 'users_email_unique' },
      });

      expect(isUniqueViolation(wrapped)).toBe(true);
    });

    it('detects a nested cause chain', () => {
      const nested = {
        message: 'outer',
        cause: {
          message: 'middle',
          cause: { code: '23505', constraint: 'users_google_sub_unique' },
        },
      };

      expect(isUniqueViolation(nested)).toBe(true);
    });

    it('returns false for non-unique Postgres errors', () => {
      expect(isUniqueViolation({ code: '23503', constraint: 'fk_users' })).toBe(false);
    });

    it('returns false when code is missing', () => {
      expect(isUniqueViolation(new Error('Failed query'))).toBe(false);
      expect(isUniqueViolation({ message: 'boom' })).toBe(false);
      expect(isUniqueViolation(null)).toBe(false);
      expect(isUniqueViolation('23505')).toBe(false);
    });

    it('does not hang on a circular cause chain', () => {
      const cyclic: Record<string, unknown> = { message: 'cycle' };
      cyclic.cause = cyclic;

      expect(isUniqueViolation(cyclic)).toBe(false);
    });

    it('finds 23505 behind a circular-safe wrapper chain', () => {
      const leaf: Record<string, unknown> = {
        code: '23505',
        constraint: 'users_email_unique',
      };
      const mid = { cause: leaf };
      const root = { cause: mid };
      leaf.cause = root;

      expect(isUniqueViolation(root)).toBe(true);
    });
  });

  describe('getViolatedConstraint', () => {
    it('reads constraint from a top-level 23505 error', () => {
      expect(getViolatedConstraint({ code: '23505', constraint: 'users_email_unique' })).toBe(
        'users_email_unique',
      );
    });

    it('reads constraint from the cause of a Drizzle-style wrapper', () => {
      const wrapped = Object.assign(new Error('Failed query: insert into "users"'), {
        cause: { code: '23505', constraint: 'users_email_unique' },
      });

      expect(getViolatedConstraint(wrapped)).toBe('users_email_unique');
    });

    it('prefers constraint on the same frame that has code 23505', () => {
      const error = {
        code: '23505',
        constraint: 'users_email_unique',
        cause: { code: '23505', constraint: 'other_constraint' },
      };

      expect(getViolatedConstraint(error)).toBe('users_email_unique');
    });

    it('reads constraint from a deeper frame when the 23505 frame lacks it', () => {
      const error = {
        cause: {
          code: '23505',
          cause: { constraint: 'users_email_unique' },
        },
      };

      expect(getViolatedConstraint(error)).toBe('users_email_unique');
    });

    it('returns undefined when there is no unique violation', () => {
      expect(getViolatedConstraint({ code: '23503', constraint: 'fk_users' })).toBeUndefined();
      expect(getViolatedConstraint(new Error('nope'))).toBeUndefined();
    });

    it('returns undefined when 23505 has a non-string constraint', () => {
      expect(getViolatedConstraint({ code: '23505', constraint: 123 })).toBeUndefined();
    });

    it('does not hang on a circular cause chain', () => {
      const cyclic: Record<string, unknown> = { code: '23505' };
      cyclic.cause = cyclic;

      expect(getViolatedConstraint(cyclic)).toBeUndefined();
    });
  });
});
