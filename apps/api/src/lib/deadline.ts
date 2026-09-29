/** What `withinBudget` answers when the work is still running at the deadline. */
export const LATE = Symbol('late');

/**
 * The work's value, or `LATE` once `ms` pass, whichever comes first. The work is not cancelled:
 * its own timeouts still bound it, and it can finish in the background (filling a cache, say).
 * Only the caller stops waiting. A rejection counts as `LATE` too, so this never throws.
 */
export async function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  try {
    return await Promise.race([work.catch((): typeof LATE => LATE), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
