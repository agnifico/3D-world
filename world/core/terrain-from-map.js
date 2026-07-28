// World Shell — builds a zone's heightfield from a hand-painted band map (a
// PNG where each flat color = one terrain band: LAND/SHALLOW/WADE/REEF/DEEP,
// or whatever set a zone's legend defines). Reads pixels via an offscreen
// canvas, so this module is browser-only (unlike a zone's own terrain.js,
// which stays plain data + math) — no three import either way, but no
// Node-testability claim here: image decode is inherently async + DOM.
//
// Orientation convention (one convention, forever): image row 0 = top =
// world NORTH = world MINIMUM Z (-extent); image bottom = SOUTH = +extent.
// Image column 0 = left = WEST = minimum X (-extent); right = EAST =
// +extent. Matches a zone's own "X east, Z south" convention and ordinary
// north-up map reading.
//
// await loadTerrainMap(url, legend, opts) -> { terrainHeight(x,z), bandAt(x,z) }
//   legend: [{ id, color:'#rrggbb', height }, ...] — height is the FLAT
//     target for that band before blur/noise. Classification picks
//     whichever legend color is nearest (RGB distance) to each pixel.
//   opts:
//     extent      — world spans [-extent, extent] on X and Z (default 100)
//     tolerance    — max RGB distance (0..441.7) accepted as "this pixel IS
//                    that band"; anything farther (hand-drawn labels,
//                    anti-aliasing fringe) is unclassified and instead
//                    inherits its nearest classified neighbor, so labels
//                    vanish into their surroundings instead of spiking the
//                    terrain
//     blurRadius, blurPasses — box-blur the raw band-height grid this many
//                    times at this radius (sliding-window box blur, O(1)
//                    per pixel regardless of radius) — this is what turns a
//                    hard band edge into a gentle slope. 3 passes of a
//                    modest radius approximates a soft gaussian cheaply;
//                    tune per zone (lagoon = wider/rolling, a future cliffy
//                    zone = radius 1, 1 pass = nearly no smoothing)
//     noiseAmp     — { [bandId]: amplitude } extra low-frequency value-noise
//                    added AFTER blur, selected by each cell's ORIGINAL
//                    (pre-blur) band — so e.g. a runnable shallow-water band
//                    can stay flat (amplitude 0) while dry land gets dune
//                    texture, independent of how the blur graded the edges
//     noiseScale   — shared horizontal frequency for that detail noise, OR
//                    { [bandId]: frequency } to vary it per band (evaluated
//                    in WORLD units, not pixels, so it doesn't depend on the
//                    source image's resolution)

// ── private noise helpers (self-contained — no cross-zone sharing needed
// for a single detail-texture pass) ─────────────────────────────────────────
function hash2(ix, iz) {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz),     b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, z, oct = 3) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * (vnoise(x * freq, z * freq) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Sliding-window box blur, O(1) per pixel regardless of radius (running sum
// instead of re-summing the window every pixel). Edge-clamped.
function boxBlur(src, W, H, radius) {
  const N = W * H;
  const tmp = new Float32Array(N);
  const dst = new Float32Array(N);
  const span = 2 * radius + 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = sum / span;
      const outIdx = row + Math.min(W - 1, Math.max(0, x - radius));
      const inIdx = row + Math.min(W - 1, Math.max(0, x + radius + 1));
      sum += src[inIdx] - src[outIdx];
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      dst[y * W + x] = sum / span;
      const outIdx = Math.min(H - 1, Math.max(0, y - radius)) * W + x;
      const inIdx = Math.min(H - 1, Math.max(0, y + radius + 1)) * W + x;
      sum += tmp[inIdx] - tmp[outIdx];
    }
  }
  return dst;
}

export async function loadTerrainMap(url, legend, opts = {}) {
  const {
    extent = 100,
    tolerance = 60,
    blurRadius = 4,
    blurPasses = 3,
    noiseAmp = {},
    noiseScale = 0.08,
  } = opts;

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`[terrain-from-map] failed to load ${url}`));
    im.src = url;
  });

  const W = img.naturalWidth, H = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
  ctx2d.drawImage(img, 0, 0);
  const { data } = ctx2d.getImageData(0, 0, W, H); // RGBA, row 0 = top (see orientation convention above)

  const N = W * H;
  const legendRgb = legend.map(e => hexToRgb(e.color));
  const bandIdx = new Int16Array(N).fill(-1);

  // 1. classify every pixel to its nearest legend color, within tolerance
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let best = -1, bestD = Infinity;
    for (let li = 0; li < legendRgb.length; li++) {
      const [lr, lg, lb] = legendRgb[li];
      const d = (r - lr) * (r - lr) + (g - lg) * (g - lg) + (b - lb) * (b - lb);
      if (d < bestD) { bestD = d; best = li; }
    }
    if (Math.sqrt(bestD) <= tolerance) bandIdx[i] = best;
  }

  // 2. unresolved pixels (hand-drawn labels, anti-aliasing fringe) inherit
  // their nearest classified neighbor — a multi-source BFS flood-fill from
  // every already-classified pixel simultaneously, which reaches the same
  // "nearest classified neighbor" result as a per-pixel outward spiral
  // search but in O(N) instead of O(N * search-radius).
  {
    const queue = new Int32Array(N);
    let qHead = 0, qTail = 0;
    const visited = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (bandIdx[i] !== -1) { visited[i] = 1; queue[qTail++] = i; }
    while (qHead < qTail) {
      const i = queue[qHead++];
      const x = i % W, y = (i / W) | 0;
      if (x > 0 && !visited[i - 1]) { visited[i - 1] = 1; bandIdx[i - 1] = bandIdx[i]; queue[qTail++] = i - 1; }
      if (x < W - 1 && !visited[i + 1]) { visited[i + 1] = 1; bandIdx[i + 1] = bandIdx[i]; queue[qTail++] = i + 1; }
      if (y > 0 && !visited[i - W]) { visited[i - W] = 1; bandIdx[i - W] = bandIdx[i]; queue[qTail++] = i - W; }
      if (y < H - 1 && !visited[i + W]) { visited[i + W] = 1; bandIdx[i + W] = bandIdx[i]; queue[qTail++] = i + W; }
    }
  }
  const bandGrid = bandIdx; // fully resolved now, no -1 left

  // 3. raw (unblurred) band-height grid, then N box-blur passes — this is
  // what turns a hard band edge into a gentle slope (gentle beaches, no
  // cliff-drop at the waterline).
  let heightGrid = new Float32Array(N);
  for (let i = 0; i < N; i++) heightGrid[i] = legend[bandGrid[i]].height;
  for (let p = 0; p < blurPasses; p++) heightGrid = boxBlur(heightGrid, W, H, blurRadius);

  // 4. per-band low-amplitude value-noise detail, added AFTER blur, chosen
  // by each cell's ORIGINAL (pre-blur) band identity — evaluated in WORLD
  // units so frequency doesn't depend on the source image's resolution.
  const finalHeight = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const wz = -extent + (y / (H - 1)) * (2 * extent);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const id = legend[bandGrid[i]].id;
      const amp = noiseAmp[id] || 0;
      let h = heightGrid[i];
      if (amp) {
        const wx = -extent + (x / (W - 1)) * (2 * extent);
        const freq = typeof noiseScale === 'object' ? (noiseScale[id] ?? 0.08) : noiseScale;
        h += fbm(wx * freq, wz * freq, 3) * amp;
      }
      finalHeight[i] = h;
    }
  }

  // "outside the map" = the deepest band, whatever a given zone's legend
  // calls it — generic rather than hardcoding an id like 'DEEP'.
  const outsideHeight = Math.min(...legend.map(e => e.height));
  const outsideId = legend.find(e => e.height === outsideHeight).id;

  function toUV(x, z) {
    return [(x + extent) / (2 * extent), (z + extent) / (2 * extent)];
  }

  // 5. sample: bilinear from the precomputed grid. Build once at zone load;
  // this is O(1) array math, as cheap as (cheaper than) a hand-tuned fbm
  // stack evaluated per query.
  function terrainHeight(x, z) {
    if (x < -extent || x > extent || z < -extent || z > extent) return outsideHeight;
    const [u, v] = toUV(x, z);
    const fx = u * (W - 1), fy = v * (H - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const h00 = finalHeight[y0 * W + x0], h10 = finalHeight[y0 * W + x1];
    const h01 = finalHeight[y1 * W + x0], h11 = finalHeight[y1 * W + x1];
    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return h0 + (h1 - h0) * ty;
  }

  // Categorical (not bilinear) — nearest raw classified band at (x,z).
  function bandAt(x, z) {
    if (x < -extent || x > extent || z < -extent || z > extent) return outsideId;
    const [u, v] = toUV(x, z);
    const px = Math.min(W - 1, Math.max(0, Math.round(u * (W - 1))));
    const py = Math.min(H - 1, Math.max(0, Math.round(v * (H - 1))));
    return legend[bandGrid[py * W + px]].id;
  }

  return { terrainHeight, bandAt };
}
