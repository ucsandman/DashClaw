import { Skeleton } from '../components/ui/Skeleton';

// /setup renders server-side after real checks (readiness report, canary
// write, liveness reads) — seconds on a cold start. Without this boundary a
// sidebar click gives no feedback at all until the render resolves, which
// reads as "the page doesn't exist".
export default function SetupLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-4">
      <Skeleton className="h-7 w-64" />
      <div className="text-sm text-tertiary">Running deployment checks…</div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}
