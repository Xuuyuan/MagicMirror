import { invalidateAccountQueries } from '@/src/services/accounts';
import { QueryClient } from '@tanstack/react-query';
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'fictional-uuid') }));
jest.mock('expo-secure-store', () => ({ setItemAsync: jest.fn(), getItemAsync: jest.fn(async () => null), deleteItemAsync: jest.fn() }));

it('isolates refresh and account switching caches by account id', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['account', 'account-a', 'exams'], ['A']);
  queryClient.setQueryData(['account', 'account-b', 'exams'], ['B']);
  invalidateAccountQueries(queryClient, 'account-a');
  expect(queryClient.getQueryData(['account', 'account-a', 'exams'])).toBeUndefined();
  expect(queryClient.getQueryData(['account', 'account-b', 'exams'])).toEqual(['B']);
});
