# DashClaw Brand Kit

**Version 1.9.1 — Generated 2026-02-19**

Logo: Outline Claw — dark shield, orange border, three centered diagonal claw strokes.

---

## Logo

The DashClaw mark is the Lucide Shield shape rendered as an orange outline on a near-black background, with three parallel diagonal claw strokes centered inside the shield body. The outline-only treatment keeps it lightweight and sharp at every size from 16px favicon to 2048px print.

The SVG path for the shield is `M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z` on a 24×24 viewbox. The three claw lines run from y=8.3 to y=16.1 at x-centers of 9.75, 11.95, and 14.15 (adjusted +0.35 for optical centering against the diagonal lean). Stroke width is 0.85 with round caps throughout.

### Variants

| File | Use |
|---|---|
| `logo.svg` | Default — dark background, full mark |
| `logo-transparent.svg` | Transparent bg for overlays |
| `logo-wordmark.svg` | Icon + "DashClaw" lockup |
| `icons/icon-512x512.png` | Standard raster icon |
| `icons/logo-circular.png` | Profile photos, Discord, Slack |

### Minimum size

16px. Below this the claw strokes collapse — use the shield outline only at 12px and below.

### Clear space

Keep a minimum of 10% of the asset width clear on all sides. Never place the mark directly against a competing element.

---

## Colors

| Swatch | Name | Hex | Use |
|---|---|---|---|
| 🟠 | Brand Orange | `#F97316` | Logo, CTAs, borders, highlights |
| 🔶 | Orange Dark | `#EA580C` | Hover states, gradient end |
| ⬛ | Near Black | `#0A0A0A` | Primary background |
| 🔲 | Dark Surface | `#111111` | Cards, secondary surfaces |
| 🟢 | Terminal Green | `#22C55E` | Healthy status, success |
| 🔴 | Alert Red | `#EF4444` | Risk signals, errors |
| ⬜ | White | `#FFFFFF` | Primary text |
| 🔘 | Zinc | `#71717A` | Secondary text, metadata |

The logo is always orange on dark. Never place it on a light background — the outline treatment reads poorly against anything lighter than `#333`.

---

## Typography

**Display / Headlines:** Inter 700, tracking `-0.04em`
**Body:** Inter 400, base `14px`
**Mono:** JetBrains Mono (fallback: Fira Code, Consolas) — used for all code, SDK examples, terminal output, decision IDs

---

## HTML Implementation

Paste this into your `<head>`:

```html
<!-- Favicons -->
<link rel="icon" type="image/x-icon" href="/favicons/favicon.ico"/>
<link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png"/>
<link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png"/>
<link rel="manifest" href="/config/site.webmanifest"/>
<meta name="theme-color" content="#0a0a0a"/>
<meta name="msapplication-config" content="/config/browserconfig.xml"/>

<!-- Open Graph -->
<meta property="og:image" content="/social/og-image.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:type" content="image/png"/>

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:image" content="/social/twitter-card.png"/>
```

---

## Next.js Implementation

In `app/layout.js`:

```js
export const metadata = {
  icons: {
    icon: [
      { url: '/favicons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/favicons/apple-touch-icon.png',
  },
  manifest: '/config/site.webmanifest',
  themeColor: '#0a0a0a',
  openGraph: {
    images: [{ url: '/social/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/social/twitter-card.png'],
  },
}
```

---

## Asset Inventory

```
dashclaw-brand/
├── brand.json
├── logo.svg                           Master icon, dark bg
├── logo-transparent.svg               Master icon, transparent bg
├── logo-wordmark.svg                  Icon + logotype lockup
├── favicons/
│   ├── favicon.ico                    16 / 32 / 48px multi-size
│   ├── favicon-16x16.png
│   ├── favicon-32x32.png
│   ├── apple-touch-icon.png           180×180
│   ├── android-chrome-192x192.png
│   ├── android-chrome-512x512.png
│   └── mstile-150x150.png
├── icons/
│   ├── icon-16x16.png
│   ├── icon-24x24.png
│   ├── icon-32x32.png
│   ├── icon-48x48.png
│   ├── icon-64x64.png
│   ├── icon-96x96.png
│   ├── icon-128x128.png
│   ├── icon-192x192.png
│   ├── icon-256x256.png
│   ├── icon-384x384.png
│   ├── icon-512x512.png
│   ├── icon-1024x1024.png
│   └── logo-circular.png              512×512 circular crop
├── social/
│   ├── og-image.png                   1200×630
│   ├── twitter-card.png               1200×600
│   ├── github-social-preview.png      1280×640
│   ├── linkedin-logo.png              300×300
│   └── discord-icon.png               512×512
├── presentation/
│   ├── slide-logo.png                 400×400
│   ├── slide-logo-corner.png          120×120
│   └── logo-print-2048.png            2048×2048 print master
├── misc/
│   ├── slack-app-icon.png             512×512
│   ├── email-signature-logo.png       50×50
│   ├── zoom-virtual-background.png    1920×1080
│   └── watermark-transparent.png      200×200 RGBA
└── config/
    ├── site.webmanifest
    └── browserconfig.xml
```

---

## Launch Checklist

- [ ] Copy `favicons/` folder to `public/favicons/` in your Next.js project
- [ ] Copy `config/` folder to `public/config/`
- [ ] Add HTML meta tags to `app/layout.js`
- [ ] Upload `github-social-preview.png` to GitHub repo Settings → Social preview
- [ ] Set `discord-icon.png` as server icon
- [ ] Set `slack-app-icon.png` in Slack app settings
- [ ] Test favicon in Chrome, Safari, Firefox tabs
- [ ] Verify `theme-color` shows correctly in mobile Chrome address bar
