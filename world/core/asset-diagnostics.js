// World Shell — the single funnel for "an asset that should have loaded,
// didn't." A missing/broken catalogue GLB must never blank a whole zone
// build (one bad file shouldn't take down every family placed after it in
// the same pass) but it must also never fail silently — that combination is
// exactly what let the catalogue-integrity bug (Track A) go unnoticed:
// console.warn lines nobody was watching for. Call sites catch their own
// load failure per-item and report it here instead of letting it propagate.
let missingCount = 0;
let badge = null;

function ensureBadge() {
  if (badge) return badge;
  badge = document.createElement('div');
  badge.style.cssText = 'position:fixed; right:10px; bottom:10px; z-index:5; font:600 12px ui-sans-serif, system-ui, sans-serif; color:#fff; background:rgba(180,40,40,.88); border-radius:6px; padding:4px 10px; pointer-events:none;';
  document.body.appendChild(badge);
  return badge;
}

export function reportMissingAsset(path, context) {
  missingCount++;
  console.error(`[asset] missing: ${path}${context ? ` (${context})` : ''}`);
  ensureBadge().textContent = `missing assets: ${missingCount}`;
}

export function missingAssetCount() { return missingCount; }
