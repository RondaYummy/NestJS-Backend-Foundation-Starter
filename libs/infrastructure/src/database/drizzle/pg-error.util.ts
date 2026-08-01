const UNIQUE_VIOLATION_CODE = '23505';
const MAX_CAUSE_DEPTH = 8;

type ErrorLike = {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
};

function asErrorLike(value: unknown): ErrorLike | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  return value;
}

function readStringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Walk `error` and a bounded `cause` chain, guarding against cycles.
 * Yields each visited object in order.
 */
function* walkCauseChain(error: unknown): Generator<ErrorLike> {
  const visited = new WeakSet<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const frame = asErrorLike(current);
    if (frame === null) {
      return;
    }

    if (visited.has(frame)) {
      return;
    }

    visited.add(frame);
    yield frame;
    current = frame.cause;
  }
}

/**
 * True when any object in the (bounded) cause chain has Postgres unique-violation code `23505`.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (const frame of walkCauseChain(error)) {
    if (readStringField(frame.code) === UNIQUE_VIOLATION_CODE) {
      return true;
    }
  }

  return false;
}

/**
 * Returns the first string `constraint` found once a unique-violation frame is reached
 * (preferring the same object that carries `code === '23505'`).
 */
export function getViolatedConstraint(error: unknown): string | undefined {
  let seenUniqueViolation = false;

  for (const frame of walkCauseChain(error)) {
    const code = readStringField(frame.code);
    const constraint = readStringField(frame.constraint);

    if (code === UNIQUE_VIOLATION_CODE) {
      seenUniqueViolation = true;
      if (constraint !== undefined) {
        return constraint;
      }
      continue;
    }

    if (seenUniqueViolation && constraint !== undefined) {
      return constraint;
    }
  }

  return undefined;
}
