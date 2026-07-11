# DashClaw marketing assets

Generated 2026-07-10 (evening full re-run) by the animation engine (`C:\Projects\animations`, brand `dashclaw`). Every asset passed a stills-gate render check, four mechanical judges (AV sync, demo pacing, palette, size budgets), and an adversarially verified brand-compliance sweep (orange as signal only, no em dashes, no hype). Audio masters are normalized to ~-16 LUFS integrated / under -1.5 dBTP true peak.

| File | What it is | Intended use |
|---|---|---|
| `launch.mp4` | 55s hero launch video, 1920x1080@30, music + voiceover | Site hero, YouTube, launch post embeds |
| `launch-poster.jpg` | Poster still for the launch video | `poster=` attribute on the site hero video |
| `demo.mp4` | 28s silent product demo, 5 beats (approvals, one-click Allow, decisions, policies) | Docs pages, embeds where VO is unwanted, source footage |
| `logo-reveal.mp4` | 5s logo reveal (shield draw-on, wordmark, tagline) | Video intros/outros, event slides |
| `social-x.mp4` | 10s clip, 16:9, approvals framing, sting audio | X posts |
| `social-linkedin.mp4` | 10s clip, 16:9, decisions-ledger framing, sting audio | LinkedIn posts |
| `social-vertical.mp4` | 10s clip, 9:16 1080x1920, sidebar-free portrait framing, safe zones for platform chrome | TikTok / Shorts / Reels |
| `sting.mp3` | 4.1s music sting cut from the launch bed, -16 LUFS | Outros, additional clips |
| `readme-demo.gif` | Money-moment GIF from real demo footage (risk-scored card, click Allow), 2.8MB | GitHub README hero (wired in root `README.md`) |
| `og-loop.mp4` / `og-loop.gif` | 8s animated OG lockup loop, 1200x630 | Anywhere an animated card is supported |
| `captions/launch.srt` / `.vtt` | Caption sidecars for the launch video, sentence-split cues | Upload alongside the video on YouTube/LinkedIn |
| `postkit/<platform>/` | Paste-ready post kits: right-aspect video, `thumb.jpg`, lint-gated `caption.txt`, `alt.txt`, `POST.md` checklist (X, LinkedIn, TikTok, Shorts, YouTube, Instagram) | Open the folder, follow `POST.md`, paste and upload |
| `gallery.html` | Contact sheet of the core assets | Internal review |

Static link-preview cards live in `public/social/` (`og-image.png` 1200x630, `twitter-card.png` 1200x600, `github-social-preview.png` 1280x640) and were regenerated in the same run without the video-scrubber motif (statics only; the animated loop keeps it).

Source of truth for copy and props lives in the engine repo (`out/dashclaw/marketing/brief.json` + `props/dashclaw-*.json`); regenerate there, never edit these binaries in place. Responsive matrix originals (16:9 / 1:1 / 4:5 / 9:16) live in the engine at `out/dashclaw/matrix/`.
