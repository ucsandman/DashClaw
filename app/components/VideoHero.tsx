// VideoHero — iframe wrapper for the flagship ≤3-minute demo video (DOG-02).
//
// Hostname allowlist: Loom + youtube-nocookie only. Any other host throws at
// render time (SSRF mitigation T-03-01-04). CSP frame-src directive in
// next.config.js must match this allowlist.
//
// Embed URL shapes:
//   Loom:    https://www.loom.com/embed/<VIDEO_ID>
//   YouTube: https://www.youtube-nocookie.com/embed/<VIDEO_ID>
//
// Styling: CSS tokens only per .impeccable.md. No hardcoded hex.

import { Clapperboard } from 'lucide-react';

interface VideoHeroProps {
  src: string;
  title?: string;
}

export default function VideoHero({ src, title }: VideoHeroProps) {
  let host = '';
  try {
    host = new URL(src).hostname;
  } catch {
    throw new Error('VideoHero: src must be a valid URL');
  }

  const isLoom = host === 'www.loom.com' || host === 'loom.com';
  const isYouTubeNoCookie =
    host === 'www.youtube-nocookie.com' || host === 'youtube-nocookie.com';

  if (!isLoom && !isYouTubeNoCookie) {
    throw new Error('VideoHero: src must be Loom or YouTube URL');
  }

  // Until the real walkthrough is recorded, both the homepage hero and the
  // blog embed point at a PLACEHOLDER_VIDEO_ID. Rendering that as an iframe
  // produces a 404 + an X-Frame-Options error in the console and a broken
  // frame on a public page. Show a calm "coming soon" poster instead; when
  // src is backfilled with a real id this check is false and the iframe renders.
  if (src.includes('PLACEHOLDER')) {
    return (
      <div className="relative flex w-full aspect-video items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-secondary">
        <div className="flex flex-col items-center gap-2 text-center">
          <Clapperboard size={28} className="text-text-tertiary" aria-hidden="true" />
          <p className="text-sm text-text-secondary">Walkthrough recording coming soon</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-xl border border-border-hover">
      <iframe
        src={src}
        title={title || 'DashClaw demo'}
        allow="autoplay; fullscreen; encrypted-media"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
