'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * LEGACY BOOKMARK REDIRECT — nothing in the app links here anymore. /quality
 * redirects to /scoring (rule-based scoring profiles) by default, or
 * /evaluations with ?view=evaluations. Kept only so old external bookmarks
 * keep working; the sidebar entries are "Scoring" (/scoring) and
 * "Evaluations" (/evaluations) — one name per surface.
 */
function QualityRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get('view');

  useEffect(() => {
    if (view === 'evaluations') {
      router.replace('/evaluations');
    } else {
      router.replace('/scoring');
    }
  }, [router, view]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="h-8 w-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function QualityPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <QualityRedirect />
    </Suspense>
  );
}
