/**
 * Async keyed lock that serializes work per key in FIFO order.
 */
export class AsyncKeyedLock {
  private tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();

    let releaseFn!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });

    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    // Wait until all prior holders have released.
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseFn();

      // Only clear if we're still the tail (no newer waiters).
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    };
  }
}
