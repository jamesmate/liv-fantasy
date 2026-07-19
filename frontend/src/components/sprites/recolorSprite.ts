import regionMapSunglasses from "./regionMap.json";
import regionMapGolf from "./regionMapGolf.json";
import regionMapPlain from "./regionMapPlain.json";
import regionMapCap from "./regionMapCap.json";

/**
 * Recolors hand-drawn base sprites per player.
 * ---------------------------------------------------
 * Base sprites (public/sprites/base-sprite*.png) are real, hand-
 * painted pixel art with deliberate multi-shade shading (e.g. the hair
 * has several browns blending into each other for texture) - they are
 * NOT flat single-color regions, so naive "replace this exact hex with
 * that exact hex" color-swapping would only catch a few pixels and
 * leave the rest of each shaded region unchanged.
 *
 * Instead, this converts each pixel to HSV, keeps its Value
 * (brightness - which is what encodes the original shading/texture),
 * and replaces only its Hue and Saturation with the target color's.
 * This recolors a whole region to a new color while preserving every
 * brushstroke of shading the original artist drew.
 *
 * There are FOUR poses, each with its own base PNG and its own
 * precomputed region map (same dimensions as that pose's sprite):
 *   - "plain": standing pose, no hat/sunglasses, hair fully visible
 *   - "sunglasses": standing pose, wearing sunglasses
 *   - "cap": standing pose, wearing a cap, no club
 *   - "golf": holding a golf club, wearing a cap - RESERVED for
 *     whichever player currently has the best score in the round
 *     being displayed, not randomly assigned like the other poses
 *     (callers decide this, e.g. by comparing live scores)
 * Most players are deterministically assigned one of plain/sunglasses/
 * cap (see spritePalette.ts) - some players render in one pose, some
 * another, same idea as hair/clothing color variation.
 *
 * Each region grid cell is either a region name or null for pixels
 * that should never be recolored (outlines, background, the golf club
 * itself, and anything ambiguous - left untouched is always the safe
 * default).
 */

export type SpritePose = "plain" | "sunglasses" | "cap" | "golf";

export type RegionName =
  | "hair"
  | "vest"
  | "shirt"
  | "skin"
  | "sunglasses"
  | "cap"
  | "trousers"
  | "shoes"
  | "mouth";

interface PoseConfig {
  imagePath: string;
  regionGrid: (RegionName | null)[][];
  width: number;
  height: number;
}

const POSES: Record<SpritePose, PoseConfig> = {
  plain: {
    imagePath: "/sprites/base-sprite-plain.png",
    regionGrid: regionMapPlain as (RegionName | null)[][],
    width: 13,
    height: 23,
  },
  sunglasses: {
    imagePath: "/sprites/base-sprite.png",
    regionGrid: regionMapSunglasses as (RegionName | null)[][],
    width: 13,
    height: 23,
  },
  cap: {
    imagePath: "/sprites/base-sprite-cap.png",
    regionGrid: regionMapCap as (RegionName | null)[][],
    width: 15,
    height: 23,
  },
  golf: {
    imagePath: "/sprites/base-sprite-golf.png",
    regionGrid: regionMapGolf as (RegionName | null)[][],
    width: 24,
    height: 24,
  },
};

export interface HueSatTarget {
  hue: number; // 0-1
  saturation: number; // 0-1
}

/**
 * Converts a hex color (e.g. "#2d5a3d") to the hue/saturation target
 * format this module works in - used for overriding a region's color
 * with something chosen outside the deterministic per-player palette
 * (e.g. a member's own team color), while still going through the
 * same HSV-preserving-brightness recolor logic as everything else.
 */
export function hexToHueSat(hex: string): HueSatTarget {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const [h, s] = rgbToHsv(r, g, b);
  return { hue: h, saturation: s };
}

const baseImageCache = new Map<SpritePose, HTMLImageElement>();
const baseImageLoadPromises = new Map<SpritePose, Promise<HTMLImageElement>>();

function loadBaseImage(pose: SpritePose): Promise<HTMLImageElement> {
  const cached = baseImageCache.get(pose);
  if (cached) return Promise.resolve(cached);
  const inFlight = baseImageLoadPromises.get(pose);
  if (inFlight) return inFlight;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      baseImageCache.set(pose, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = POSES[pose].imagePath;
  });
  baseImageLoadPromises.set(pose, promise);
  return promise;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export interface RecolorTargets {
  hair?: HueSatTarget;
  clothing?: HueSatTarget; // applies to both "vest" and "shirt" regions together
  skin?: HueSatTarget;
  cap?: HueSatTarget; // only used by poses that have a "cap" region (e.g. "golf")
}

/**
 * Renders the recolored sprite for the given pose onto the given
 * canvas at the requested pixel size. Call this from a useEffect
 * after the canvas ref is available - it's async because each pose's
 * base image loads once and is cached for all subsequent calls.
 */
export async function renderRecoloredSprite(
  canvas: HTMLCanvasElement,
  pose: SpritePose,
  targets: RecolorTargets,
  pixelSize: number
): Promise<void> {
  const config = POSES[pose];
  const img = await loadBaseImage(pose);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const offscreen = document.createElement("canvas");
  offscreen.width = w;
  offscreen.height = h;
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return;
  offCtx.drawImage(img, 0, 0);
  const imageData = offCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const region = config.regionGrid[y]?.[x] ?? null;
      if (!region) continue;

      const target =
        region === "hair"
          ? targets.hair
          : region === "vest" || region === "shirt"
          ? targets.clothing
          : region === "skin"
          ? targets.skin
          : region === "cap"
          ? targets.cap
          : undefined;
      if (!target) continue;

      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const alpha = data[idx + 3];
      if (alpha === 0) continue;

      const [, , v] = rgbToHsv(r, g, b);
      const [nr, ng, nb] = hsvToRgb(target.hue, target.saturation, v);
      data[idx] = nr;
      data[idx + 1] = ng;
      data[idx + 2] = nb;
    }
  }

  offCtx.putImageData(imageData, 0, 0);

  canvas.width = w * pixelSize;
  canvas.height = h * pixelSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
}

/** Native pixel dimensions for a given pose - used by callers to size their canvas/container correctly. */
export function getSpriteDimensions(pose: SpritePose): { width: number; height: number } {
  return { width: POSES[pose].width, height: POSES[pose].height };
}
