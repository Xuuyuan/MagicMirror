import { ProviderError } from '@/src/domain/models';
import { isLoginRequiredError } from '@/src/services/errors';

it.each(['SESSION_EXPIRED', 'INVALID_CREDENTIALS'] as const)('marks %s for the page re-login action', (code) => {
  expect(isLoginRequiredError(new ProviderError(code, 'fictional error'))).toBe(true);
});
it.each(['NETWORK', 'NOT_FOUND', 'UNSUPPORTED', 'UNKNOWN'] as const)('does not show re-login for %s', (code) => {
  expect(isLoginRequiredError(new ProviderError(code, 'fictional error'))).toBe(false);
});
