/** @type {import('tailwindcss').Config} */

/* Every colour in this file resolves to a Code Guru design token defined in
 * src/styles/codeguru-theme.css, which app/layout.tsx imports.
 *
 * Why remap the scales instead of rewriting the classes:
 * PairPath routes roughly 200 class usages through the named scales below, so
 * repointing the scales reskins almost the whole app without touching a single
 * .tsx file. Everything keeps working, including opacity modifiers like
 * `bg-surface-800/50` - that is why the tokens are stored as raw "R G B"
 * triplets and interpolated with `<alpha-value>` rather than as finished
 * colours.
 *
 * The neutral ramp below is deliberately NON-MONOTONIC, because that is how
 * the codebase actually uses it: a high number means "background depth"
 * (950 = page, 800 = card) and a low number means "text prominence"
 * (400 = muted, 200 = heading). Reading it as one continuous light-to-dark
 * ramp would be wrong. Anything that uses `surface-*` against that convention
 * will invert, so new code should follow the comments on each step.
 */

// The neutral ramp: page depth at the top, text prominence at the bottom.
const neutral = {
  950: 'rgb(var(--cg-rgb-page) / <alpha-value>)',          // page background
  900: 'rgb(var(--cg-rgb-card) / <alpha-value>)',          // card
  800: 'rgb(var(--cg-rgb-card) / <alpha-value>)',          // card / input
  700: 'rgb(var(--cg-rgb-border) / <alpha-value>)',        // border
  600: 'rgb(var(--cg-rgb-border-strong) / <alpha-value>)', // stronger border
  500: 'rgb(var(--cg-rgb-muted) / <alpha-value>)',         // placeholder
  400: 'rgb(var(--cg-rgb-muted) / <alpha-value>)',         // muted text
  300: 'rgb(var(--cg-rgb-body) / <alpha-value>)',          // body text
  200: 'rgb(var(--cg-rgb-ink) / <alpha-value>)',           // heading text
  100: 'rgb(var(--cg-rgb-ink) / <alpha-value>)',
  50: 'rgb(var(--cg-rgb-ink) / <alpha-value>)',
};

// A one-hue scale. Steps 50-200 are the tinted fill, everything else is the
// solid colour, so both `bg-red-500` and `bg-red-500/10` still read correctly.
const ramp = (base, soft) => ({
  50: `rgb(var(${soft}) / <alpha-value>)`,
  100: `rgb(var(${soft}) / <alpha-value>)`,
  200: `rgb(var(${soft}) / <alpha-value>)`,
  300: `rgb(var(${base}) / <alpha-value>)`,
  400: `rgb(var(${base}) / <alpha-value>)`,
  500: `rgb(var(${base}) / <alpha-value>)`,
  600: `rgb(var(${base}) / <alpha-value>)`,
  700: `rgb(var(${base}) / <alpha-value>)`,
  800: `rgb(var(${base}) / <alpha-value>)`,
  900: `rgb(var(${base}) / <alpha-value>)`,
  950: `rgb(var(${base}) / <alpha-value>)`,
});

const blue = {
  ...ramp('--cg-rgb-accent', '--cg-rgb-accent-soft'),
  400: 'rgb(var(--cg-rgb-accent) / <alpha-value>)',
  500: 'rgb(var(--cg-rgb-accent) / <alpha-value>)',
  600: 'rgb(var(--cg-rgb-accent) / <alpha-value>)',
  700: 'rgb(var(--cg-rgb-accent-strong) / <alpha-value>)',
  800: 'rgb(var(--cg-rgb-accent-strong) / <alpha-value>)',
};

const ok = ramp('--cg-rgb-ok', '--cg-rgb-ok-soft');
const warn = ramp('--cg-rgb-warn', '--cg-rgb-warn-soft');
const danger = ramp('--cg-rgb-danger', '--cg-rgb-danger-soft');

module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // The app's own names.
        primary: blue,
        accent: ok, // PairPath's "accent" is its success green (join, submit)
        surface: neutral,

        // Loose Tailwind palettes the pages reach for directly. Without these
        // they would still render Tailwind's stock dark-on-dark values and the
        // app would end up half-themed.
        zinc: neutral,
        slate: neutral,
        indigo: blue,
        blue: blue,
        violet: blue,
        purple: blue,
        sky: blue,
        cyan: blue,

        // Semantic hues stay genuinely green/amber/red - a struggle level and
        // a failed review have to keep reading as warn and fail. They are
        // pinned to the shared ramp so they match across all four services,
        // and darkened for a light page: Tailwind's stock 400 steps were
        // picked for dark backgrounds and fall well under 4.5:1 on white
        // (emerald-400 is 2.2:1, amber-400 is 2.0:1).
        green: ok,
        emerald: ok,
        teal: ok,
        amber: warn,
        yellow: warn,
        orange: warn,
        red: danger,
        rose: danger,
        pink: danger,

        // `gray` is left at Tailwind's defaults on purpose: it is used only on
        // the marketing page, which was already styled light.
      },
      fontFamily: {
        sans: ['var(--cg-font)'],
        mono: ['var(--cg-font-mono)'],
      },
      borderRadius: {
        cg: 'var(--cg-radius)',
      },
      animation: {
        glow: 'glow 2s ease-in-out infinite alternate',
        'pulse-soft': 'pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        highlight: 'highlight 1.5s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        // Same motion as before; the glow is now the platform blue and the
        // highlight the platform amber, instead of hardcoded indigo/yellow.
        glow: {
          '0%': { boxShadow: '0 0 5px rgb(var(--cg-rgb-accent) / 0.5)' },
          '100%': {
            boxShadow:
              '0 0 20px rgb(var(--cg-rgb-accent) / 0.8), 0 0 40px rgb(var(--cg-rgb-accent) / 0.4)',
          },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6', transform: 'scale(1.02)' },
        },
        highlight: {
          '0%, 100%': { borderColor: 'rgb(var(--cg-rgb-warn) / 0.3)' },
          '50%': {
            borderColor: 'rgb(var(--cg-rgb-warn) / 1)',
            boxShadow: '0 0 15px rgb(var(--cg-rgb-warn) / 0.3)',
          },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
