/** Postgres 오류 코드. https://www.postgresql.org/docs/current/errcodes-appendix.html */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/** drizzle이 감싼 postgres 오류까지 따라가 제약 constraint의 unique 위반을 찾는다. */
export function violatesUnique(error: unknown, constraint: string): boolean {
  return violates(error, UNIQUE_VIOLATION, constraint);
}

/** drizzle이 감싼 postgres 오류까지 따라가 제약 constraint의 FK 위반을 찾는다. */
export function violatesForeignKey(
  error: unknown,
  constraint: string,
): boolean {
  return violates(error, FOREIGN_KEY_VIOLATION, constraint);
}

function violates(error: unknown, code: string, constraint: string): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    const { code: actual, constraint_name } = current as {
      code?: string;
      constraint_name?: string;
    };
    if (actual === code && constraint_name === constraint) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
