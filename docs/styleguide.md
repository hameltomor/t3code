# XBE Brand Styleguide

Design system extracted from [x-b-e.com](https://www.x-b-e.com/) for use in XBE Code application redesign.

---

## Logo

- **Format**: PNG (raster), served via Next.js image optimization
- **Light mode**: `/logos/guard/xbe.png` — dark text/outline on transparent
- **Dark mode**: `/logos/guard/xbe-dark.png` — white text/outline on transparent
- **Dimensions**: 96 x 40 px (display), source 256px wide
- **Style**: "XBE" text inside a rounded rectangular border (shield/guard shape)
- **Navbar logo size**: 76 x 32 px
- **Favicon**: Standard `.ico` format

---

## Color Palette

### Brand Colors (Primary Triad)

| Token | Hex | RGB | Usage |
|---|---|---|---|
| **Neon Pink** | `#ff006e` | `rgb(255, 0, 110)` | Primary brand color, CTAs, accent highlights, focus rings, links |
| **Neon Purple** | `#8b5cf6` | `rgb(139, 92, 246)` | Secondary accent, section labels, belief headings, outline buttons |
| **Neon Teal** | `#00d4aa` | `rgb(0, 212, 170)` | Tertiary accent, section labels, success indicators |

### Semantic Colors — Light Mode

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#ffffff` | Page background |
| `--foreground` | `#0a0a0a` | Primary text |
| `--card` | `#f8f9fa` | Card surfaces |
| `--card-foreground` | `#0a0a0a` | Card text |
| `--popover` | `#ffffff` | Popover/dropdown background |
| `--popover-foreground` | `#0a0a0a` | Popover text |
| `--primary` | `#ff006e` | Primary actions (buttons, links, focus) |
| `--primary-foreground` | `#ffffff` | Text on primary |
| `--secondary` | `#8b5cf6` | Secondary actions |
| `--secondary-foreground` | `#ffffff` | Text on secondary |
| `--accent` | `#ff006e` | Accent highlights |
| `--accent-foreground` | `#ffffff` | Text on accent |
| `--muted` | `#f1f5f9` | Muted backgrounds |
| `--muted-foreground` | `#374151` | Subdued text (gray-700, 9.8:1 on white) |
| `--muted-foreground-secondary` | `#6b7280` | Secondary text, hints, descriptions (gray-500, 4.6:1 on white) |
| `--muted-foreground-faint` | `#9ca3af` | Decorative only — dots, separators (gray-400, 2.9:1) |
| `--destructive` | `#d4183d` | Error/destructive actions |
| `--destructive-foreground` | `#ffffff` | Text on destructive |
| `--border` | `#0000001a` | Default borders (black 10% opacity) |
| `--input` | `#0000001a` | Input borders |
| `--input-background` | `#f8f9fa` | Input field background |
| `--switch-background` | `#e2e8f0` | Toggle switch track |
| `--ring` | `#ff006e` | Focus ring color |

### Semantic Colors — Dark Mode

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#0a0a0a` | Page background |
| `--foreground` | `#ffffff` | Primary text |
| `--card` | `#1a1a1a` | Card surfaces |
| `--card-foreground` | `#ffffff` | Card text |
| `--popover` | `#1a1a1a` | Popover/dropdown background |
| `--popover-foreground` | `#ffffff` | Popover text |
| `--primary` | `#ff006e` | Primary actions (same in both modes) |
| `--primary-foreground` | `#ffffff` | Text on primary |
| `--secondary` | `#8b5cf6` | Secondary actions (same in both modes) |
| `--secondary-foreground` | `#ffffff` | Text on secondary |
| `--accent` | `#ff006e` | Accent highlights |
| `--accent-foreground` | `#ffffff` | Text on accent |
| `--muted` | `#2a2a2a` | Muted backgrounds |
| `--muted-foreground` | `#d1d5db` | Subdued text (gray-300, 14.6:1 on #0a0a0a) |
| `--muted-foreground-secondary` | `#9ca3af` | Secondary text, hints, descriptions (gray-400, 7.4:1 on #0a0a0a) |
| `--muted-foreground-faint` | `#6b7280` | Decorative only — dots, separators (gray-500, 3.7:1) |
| `--destructive` | `#d4183d` | Error/destructive actions |
| `--destructive-foreground` | `#ffffff` | Text on destructive |
| `--border` | `#ffffff1a` | Default borders (white 10% opacity) |
| `--input` | `#ffffff1a` | Input borders |
| `--input-background` | `#2a2a2a` | Input field background |
| `--switch-background` | `#3a3a3a` | Toggle switch track |
| `--ring` | `#ff006e` | Focus ring color |

### Space / Surface Colors

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--space-dark` | `#f8f9fa` | `#0a0a0a` | Alternate section bg |
| `--space-darker` | `#f1f5f9` | `#050505` | Deeper alternate bg |

### Sidebar Colors

| Token | Light | Dark |
|---|---|---|
| `--sidebar` | `#f8f9fa` | `#1a1a1a` |
| `--sidebar-foreground` | `#0a0a0a` | `#ffffff` |
| `--sidebar-primary` | `#ff006e` | `#ff006e` |
| `--sidebar-primary-foreground` | `#ffffff` | `#ffffff` |
| `--sidebar-accent` | `#f1f5f9` | `#2a2a2a` |
| `--sidebar-accent-foreground` | `#0a0a0a` | `#ffffff` |
| `--sidebar-border` | `#0000001a` | `#ffffff1a` |
| `--sidebar-ring` | `#ff006e` | `#ff006e` |

### Chart Colors

| Token | Hex | Usage |
|---|---|---|
| `--chart-1` | `#ff006e` | Primary data series |
| `--chart-2` | `#8b5cf6` | Secondary data series |
| `--chart-3` | `#00d4aa` | Tertiary data series |
| `--chart-4` | `gold` | Fourth data series |
| `--chart-5` | `#ff4500` | Fifth data series |

### Key Principle

The three neon brand colors (`#ff006e`, `#8b5cf6`, `#00d4aa`) remain **identical in both light and dark modes**. Only surface, text, and border colors invert.

---

## Typography

### Font Family

- **Primary**: `Poppins, sans-serif`
- **Fallback stack**: `ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`
- **CSS variable**: `--font-sans: var(--font-poppins)`
- **Loaded weights**: 300 (Light), 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
- **Format**: WOFF2, self-hosted via Next.js

### Type Scale

| Role | Size | Weight | Line Height | Letter Spacing | Color |
|---|---|---|---|---|---|
| **H1 (hero)** | 48px (3rem) | 400 | 1.3 (62.4px) | normal | `--foreground` or white on dark bg |
| **H2 (section)** | 48px (3rem) | 400 | 1.3 (62.4px) | normal | `--foreground` |
| **H3 (sub-section)** | 36px (2.25rem) | 500 | 1.3 (46.8px) | normal | `--secondary` (`#8b5cf6`) for beliefs; `--neon-teal` for cards |
| **H3 (card title)** | 18px (1.125rem) | 600 | 1.3 (23.4px) | normal | Varies by context |
| **H4 (small heading)** | 20px (1.25rem) | 500 | 1.3 (26px) | normal | `--foreground` |
| **Body large** | 18px (1.125rem) | 400 | 1.3 (23.4px) | normal | `--foreground` |
| **Body** | 16px (1rem) | 400 | 1.3 (20.8px) | normal | `--muted-foreground` |
| **Body small** | 14px (0.875rem) | 400-500 | 1.3 (18.2px) | normal | `--muted-foreground` |
| **Stat number** | 48px (3rem) | 500 | 1.3 (62.4px) | normal | `--primary` (`#ff006e`) |
| **Blockquote** | 30px (1.875rem) | 400 | 1.3 (39px) | normal | `--foreground` |

### Section Labels (Overline)

Used for section category tags like "INTRODUCING AGENT XBE", "SYSTEM CAPABILITIES":

| Property | Value |
|---|---|
| Font size | 16px |
| Font weight | 500 |
| Text transform | `uppercase` |
| Letter spacing | `0.8px` (0.05em) |
| Color | Varies: `#ff006e` (pink), `#00d4aa` (teal), `#8b5cf6` (purple) |

### Sub-labels (Smaller Overline)

Used for smaller category tags like "The System", "Integrations":

| Property | Value |
|---|---|
| Font size | 14px |
| Font weight | 500 |
| Text transform | `uppercase` |
| Letter spacing | `0.7px` |
| Color | `#8b5cf6` (purple) |

### Key Heading Color Pattern

- Hero headings on dark background: white, with **colored keywords** in neon pink/teal/purple
- Section headings on light background: `#0a0a0a` foreground
- Belief/principle headings: `#8b5cf6` purple
- Accent words inline: neon pink (`#ff006e`)

---

## Spacing

### Base Radius

- **CSS variable**: `--radius: 0.25rem` (4px)

### Border Radius Scale

| Usage | Value |
|---|---|
| Buttons | `0px` (sharp/square corners) |
| Inputs & form controls | `2px` |
| Cards | `8px` (0.5rem) |
| Dropdowns/popovers | `4px` |
| Pill/badge | `9999px` (fully rounded) |

### Container Widths

| Variant | Max Width | Padding |
|---|---|---|
| Default content | `1024px` | `32px` horizontal |
| Wide content | `1152px` | `0px` |
| Narrow content | `896px` | `0px` |
| Tight content | `448px` | `0px` |

### Section Padding

- Sections use generous vertical spacing: `80px` to `120px` vertical padding
- Footer: `80px` vertical padding

---

## Buttons

### Primary Button (CTA)

| Property | Value |
|---|---|
| Background | `#ff006e` (neon pink) |
| Text color | `#ffffff` |
| Font size | 16px (body) / 14px (navbar compact) |
| Font weight | 500 |
| Font family | Poppins |
| Padding | `16px 32px` (body) / `0px 12px` (navbar compact) |
| Border | none |
| Border radius | `0px` (sharp square) |
| Box shadow | `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.1)` |
| Cursor | pointer |
| Disabled opacity | `0.5` |
| Disabled cursor | `not-allowed` |

### Secondary / Outline Button

| Property | Value |
|---|---|
| Background | transparent |
| Text color | `#8b5cf6` (purple) or `#ff006e` (pink) |
| Border | `1px solid` matching text color |
| Font size | 16px |
| Font weight | 500 |
| Padding | `16px 32px` |
| Border radius | `0px` |
| Box shadow | none |

### Button Hover

Buttons use subtle transitions. The primary CTA maintains its color on hover (no dramatic color shift observed). Hover effects rely on `opacity` and `transform` transitions.

---

## Shadows

### Shadow Tokens

| Token | Light Mode | Dark Mode |
|---|---|---|
| `--shadow-card` | `0 1px 3px #0000001a, 0 1px 2px #0000000f` | `none` |
| `--shadow-card-large` | `0 10px 15px #0000001a, 0 4px 6px #0000000d` | `none` |
| `--shadow-dropdown` | `0 10px 25px #00000026, 0 4px 10px #0000001a` | `0 10px 25px #00000080, 0 4px 10px #0000004d` |

### Key Principle

Shadows are **removed in dark mode** for cards (set to `none`). Only dropdowns retain shadow, but with heavier opacity. Dark mode relies on border contrast (`rgba(255,255,255,0.1)`) instead of shadows.

---

## Borders

### Border Colors

| Context | Light | Dark |
|---|---|---|
| Default | `rgba(0, 0, 0, 0.1)` | `rgba(255, 255, 255, 0.1)` |
| Subtle | `rgba(0, 0, 0, 0.03)` | `rgba(255, 255, 255, 0.03)` |
| Accent (teal) | `oklch(0.696 0.17 162.48 / 0.3)` | same |
| Accent (amber) | `oklch(0.769 0.188 70.08 / 0.3)` | same |
| Accent (red) | `oklch(0.637 0.237 25.33 / 0.3)` | same |
| Primary | `#ff006e` | `#ff006e` |
| Secondary | `#8b5cf6` | `#8b5cf6` |

### Border Widths

- Standard: `1px`
- Navbar bottom: `1px solid` with border color
- Footer top: `1px solid` with subtle border color

---

## Cards

### Standard Card

| Property | Light | Dark |
|---|---|---|
| Background | `rgba(255,255,255,0.95)` | `rgba(26,26,26,0.5)` |
| Border | `1px solid rgba(0,0,0,0.05)` | `1px solid rgba(255,255,255,0.1)` |
| Border radius | `8px` | `8px` |
| Box shadow | `--shadow-card` | `none` |
| Padding | `24px` | `24px` |

### Accent Cards (tinted by brand color)

Cards can be tinted with a very low opacity brand color background + matching border:

- **Teal card**: bg `oklch(0.696 ... / 0.05)`, border `oklch(0.696 ... / 0.3)`, radius `8px`
- **Amber card**: bg `oklch(0.769 ... / 0.05)`, border `oklch(0.769 ... / 0.3)`, radius `8px`
- **Red card**: bg `oklch(0.637 ... / 0.05)`, border `oklch(0.637 ... / 0.3)`, radius `8px`

---

## Forms

### Text Input

| Property | Light | Dark |
|---|---|---|
| Background | `rgba(248,249,250,1)` | `rgba(255,255,255,0.03)` |
| Text color | `--foreground` | `#ffffff` |
| Border | `1px solid rgba(0,0,0,0.1)` | `1px solid rgba(255,255,255,0.1)` |
| Border radius | `2px` |
| Height | `56px` |
| Padding | `4px 16px` |
| Font size | `14px` |
| Font family | Poppins |
| Focus ring | `#ff006e` at 50% opacity |
| Transition | `0.2s cubic-bezier(0.4, 0, 0.2, 1)` |

### Select / Combobox

Same as text input but with `8px 16px` padding and `16px` font size.

### Checkbox

| Property | Value |
|---|---|
| Size | `20px x 20px` |
| Background | `--background` |
| Border | `1px solid` with border token |
| Border radius | `4px` |
| Checked color | `#ff006e` (primary) |

### Form Labels

| Property | Value |
|---|---|
| Font size | 16px |
| Font weight | 500 |
| Color | `--foreground` |

---

## Navigation Bar

| Property | Value |
|---|---|
| Position | `fixed` |
| Z-index | `50` |
| Height | `73px` |
| Background | `rgba(255,255,255,0.9)` light / `rgba(10,10,10,0.9)` dark |
| Backdrop filter | `blur(16px)` |
| Border bottom | `1px solid` with `--border` |
| Nav link font size | `14px` |
| Nav link font weight | `500` |
| Nav link color | `--foreground` |
| Active link decoration | none (color change implied) |

---

## Footer

| Property | Value |
|---|---|
| Background | transparent |
| Text color | `--foreground` |
| Padding | `80px 0` |
| Border top | `1px solid` with subtle border color |
| Link color | `--muted-foreground`, `--primary` for email links |
| Footer description font | 14px, 400 weight |

---

## Transitions & Animations

### Standard Easing

- **Easing function**: `cubic-bezier(0.4, 0, 0.2, 1)` (Material Design standard easing)

### Duration Scale

| Duration | Usage |
|---|---|
| `150ms` | Color, background-color, border-color, opacity transitions (default) |
| `200ms` | Form input focus states |
| `300ms` | Transform, scale, translate |
| `500ms` | Layout transitions |
| `700ms` | Enter animations |
| `1000ms` | Fade-in opacity |

### Transition Properties

```css
/* Default color transition */
transition: color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
            background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
            border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
            outline-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);

/* Transform transition */
transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
            scale 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

---

## Iconography

- Icons are inline SVGs or optimized PNGs served through Next.js image optimization
- Section icons use brand accent colors (teal, purple, pink)
- Checkmark/list icons use brand teal (`#00d4aa`)
- Navigation chevrons and form icons: inline SVG, `currentColor`

---

## Design Principles Summary

1. **Dark-first hero sections**: Hero areas use dark photographic backgrounds with white text and neon-colored keyword highlights
2. **Sharp buttons**: All buttons use `border-radius: 0` — intentionally sharp/square
3. **Soft cards**: Cards use `border-radius: 8px` with subtle borders and shadows
4. **Neon triad**: The three brand colors (pink, purple, teal) rotate across sections for visual rhythm
5. **No shadows in dark mode**: Cards lose shadows and rely on border contrast
6. **Glass navbar**: Fixed with backdrop blur and semi-transparent background
7. **Generous whitespace**: Large section padding (80-120px vertical), spacious content areas
8. **Consistent type scale**: Poppins at 5 weights, line height locked at 1.3x
9. **Uppercase overlines**: Section labels are always uppercase with wide letter spacing
10. **Color as hierarchy**: Headings use purple/pink for emphasis; body text stays neutral

---

## CSS Variables Reference (Copy-Paste Ready)

```css
:root {
  --font-sans: var(--font-poppins);
  --radius: 0.25rem;

  /* Brand */
  --neon-pink: #ff006e;
  --neon-purple: #8b5cf6;
  --neon-teal: #00d4aa;

  /* Surfaces */
  --background: #fff;
  --foreground: #0a0a0a;
  --card: #f8f9fa;
  --card-foreground: #0a0a0a;
  --popover: #fff;
  --popover-foreground: #0a0a0a;

  /* Actions */
  --primary: #ff006e;
  --primary-foreground: #fff;
  --secondary: #8b5cf6;
  --secondary-foreground: #fff;
  --accent: #ff006e;
  --accent-foreground: #fff;

  /* Neutral */
  --muted: #f1f5f9;
  --muted-foreground: #374151;
  --muted-foreground-secondary: #6b7280;
  --muted-foreground-faint: #9ca3af;
  --destructive: #d4183d;
  --destructive-foreground: #fff;

  /* Borders & Inputs */
  --border: #0000001a;
  --input: #0000001a;
  --input-background: #f8f9fa;
  --switch-background: #e2e8f0;
  --ring: #ff006e;

  /* Charts */
  --chart-1: #ff006e;
  --chart-2: #8b5cf6;
  --chart-3: #00d4aa;
  --chart-4: gold;
  --chart-5: #ff4500;

  /* Sidebar */
  --sidebar: #f8f9fa;
  --sidebar-foreground: #0a0a0a;
  --sidebar-primary: #ff006e;
  --sidebar-primary-foreground: #fff;
  --sidebar-accent: #f1f5f9;
  --sidebar-accent-foreground: #0a0a0a;
  --sidebar-border: #0000001a;
  --sidebar-ring: #ff006e;

  /* Space */
  --space-dark: #f8f9fa;
  --space-darker: #f1f5f9;

  /* Shadows */
  --shadow-card: 0 1px 3px #0000001a, 0 1px 2px #0000000f;
  --shadow-card-large: 0 10px 15px #0000001a, 0 4px 6px #0000000d;
  --shadow-dropdown: 0 10px 25px #00000026, 0 4px 10px #0000001a;
}

.dark {
  --background: #0a0a0a;
  --foreground: #fff;
  --card: #1a1a1a;
  --card-foreground: #fff;
  --popover: #1a1a1a;
  --popover-foreground: #fff;
  --primary: #ff006e;
  --primary-foreground: #fff;
  --secondary: #8b5cf6;
  --secondary-foreground: #fff;
  --accent: #ff006e;
  --accent-foreground: #fff;
  --muted: #2a2a2a;
  --muted-foreground: #d1d5db;
  --muted-foreground-secondary: #9ca3af;
  --muted-foreground-faint: #6b7280;
  --destructive: #d4183d;
  --destructive-foreground: #fff;
  --border: #ffffff1a;
  --input: #ffffff1a;
  --input-background: #2a2a2a;
  --switch-background: #3a3a3a;
  --ring: #ff006e;
  --sidebar: #1a1a1a;
  --sidebar-foreground: #fff;
  --sidebar-primary: #ff006e;
  --sidebar-primary-foreground: #fff;
  --sidebar-accent: #2a2a2a;
  --sidebar-accent-foreground: #fff;
  --sidebar-border: #ffffff1a;
  --sidebar-ring: #ff006e;
  --space-dark: #0a0a0a;
  --space-darker: #050505;
  --shadow-card: none;
  --shadow-card-large: none;
  --shadow-dropdown: 0 10px 25px #00000080, 0 4px 10px #0000004d;
}
```

---

## App Icon & Logo Assets

All T3-branded assets have been replaced with XBE neon X branding.

### Source Images

| File | Size | Description |
|---|---|---|
| `tmp/x.png` | 1024x1024 | Neon X icon (1x, dev source) |
| `tmp/x@2x.jpg` | 2048x2048 | Neon X icon (2x, prod source) |
| `tmp/xbe.webp` | 96x40 | XBE guard wordmark (white on transparent) |

### Dev Assets (`assets/dev/`)

| File | Size | Platform |
|---|---|---|
| `xbe-dev-ios-1024.png` | 1024x1024 | iOS (full square, no alpha) |
| `xbe-dev-macos-1024.png` | 1024x1024 | macOS (squircle mask + drop shadow on transparent) |
| `xbe-dev-universal-1024.png` | 1024x1024 | Linux / universal |
| `xbe-dev-web-apple-touch-180.png` | 180x180 | Apple touch icon |
| `xbe-dev-web-favicon-32x32.png` | 32x32 | Web favicon |
| `xbe-dev-web-favicon-16x16.png` | 16x16 | Web favicon |
| `xbe-dev-web-favicon.ico` | 16-48 multi | Web favicon ICO |
| `xbe-dev-windows.ico` | 16-256 multi | Windows ICO |

### Prod Assets (`assets/prod/`)

| File | Size | Platform |
|---|---|---|
| `xbe-ios-1024.png` | 1024x1024 | iOS (from 2x source) |
| `xbe-macos-1024.png` | 1024x1024 | macOS squircle + shadow |
| `xbe-universal-1024.png` | 1024x1024 | Linux / universal |
| `xbe-web-apple-touch-180.png` | 180x180 | Apple touch icon |
| `xbe-web-favicon-32x32.png` | 32x32 | Web favicon |
| `xbe-web-favicon-16x16.png` | 16x16 | Web favicon |
| `xbe-web-favicon.ico` | 16-48 multi | Web favicon ICO |
| `xbe-windows.ico` | 16-256 multi | Windows ICO |
| `logo.svg` | 128x128 | SVG X with purple-to-pink gradient |

### Deployed Locations

| Target | Source |
|---|---|
| `apps/web/public/favicon.ico` | `assets/prod/xbe-web-favicon.ico` |
| `apps/web/public/favicon-16x16.png` | `assets/prod/xbe-web-favicon-16x16.png` |
| `apps/web/public/favicon-32x32.png` | `assets/prod/xbe-web-favicon-32x32.png` |
| `apps/web/public/apple-touch-icon.png` | `assets/prod/xbe-web-apple-touch-180.png` |
| `apps/web/public/xbe-wordmark.png` | XBE guard logo for sidebar wordmark |
| `apps/desktop/resources/icon.png` | `assets/prod/xbe-ios-1024.png` |
| `apps/desktop/resources/icon.ico` | `assets/prod/xbe-windows.ico` |
| `apps/marketing/public/*` | Same as web public |

### Build System

Asset paths are configured in `scripts/lib/brand-assets.ts` which maps dev/prod icon files to their build output targets.

### Note

`apps/desktop/resources/icon.icns` (macOS bundle) requires `iconutil` (macOS-only) to regenerate. The iconset PNGs are prepared — run on macOS:
```sh
iconutil -c icns /tmp/xbe.iconset -o apps/desktop/resources/icon.icns
```
