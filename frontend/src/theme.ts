import { createTheme, MantineColorsTuple } from "@mantine/core";

// LIV Golf's real brand palette: a deep forest green for structural
// chrome (logos, headers, primary text) paired with a bold, bright
// lime/acid green for active and selected states - confirmed against
// LIV's own scores page and brand coverage describing their look as
// "a bolder, brighter take on traditional golf green, with a bright
// lime-green accent" rather than the deep traditional greens most golf
// broadcasts use. Background is a light cream, matching the actual
// livgolf.com site, replacing this app's previous dark theme.
//
// Color names kept the same as before (mint, forest, coral, tangerine)
// so existing page code (color="mint", c="forest.7", etc.) doesn't
// need touching - only the underlying hex values changed.
const mint: MantineColorsTuple = [
  "#f4fce3",
  "#e1f5ad",
  "#c8ea6e",
  "#aedb3c",
  "#94cc1e", // bright lime accent - primary brand green
  "#7ab814",
  "#5f9b0c",
  "#487a08",
  "#345c05",
  "#243f03",
];

// IMPORTANT: index roles are preserved from the old dark theme so
// existing page code (bg="forest.7" for card surfaces, c="forest.1"
// /"forest.2"/"forest.3" for secondary text on those surfaces) keeps
// working correctly without every page needing to be touched - only
// the actual hex values changed, not which index plays which role.
//   0       = app page background (cream)
//   1-3     = secondary/muted text, readable on a white/cream card (darkest = 1, lightest = 3)
//   7       = card surface color (white, was previously a dark surface)
//   8-9     = darkest text / structural chrome (headers, logo, nav)
const forest: MantineColorsTuple = [
  "#f7f5ee", // 0: cream page background, matches livgolf.com
  "#3a4a34", // 1: darkest secondary text - body copy on cards
  "#5a6b54", // 2: mid secondary text - sub-labels, captions
  "#7c8772", // 3: lightest secondary text - the most muted tier
  "#a9ad9c",
  "#cfd0c4",
  "#e2e3d8",
  "#ffffff", // 7: card surface (white) - was a dark surface before
  "#142013", // 8: deep forest - structural brand green (headers, nav, logo bg)
  "#0c1410", // 9: near-black green, reserved for max-contrast text
];

// Secondary accents, kept for alerts/badges - not LIV-branded but
// functionally distinct from the green system and visually compatible
// with it (used sparingly: withdrawn players, swap prompts, etc).
const coral: MantineColorsTuple = [
  "#ffe9ee",
  "#ffd1db",
  "#ffa3b8",
  "#ff7494",
  "#ff4a75",
  "#fa2c60",
  "#e01e52",
  "#c11346",
  "#a30b3c",
  "#870433",
];

const tangerine: MantineColorsTuple = [
  "#fff1e0",
  "#ffe0bd",
  "#ffc585",
  "#ffaa54",
  "#ff9230",
  "#fb7e12",
  "#e26f08",
  "#c25e03",
  "#a14f02",
  "#824000",
];

export const theme = createTheme({
  primaryColor: "mint",
  colors: {
    mint,
    forest,
    coral,
    tangerine,
  },
  fontFamily: "'Inter', system-ui, sans-serif",
  headings: {
    fontFamily: "'Poppins', 'Inter', system-ui, sans-serif",
    fontWeight: "700",
  },
  defaultRadius: "lg",
  components: {
    Card: {
      defaultProps: {
        radius: "lg",
        withBorder: true,
      },
      styles: {
        root: {
          borderWidth: 2,
          borderColor: "var(--mantine-color-forest-2)",
        },
      },
    },
    Button: {
      defaultProps: {
        radius: "md",
      },
      styles: {
        root: {
          fontFamily: "'Poppins', sans-serif",
          fontWeight: 700,
        },
      },
    },
    Badge: {
      defaultProps: {
        radius: "sm",
      },
    },
  },
  other: {
    pageBackground: forest[0],
    cardBackground: "#ffffff",
    cardBorder: forest[2],
  },
});
