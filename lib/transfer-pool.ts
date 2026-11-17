// Bound in-flight 10MB bodies on iPad. Do not reject early: callers must be able
// to clean up every successful upload without a late request creating an orphan.
export async function transferPool<T>(
  count: number,
  run: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(count);
  let next = 0,
    failed = false,
    reason: unknown;
  async function worker() {
    while (!failed && next < count) {
      const index = next++;
      try {
        results[index] = await run(index);
      } catch (error) {
        if (!failed) {
          failed = true;
          reason = error;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, count) }, () => worker()));
  if (failed) throw reason;
  return results;
}
