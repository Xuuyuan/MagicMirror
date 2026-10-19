import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Menu, Text } from 'react-native-paper';
import { useAccounts } from './accounts-context';
import { ProviderError, type AcademicYear } from './domain/models';
import { accountStorage } from './storage/accounts';

export function AcademicYearPicker({
  accountId,
  revision,
  years,
  selected,
}: {
  accountId: string;
  revision: string;
  years: AcademicYear[];
  selected?: string;
}) {
  const { reload } = useAccounts();
  const client = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(year: string) {
    setVisible(false);
    setBusy(true);
    setError('');
    try {
      await client.cancelQueries({ queryKey: ['account', accountId, revision, 'exams'] });
      if (!(await accountStorage.setAcademicYear(accountId, revision, year)))
        throw new ProviderError('RESTRICTED', '账号已变更，请重新加载');
      await reload();
    } catch (failure) {
      setError(failure instanceof ProviderError ? failure.message : '学年保存失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Menu
        visible={visible}
        onDismiss={() => setVisible(false)}
        anchor={
          <Button
            mode="outlined"
            icon="calendar"
            disabled={busy || !years.length}
            loading={busy}
            onPress={() => setVisible(true)}
          >
            {years.find((year) => year.id === selected)?.label ?? '选择学年'}
          </Button>
        }
      >
        {years.map((year) => (
          <Menu.Item
            key={year.id}
            title={year.label}
            leadingIcon={year.id === selected ? 'check' : undefined}
            disabled={busy || year.id === selected}
            onPress={() => {
              void choose(year.id);
            }}
          />
        ))}
      </Menu>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </>
  );
}
