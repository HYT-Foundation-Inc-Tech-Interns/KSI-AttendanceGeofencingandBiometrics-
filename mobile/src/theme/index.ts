/**
 * Klassic theme — the single source of truth for colour in the mobile app.
 *
 * Before this file existed every screen hardcoded its own palette: 19 uses of
 * Material blue `#2196F3`, 11 of iOS blue `#007AFF`, 9 of `#F44336` red and 6 of
 * `#4CAF50` green, spread across screens that never agreed with each other or
 * with the dashboard.
 *
 * The values below are the logo palette, extracted from the artwork by pixel
 * sampling — the same tokens the dashboard uses (see dashboard globals.css).
 * Nothing here is invented.
 *
 * Contrast rules, measured against white, are constraints rather than taste:
 *
 *   brand800  #285709   8.55:1  body text, headings, primary ink
 *   brand700  #3D7A17   5.26:1  the default action colour: legible as text on a
 *                               light surface AND as a fill under a white label
 *   brand600  #519B24   3.46:1  icons and marks only — never small body text
 *   lime400   #B7D334   1.70:1  DARK SURFACES ONLY (5.04:1 on brand800)
 *   silver800 #6B6A6A   5.33:1  secondary text
 *   silver700 #858585   3.69:1  icons and chrome — the non-text 3:1 floor
 *   silver500 #A8A7A7   2.38:1  borders and disabled fills — never text or icons
 *   critical  #A33A2E   6.56:1  errors, check-out, out-of-geofence
 *   warning   #8A6116   5.52:1  pending / attention
 *
 * Two rules follow and are enforced across the app:
 *   1. Lime is a dark-surface colour. It appears on brand800, never as text on
 *      white.
 *   2. Status is never colour-alone. Every status the app renders also carries
 *      an icon and a word, and that pairing is the accessibility mitigation.
 *
 * On the two functional colours: `warning` and `critical` sit close together in
 * OKLab (ΔE 10.8 normal vision, 3.1 under deuteranopia), which the dataviz
 * palette validator flags. That validator is scoped to categorical palettes
 * where hue alone carries identity; these are status colours, and the same
 * tool's scope note points them at WCAG text contrast — 5.52:1 and 6.56:1 on
 * white, 5.16:1 and 5.91:1 on their own tints. Rule 2 is what disambiguates
 * them. Moving the amber far enough to satisfy the categorical check costs it
 * WCAG AA on the tint it is actually drawn on, so it stays where it is.
 */

export const colors = {
  /** The wordmark green. Primary ink on light surfaces. */
  brand900: '#1F4407',
  brand800: '#285709',
  brand700: '#3D7A17',
  brand600: '#519B24',
  brand200: '#C7DDB6',
  brand50: '#F2F7EC',

  /** The swoosh tip. Dark surfaces only. */
  lime400: '#B7D334',

  /** The gear. This ramp is the logo's neutral. */
  silver50: '#FAFAF9',
  silver100: '#F2F1F0',
  silver200: '#E6E5E4',
  silver300: '#D9D7D6',
  silver500: '#A8A7A7',
  silver600: '#979696',
  /** Icon and chrome floor: 3.69:1, clears the 3:1 non-text requirement. */
  silver700: '#858585',
  silver800: '#6B6A6A',
  silver950: '#2B2A2A',

  /** Reserved status. Never decorative, never a stand-in for "series 2". */
  critical: '#A33A2E',
  criticalSoft: '#FBF1EF',
  criticalSoftBorder: '#EDC5BE',
  warning: '#8A6116',
  warningSoft: '#FBF7ED',
  warningSoftBorder: '#EDD9AC',

  // ---- Semantic aliases. Screens should use these, not the steps above. ----

  /** Default action colour: button fills, active tints, links, icons. */
  primary: '#3D7A17',
  /** Pressed / emphasised primary. */
  primaryDark: '#285709',
  /** Tinted surface behind primary content (selected rows, info callouts). */
  primarySoft: '#F2F7EC',
  primarySoftBorder: '#C7DDB6',

  /** Positive state — check-in, inside the geofence, verified. */
  success: '#3D7A17',
  successSoft: '#F2F7EC',

  /** Negative state — check-out, error, outside the geofence, rejected. */
  danger: '#A33A2E',
  dangerSoft: '#FBF1EF',
  dangerSoftBorder: '#EDC5BE',

  /** Text. */
  text: '#2B2A2A',
  textSecondary: '#6B6A6A',
  /** On a dark brand surface: white body, lime for accents. */
  textOnBrand: '#FFFFFF',
  textOnBrandMuted: '#B7D334',

  /** Surfaces. */
  background: '#FAFAF9',
  surface: '#FFFFFF',
  border: '#E6E5E4',
  borderStrong: '#D9D7D6',
  /** Disabled fills and placeholder text. Never used for readable content. */
  disabled: '#A8A7A7',

  /*
   * Overlays. These are not brand colours — they are planes laid over a live
   * camera feed, where white text has to stay legible against whatever the
   * camera happens to be pointing at.
   */
  /** Camera letterbox. Black is the convention here, not ink. */
  cameraBackdrop: '#000000',
  /** Behind a caption sitting directly on the camera feed. */
  scrim: 'rgba(0,0,0,0.5)',
  /** The countdown disc: brand700 at 0.9 so the face stays partly visible. */
  primaryOverlay: 'rgba(61,122,23,0.9)',
} as const;

/** 4pt base scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' as const },
  heading: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;

export const theme = { colors, spacing, radii, typography } as const;

export default theme;
