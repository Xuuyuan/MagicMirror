import { imageRegionBounds, imageRegionLayout } from '../domain/image-region';

it('clips only the requested source rectangle and contain-fits it inside a viewport', () => {
  const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  expect(imageRegionBounds(region, 1000, 2000)).toEqual({ x: 100, y: 400, width: 300, height: 800 });
  expect(imageRegionLayout(region, 1000, 2000, 300, 800)).toEqual({ width: 1000, height: 2000, left: -100, top: -400 });
  expect(imageRegionLayout(region, 1000, 2000, 600, 600)).toEqual({ width: 750, height: 1500, left: 112.5, top: -300 });
});

it('rounds the rectangle outwards to preserve handwriting at fractional pixel boundaries', () => {
  expect(imageRegionBounds({ x: 0.333, y: 0, width: 0.111, height: 1 }, 1001, 800)).toEqual({ x: 333, y: 0, width: 112, height: 800 });
});

it.each([
  { x: -0.1, y: 0, width: 0.2, height: 0.2 },
  { x: 0, y: 0, width: 0, height: 1 },
  { x: 0, y: 0, width: 1, height: Infinity },
  { x: 0.8, y: 0, width: 0.3, height: 0.2 },
  { x: 0, y: 0, width: 1, height: 1, sourceAspectRatio: 0 },
])('refuses invalid geometry rather than showing a different answer region', (region) => {
  expect(imageRegionBounds(region, 1000, 800)).toBeUndefined();
});

it('rejects template orientation mismatches and waits for a measurable viewport', () => {
  const region = { x: 0, y: 0, width: 1, height: 1, sourceAspectRatio: 420 / 297 };
  expect(imageRegionBounds(region, 1555, 2199)).toBeUndefined();
  expect(imageRegionBounds(region, 2199, 1555)).toEqual({ x: 0, y: 0, width: 2199, height: 1555 });
  expect(imageRegionLayout(region, 2199, 1555, 0, 0)).toBeUndefined();
});
