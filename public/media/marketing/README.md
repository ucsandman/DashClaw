# DashClaw marketing assets

Generated 2026-07-10 by the animation engine (`C:\Projects\animations`, brand `dashclaw`). Every asset passed a stills-gate render check and a brand-compliance sweep (orange as signal only, no em dashes, no hype). Audio masters are normalized to -16 LUFS integrated / -1.5 dBTP.

| File | What it is | Intended use |
|---|---|---|
| `launch.mp4` | 55s hero launch video, 1920x1080@30, music + voiceover | Site hero, YouTube, launch post embeds |
| `demo.mp4` | 28s silent product demo, 5 beats (approvals, one-click Allow, decisions, policies) | Docs pages, embeds where VO is unwanted, source footage |
| `logo-reveal.mp4` | 5s logo reveal (shield draw-on, wordmark, tagline) | Video intros/outros, event slides |
| `social-x.mp4` | 10s clip, 16:9, approvals framing, muted-autoplay safe | X posts |
| `social-linkedin.mp4` | 10s clip, 16:9, decisions-ledger framing | LinkedIn posts |
| `social-vertical.mp4` | 10s clip, 9:16 1080x1920, safe zones for platform chrome | TikTok / Shorts / Reels |
| `readme-demo.gif` | 3.3s money-moment GIF (risk-82 card, click Allow, queue resolves), 960x540, 678KB | GitHub README hero (wired in root `README.md`) |
| `og-loop.mp4` / `og-loop.gif` | 8s animated OG lockup loop, 1200x630 | Anywhere an animated card is supported |
| `gallery.html` | Contact sheet of everything above | Internal review |

Static link-preview cards live in `public/social/` (`og-image.png` 1200x630, `twitter-card.png` 1200x600, `github-social-preview.png` 1280x640) and were regenerated in the same run.

Source of truth for copy and props lives in the engine repo (`props/dashclaw-*.json`); regenerate there, never edit these binaries in place.
