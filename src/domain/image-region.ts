import type { ImageRegion } from './models';

/** Outward rounding preserves writing on the edges; never silently accept an invalid crop. */
export function imageRegionBounds(region: ImageRegion, sourceWidth: number, sourceHeight: number) {
  if (
    ![region.x, region.y, region.width, region.height, sourceWidth, sourceHeight].every(
      Number.isFinite,
    ) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 1 + 1e-9 ||
    region.y + region.height > 1 + 1e-9
  )
    return undefined;
  if (
    region.sourceAspectRatio !== undefined &&
    (!Number.isFinite(region.sourceAspectRatio) ||
      region.sourceAspectRatio <= 0 ||
      Math.abs(sourceWidth / sourceHeight / region.sourceAspectRatio - 1) > 0.06)
  )
    return undefined;
  // Ignore sub-pixel floating point noise at integer pixel boundaries.
  const x = Math.floor(region.x * sourceWidth + 1e-9);
  const y = Math.floor(region.y * sourceHeight + 1e-9);
  const width =
    Math.min(sourceWidth, Math.ceil((region.x + region.width) * sourceWidth - 1e-9)) - x;
  const height =
    Math.min(sourceHeight, Math.ceil((region.y + region.height) * sourceHeight - 1e-9)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/** Position the whole source image behind a clipped viewport, with contain-fit for the crop. */
export function imageRegionLayout(
  region: ImageRegion,
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const bounds = imageRegionBounds(region, sourceWidth, sourceHeight);
  if (
    !bounds ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  )
    return undefined;
  const scale = Math.min(viewportWidth / bounds.width, viewportHeight / bounds.height);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    left: (viewportWidth - bounds.width * scale) / 2 - bounds.x * scale,
    top: (viewportHeight - bounds.height * scale) / 2 - bounds.y * scale,
  };
}
