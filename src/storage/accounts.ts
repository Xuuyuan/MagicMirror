import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import type { LocalAccount } from '@/src/domain/models';
import { sessionSchema, sessionStorage } from './session';
import { deleteSecureItem, getSecureItem, setSecureItem } from './secure';

const indexKey = 'magicmirror.accounts.v1';
const activeKey = 'magicmirror.active.v1';
const key = (id: string) => `magicmirror.account.${id}`;
const profileSchema = z.object({ id: z.string(), displayName: z.string(), schoolName: z.string().optional(), grade: z.string().optional(), providerContext: z.record(z.string(), z.string()).optional() });
const accountSchema = z.object({ id: z.string(), revision: z.string(), label: z.string(), providerId: z.string(), login: z.string(), authMode: z.enum(['password', 'token']).optional(), password: z.string().optional(), session: sessionSchema.optional(), selectedProfile: profileSchema.optional() });
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}
async function ids(): Promise<string[]> {
  const value = await getSecureItem(indexKey);
  if (!value) return [];
  try { const result = z.array(z.string()).safeParse(JSON.parse(value)); return result.success ? result.data : []; } catch { return []; }
}
async function load(id: string): Promise<LocalAccount | null> {
  const value = await getSecureItem(key(id));
  if (!value) return null;
  try { const result = accountSchema.safeParse(JSON.parse(value)); return result.success ? result.data : null; } catch { return null; }
}
async function save(account: LocalAccount) {
  const index = await ids();
  await setSecureItem(key(account.id), JSON.stringify(accountSchema.parse(account)));
  if (!index.includes(account.id)) await setSecureItem(indexKey, JSON.stringify([...index, account.id]));
}
export const accountStorage = {
  load,
  async list() { return (await Promise.all((await ids()).map(load))).filter((account): account is LocalAccount => account !== null); },
  save(account: LocalAccount) { return serialize(() => save(account)); },
  updateSession(id: string, revision: string, session: LocalAccount['session'], expectedToken?: string) {
    return serialize(async () => {
      const current = await load(id);
      if (!current || current.revision !== revision) return false;
      if (expectedToken !== undefined && current.session?.accessToken !== expectedToken) return false;
      await save({ ...current, session });
      return true;
    });
  },
  selectProfile(id: string, revision: string, expectedToken: string, session: NonNullable<LocalAccount['session']>, selectedProfile: NonNullable<LocalAccount['selectedProfile']>) {
    return serialize(async () => {
      const current = await load(id);
      if (!current || current.revision !== revision || current.session?.accessToken !== expectedToken) return false;
      await save({ ...current, revision: Crypto.randomUUID(), session, selectedProfile });
      return true;
    });
  },
  remove(id: string) { return serialize(async () => {
    await setSecureItem(indexKey, JSON.stringify((await ids()).filter((value) => value !== id)));
    await deleteSecureItem(key(id));
    if (await getSecureItem(activeKey) === id) await deleteSecureItem(activeKey);
  }); },
  getActive: () => getSecureItem(activeKey),
  clear(providerIds: string[]) { return serialize(async () => {
    // Clear legacy sessions too, so a restart cannot migrate deleted accounts back.
    await sessionStorage.clear(providerIds);
    for (const id of await ids()) await deleteSecureItem(key(id));
    await deleteSecureItem(indexKey);
    await deleteSecureItem(activeKey);
  }); },
  setActive: (id: string) => serialize(() => setSecureItem(activeKey, id)),
  migrate(providerIds: string[]) { return serialize(async () => {
    const existing = await this.list();
    for (const providerId of providerIds) {
      const session = await sessionStorage.load(providerId);
      if (!session) continue;
      if (!existing.some((account) => account.providerId === providerId && account.login === session.accountId)) {
        const account: LocalAccount = { id: Crypto.randomUUID(), revision: Crypto.randomUUID(), label: session.accountId, login: session.accountId, providerId, session };
        await save(account);
        existing.push(account);
      }
      // Only remove the old entry after the new account has been saved.
      await sessionStorage.remove(providerId);
    }
  }); },
};
