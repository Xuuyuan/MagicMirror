import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Text } from 'react-native-paper';
import { useAccounts } from '@/src/accounts-context';
import { unclaimedExamsQueryOptions } from '@/src/services/queries';
import { Screen, Header, Body, Card, ErrorCard, LoadingState } from '@/src/ui';

export default function Claims() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const { accounts } = useAccounts();
  const account = accounts.find((item) => item.id === accountId);
  const query = useQuery(unclaimedExamsQueryOptions(accountId, account?.revision));
  if (query.isPending) return <Screen><Header title="待认领考试" back /><LoadingState label="正在读取待认领考试…" /></Screen>;
  if (query.error) return <Screen><Header title="待认领考试" back /><Body><ErrorCard error={query.error} retry={() => void query.refetch()} accountId={accountId} /></Body></Screen>;
  return <Screen><Header title="待认领考试" back /><Body>{query.data?.length ? query.data.map((exam) => <Card key={exam.id}><Text variant="titleMedium">{exam.name}</Text>{exam.date ? <Text>{exam.date}</Text> : null}<Button mode="contained" onPress={() => router.push({ pathname: '/claim' as never, params: { accountId, examId: exam.id, examName: exam.name, studentCodes: JSON.stringify(exam.studentCodes) } })}>查看并认领</Button></Card>) : <Card><Text>当前没有待认领考试。</Text></Card>}</Body></Screen>;
}
