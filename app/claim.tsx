import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Image, View } from 'react-native';
import { Button, RadioButton, Text } from 'react-native-paper';
import { useAccounts } from '@/src/accounts-context';
import { withAccount } from '@/src/services/accounts';
import { Screen, Header, Body, Card, ErrorCard, LoadingState, backOrHome } from '@/src/ui';

export default function Claim() {
  const { accountId, examId, examName, studentCodes } = useLocalSearchParams<{ accountId: string; examId: string; examName: string; studentCodes: string }>();
  const { accounts } = useAccounts();
  const account = accounts.find((item) => item.id === accountId);
  const queryClient = useQueryClient();
  let codes: string[] = [];
  try { const parsed: unknown = JSON.parse(studentCodes ?? '[]'); if (Array.isArray(parsed)) codes = parsed.filter((item): item is string => typeof item === 'string'); } catch { codes = []; }
  const query = useQuery({
    queryKey: ['account', accountId, account?.revision, 'claim-candidates', examId, codes],
    enabled: !!accountId && !!account?.revision && !!examId && codes.length > 0,
    queryFn: ({ signal }) => withAccount(accountId!, (provider, session, requestSignal) =>
      provider.getClaimCandidates ? provider.getClaimCandidates(session, examId!, codes, { signal: requestSignal }) : Promise.resolve([]), signal),
  });
  const claim = useMutation({
    mutationFn: (studentCode: string) => withAccount(accountId!, (provider, session, requestSignal) =>
      provider.claimExam ? provider.claimExam(session, examId!, studentCode, { signal: requestSignal }) : Promise.reject(new Error('该平台不支持考试认领')), undefined),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['account', accountId] });
      backOrHome();
    },
  });
  const [selected, setSelected] = useState('');
  if (query.isPending) return <Screen><Header title="认领考试" back /><LoadingState label="正在读取候选答题卡…" /></Screen>;
  if (query.error) return <Screen><Header title="认领考试" back /><Body><ErrorCard error={query.error} retry={() => void query.refetch()} accountId={accountId} /></Body></Screen>;
  function confirm() {
    if (!selected) return;
    claim.mutate(selected);
  }
  return <Screen><Header title="认领考试" back /><Body><Card><Text variant="titleMedium">{examName}</Text><Text>请选择属于本人的考号，再确认认领。</Text>{query.data?.length ? query.data.map((candidate) => <View key={candidate.studentCode} style={{ gap: 8 }}><RadioButton.Item label={`考号：${candidate.studentCode}`} value={candidate.studentCode} status={selected === candidate.studentCode ? 'checked' : 'unchecked'} onPress={() => setSelected(candidate.studentCode)} />{candidate.url ? <Image source={{ uri: candidate.url }} resizeMode="contain" style={{ width: '100%', height: 260 }} /> : null}</View>) : <Text>平台没有返回可核对的候选答题卡。</Text>}<Button mode="contained" disabled={!selected || claim.isPending} loading={claim.isPending} onPress={confirm}>确认认领</Button>{claim.error ? <Text>认领失败，请确认考号后重试。</Text> : null}</Card></Body></Screen>;
}
