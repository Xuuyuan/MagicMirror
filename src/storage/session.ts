import { z } from 'zod';
import type { AuthSession } from '@/src/domain/models';
import { deleteSecureItem, getSecureItem, setSecureItem } from './secure';
const key = (providerId: string) => `magicmirror.session.${providerId}`;
export const sessionSchema = z.object({ providerId: z.string(), accountId: z.string(), accessToken: z.string().min(1), expiresAt: z.number().optional(), providerContext: z.record(z.string(), z.string()).optional() });
export const sessionStorage = {
  async save(session: AuthSession) { await setSecureItem(key(session.providerId), JSON.stringify(sessionSchema.parse(session))); },
  async load(providerId: string) { const value = await getSecureItem(key(providerId)); if (!value) return null; try { const result = sessionSchema.safeParse(JSON.parse(value)); return result.success ? result.data : null; } catch { return null; } },
  async remove(providerId: string) { await deleteSecureItem(key(providerId)); },
  async clear(providerIds: string[] = ['haofenshu-parent', 'haofenshu-student', 'septnet', 'ruiya', 'bfzks']) { await Promise.all(providerIds.map((providerId) => deleteSecureItem(key(providerId)))); },
};
