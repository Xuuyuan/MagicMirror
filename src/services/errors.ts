import { ProviderError } from '@/src/domain/models';

export function isLoginRequiredError(error: unknown): boolean {
  return error instanceof ProviderError && ['SESSION_EXPIRED', 'INVALID_CREDENTIALS'].includes(error.code);
}
