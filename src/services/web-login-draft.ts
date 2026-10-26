type Credentials = { login: string; password: string };
let sequence = 0;
let pending:
  { key: string; providerId: string; credentials: Credentials; expires: number } | undefined;

/** One-use memory handoff; credentials never enter router history or persistent drafts. */
export function prepareWebLoginCredentials(providerId: string, credentials: Credentials): string {
  const key = String(++sequence);
  pending = { key, providerId, credentials, expires: Date.now() + 60_000 };
  return key;
}

export function takeWebLoginCredentials(key: string | undefined, providerId: string) {
  if (!pending || pending.key !== key) return undefined;
  const draft = pending;
  pending = undefined;
  return draft.providerId === providerId && draft.expires > Date.now()
    ? draft.credentials
    : undefined;
}
