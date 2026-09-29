import "server-only";
// Per-instance brake only. Configure a Vercel Firewall rule for cross-instance protection.
const buckets = new Map<string, { count: number; expires: number }>();
export function allowRequest(key: string, now = Date.now()): boolean {
  for (const [id, bucket] of buckets)
    if (bucket.expires <= now) buckets.delete(id);
  if (!buckets.has(key) && buckets.size >= 1000) return false;
  const bucket = buckets.get(key) ?? { count: 0, expires: now + 60000 };
  bucket.count++;
  buckets.set(key, bucket);
  return bucket.count <= 30;
}
