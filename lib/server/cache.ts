import "server-only";
/** Approximate retained size; JSON length tracks the normalized observation payload. */
const jsonSize = (value: unknown) => JSON.stringify(value)?.length ?? 0;
export class DataCache {
  private entries = new Map<
    string,
    { value: unknown; created: number; size: number }
  >();
  private pending = new Map<string, Promise<unknown>>();
  private bytes = 0;
  constructor(
    private maxEntries = 128,
    private now: () => number = Date.now,
    private maxBytes = 64_000_000,
    private sizeOf: (value: unknown) => number = jsonSize,
  ) {}
  get retainedBytes(): number {
    return this.bytes;
  }
  private evict(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.size;
    this.entries.delete(key);
  }
  async get<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<{ value: T; ageSeconds: number }> {
    const entry = this.entries.get(key);
    if (entry && this.now() - entry.created < ttlMs)
      return {
        value: entry.value as T,
        ageSeconds: Math.max(0, (this.now() - entry.created) / 1000),
      };
    const inFlight = this.pending.get(key);
    if (inFlight) return { value: (await inFlight) as T, ageSeconds: 0 };
    const work = load();
    this.pending.set(key, work);
    try {
      const value = await work;
      this.evict(key);
      const size = this.sizeOf(value);
      // An oversized value is still returned, just not retained.
      if (size <= this.maxBytes) {
        while (
          this.entries.size &&
          (this.entries.size >= this.maxEntries ||
            this.bytes + size > this.maxBytes)
        )
          this.evict(this.entries.keys().next().value!);
        this.entries.set(key, { value, created: this.now(), size });
        this.bytes += size;
      }
      return { value, ageSeconds: 0 };
    } finally {
      this.pending.delete(key);
    }
  }
}
