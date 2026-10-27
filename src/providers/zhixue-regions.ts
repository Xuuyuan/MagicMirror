import { z } from 'zod';
import type { ImageRegion } from '../domain/models';

const indexSchema = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]);
const positionSchema = z.object({
  left: z.number().finite().nonnegative(),
  top: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
const sectionSchema = z.object({
  type: z.string(),
  enabled: z.boolean().optional(),
  contents: z.object({ enabled: z.boolean().optional(), branch: z.array(z.unknown()).max(1000) }),
});
const branchSchema = z.object({
  ixList: z.array(indexSchema).max(1000),
  position: z.unknown().optional(),
});
const layoutSchema = z.object({
  comeFrom: z.literal(0),
  paperType: z.enum(['A3', 'A4']),
  pageSheets: z
    .array(
      z.object({
        pageIndex: z.number().int().nonnegative(),
        sections: z.array(z.unknown()).max(1000),
      }),
    )
    .max(1000),
});
export interface ZhixueAnswerRegion {
  pageIndex: number;
  region: ImageRegion;
  questionIndices: number[];
}

/** Only verified millimetre templates. Incomplete/unknown mappings must not advertise partial answers. */
export function zhixueRegions(
  raw: unknown,
  recordCount: number,
  pageCount: number,
): Map<number, ZhixueAnswerRegion[]> {
  const parsed = layoutSchema.safeParse(raw);
  const result = new Map<number, ZhixueAnswerRegion[]>();
  if (!parsed.success) return result;
  const [paperWidth, paperHeight] = parsed.data.paperType === 'A3' ? [420, 297] : [210, 297];
  const invalid = new Set<number>();
  const seen = new Set<string>();
  for (const page of [...parsed.data.pageSheets].sort((a, b) => a.pageIndex - b.pageIndex)) {
    for (const rawSection of page.sections) {
      // Unresolved references may contain another part of any question; do not return incomplete crops.
      if (rawSection && typeof rawSection === 'object' && '$ref' in rawSection) return new Map();
      const section = sectionSchema.safeParse(rawSection);
      if (!section.success) return new Map();
      if (
        section.data.type !== 'AnswerQuestion' ||
        section.data.enabled === false ||
        section.data.contents.enabled === false
      )
        continue;
      for (const rawBranch of section.data.contents.branch) {
        const branch = branchSchema.safeParse(rawBranch);
        if (!branch.success) return new Map();
        const indices = [...new Set(branch.data.ixList.map((value) => Number(value) - 1))];
        const position = positionSchema.safeParse(branch.data.position);
        if (
          !indices.length ||
          indices.some((index) => index >= recordCount) ||
          page.pageIndex >= pageCount ||
          !position.success
        ) {
          indices.forEach((index) => invalid.add(index));
          continue;
        }
        const p = position.data;
        if (p.left + p.width > paperWidth || p.top + p.height > paperHeight) {
          indices.forEach((index) => invalid.add(index));
          continue;
        }
        const region = {
          x: p.left / paperWidth,
          y: p.top / paperHeight,
          width: p.width / paperWidth,
          height: p.height / paperHeight,
          sourceAspectRatio: paperWidth / paperHeight,
        };
        for (const index of indices) {
          const key = JSON.stringify([index, page.pageIndex, region]);
          if (seen.has(key)) continue;
          seen.add(key);
          const entry = { pageIndex: page.pageIndex, region, questionIndices: indices };
          result.set(index, [...(result.get(index) ?? []), entry]);
        }
      }
    }
  }
  invalid.forEach((index) => result.delete(index));
  return result;
}
