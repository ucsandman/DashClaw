interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`bg-white/5 rounded animate-pulse ${className}`} />;
}

export function StatSkeleton() {
  return (
    <div>
      <Skeleton className="h-3 w-16 mb-2" />
      <Skeleton className="h-8 w-20" />
    </div>
  );
}

interface ListSkeletonProps {
  rows?: number;
}

export function ListSkeleton({ rows = 3 }: ListSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-surface-secondary border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-1.5 w-full rounded-full" />
        <ListSkeleton rows={2} />
      </div>
    </div>
  );
}
