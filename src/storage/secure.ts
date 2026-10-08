import * as SecureStore from 'expo-secure-store';

const webMemory = new Map<string, string>();

function isWebFallback(): boolean {
  return typeof document !== 'undefined';
}

export async function getSecureItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    if (!isWebFallback()) throw error;
    return webMemory.get(key) ?? null;
  }
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (isWebFallback()) webMemory.set(key, value);
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    if (!isWebFallback()) throw error;
  }
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (isWebFallback()) webMemory.delete(key);
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    if (!isWebFallback()) throw error;
  }
}
