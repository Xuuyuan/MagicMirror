import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { Appbar, Button, Menu, Text } from 'react-native-paper';
import { useAccounts } from '@/src/accounts-context';
import { withAccount } from '@/src/services/accounts';
import { hasMoreExamPages, mergeExamPages } from '@/src/services/exams';
import { profilesQueryOptions, unclaimedExamsQueryOptions } from '@/src/services/queries';
import { providerRegistry } from '@/src/providers/registry';
import { useAppStore } from '@/src/state/app';
import { Screen, Header, Card, Body, ErrorCard, LoadingState, Badge, showToast } from '@/src/ui';
import type { ExamSummary } from '@/src/domain/models';
export function ExamMeta({ exam, loading }: { exam: ExamSummary; loading: boolean }) {
  const parts: { key: string; node: React.ReactNode }[] = [];
  if (exam.date) parts.push({ key: 'date', node: <Text key="date" style={{ fontSize: 13 }}>{exam.date}</Text> });
  if (exam.category) parts.push({ key: 'category', node: <Badge key="category" label={exam.category} /> });
  if (exam.isUnion !== undefined) parts.push({ key: 'scope', node: <Badge key="scope" label={exam.isUnion ? '联考' : '校考'} /> });
  if (exam.subjectCount !== undefined) parts.push({ key: 'count', node: <Badge key="count" label={`${exam.subjectCount} 科`} /> });
  if (exam.availability === 'unavailable') parts.push({ key: 'status', node: <Text key="status" style={{ fontSize: 13 }}>未开放</Text> });
  else if (exam.hasResult === false) parts.push({ key: 'load', node: <Text key="load" style={{ fontSize: 13 }}>{loading ? '正在加载…' : '需要加载'}</Text> });
  if (!parts.length) return undefined;
  return <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>{parts.map((part) => part.node)}</View>;
}
/** 右上角账号下拉：展示所有账号（备注（平台名）），点选即切换；再次点头像或选择后收起。 */
function AccountSwitcher() {
  const { accounts, active, switchAccount } = useAccounts();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  return <Menu visible={visible} onDismiss={() => setVisible(false)} statusBarHeight={0} anchorPosition="bottom" anchor={<Appbar.Action icon="account-circle-outline" accessibilityLabel="切换账号" onPress={() => setVisible(true)} />}>
    {accounts.map((account) => <Menu.Item
      key={account.id}
      leadingIcon={active?.id === account.id ? 'check' : undefined}
      title={`${account.label}（${providerRegistry.get(account.providerId)?.metadata.name ?? '平台不可用'}）`}
      disabled={busy || active?.id === account.id}
      onPress={() => { setBusy(true); void switchAccount(account.id).catch(() => { showToast('切换账号失败，请重试'); }).finally(() => { setBusy(false); setVisible(false); }); }}
    />)}
    {!accounts.length ? <Menu.Item title="暂无账号" disabled /> : null}
  </Menu>;
}
function StudentSwitcher({ accountId, revision }: { accountId: string; revision: string }) {
  const { active } = useAccounts();
  const provider = active && providerRegistry.get(active.providerId);
  if (!provider?.getProfiles || !provider.selectProfile) return null;
  return <BoundStudentSwitcher key={`${accountId}:${revision}`} accountId={accountId} revision={revision} />;
}
function BoundStudentSwitcher({ accountId, revision }: { accountId: string; revision: string }) {
  const { active, selectProfile } = useAccounts();
  const profiles = useQuery(profilesQueryOptions(accountId, revision));
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedId = active?.selectedProfile?.id;
  const selected = profiles.data?.find((profile) => profile.selected) ?? profiles.data?.find((profile) => profile.id === selectedId);
  return <Menu visible={visible} onDismiss={() => setVisible(false)} statusBarHeight={0} anchorPosition="bottom" anchor={<Appbar.Action icon="account-child-outline" accessibilityLabel={selected ? `切换学生，当前${selected.displayName}` : '切换学生'} onPress={() => setVisible(true)} />}>
    {profiles.isPending ? <Menu.Item title="正在读取学生…" disabled /> : null}
    {profiles.error ? <Menu.Item title="读取失败，点击重试" onPress={() => void profiles.refetch()} /> : null}
    {profiles.data?.length === 0 ? <Menu.Item title="暂无绑定学生" disabled /> : null}
    {profiles.data?.map((profile, index) => <Menu.Item key={profile.id} leadingIcon={profile.id === selected?.id ? 'check' : undefined} title={`（${index + 1}）${profile.displayName}${profile.schoolName ? ` · ${profile.schoolName}` : ''}`} disabled={busy || profile.id === selected?.id} onPress={() => { setBusy(true); void selectProfile(accountId, profile.id).catch(() => { showToast('切换学生失败，请重试'); }).finally(() => { setBusy(false); setVisible(false); }); }} />)}
  </Menu>;
}
/** 右上角官方页面入口：档案页复用当前会话；登录页用于对照实验，由官方 H5 自行创建会话。 */
function OfficialH5Menu({ accountId }: { accountId: string }) {
  const [visible, setVisible] = useState(false);
  return <Menu visible={visible} onDismiss={() => setVisible(false)} statusBarHeight={0} anchorPosition="bottom" anchor={<Appbar.Action icon="web" accessibilityLabel="官方页面入口" onPress={() => setVisible(true)} />}>
    <Menu.Item title="官方考试档案（当前会话）" onPress={() => { setVisible(false); router.push({ pathname: '/haofenshu-webview', params: { accountId } }); }} />
    <Menu.Item title="官方网页登录（H5 自建会话）" onPress={() => { setVisible(false); router.push({ pathname: '/haofenshu-webview', params: { accountId, mode: 'login' } }); }} />
  </Menu>;
}
export default function ExamsHome() {
  const { active, loading, error: storageError, reload } = useAccounts();
  const debugMode = useAppStore((state) => state.debugMode);
  const queryClient = useQueryClient();
  // 考试列表是低频更新内容：5 分钟内的重复进入/下拉直接复用缓存，不发请求。
  const query = useInfiniteQuery({ queryKey: ['account', active?.id, active?.revision, 'exams'], enabled: !!active && !storageError, initialPageParam: 0, staleTime: 5 * 60 * 1000, queryFn: ({ pageParam, signal }) => withAccount(active!.id, (provider, session, requestSignal) => provider.getExamList(session, { offset: pageParam }, { signal: requestSignal }), signal), getNextPageParam: (lastPage, pages) => hasMoreExamPages(lastPage, pages.slice(0, -1)) ? pages.reduce((sum, page) => sum + page.length, 0) : undefined });
  // 待认领考试是平台可选能力（当前仅七天学堂实现）：按 Provider 能力探测开关，不在 UI 里硬编码平台 ID。
  const claimsSupported = !!active && !storageError && providerRegistry.get(active.providerId)?.getUnclaimedExams !== undefined;
  const officialH5Supported = debugMode && !!active && !storageError && providerRegistry.get(active.providerId)?.getOfficialH5Bootstrap !== undefined;
  const unclaimed = useQuery({ ...unclaimedExamsQueryOptions(active?.id ?? '', active?.revision), enabled: claimsSupported });
  const profiles = useQuery(profilesQueryOptions(active?.id ?? '', active?.revision));
  const claim = useMutation({ mutationFn: (examId: string) => withAccount(active!.id, (provider, session) => provider.loadExam ? provider.loadExam(session, examId) : Promise.reject(new Error('该平台不支持加载考试')), undefined), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['account', active?.id, active?.revision, 'exams'] }) });
  const exams = mergeExamPages(query.data?.pages ?? []);
  const openExam = (exam: ExamSummary) => {
    if (exam.availability === 'unavailable') return;
    if (exam.hasResult === false) { claim.mutate(exam.id); return; }
    router.push({ pathname: '/result', params: { accountId: active!.id, examId: exam.id } });
  };
  const providerName = providerRegistry.get(active?.providerId ?? '')?.metadata.name ?? '平台不可用';
  const providerLabel = profiles.data?.length ? `${providerName}-${profiles.data.length}` : providerName;
  return <Screen><Header leading={<Appbar.Action icon="cog" accessibilityLabel="设置" onPress={() => router.navigate('/accounts')} />} trailing={<View style={{ flexDirection: 'row', alignItems: 'center' }}>{active ? <View style={{ alignItems: 'flex-end', justifyContent: 'center', marginRight: 4 }}><Text variant="labelMedium" numberOfLines={1}>{active.label}</Text><Text variant="labelSmall" numberOfLines={1} style={{ opacity: 0.7 }}>{providerLabel}</Text></View> : null}{officialH5Supported && active ? <OfficialH5Menu accountId={active.id} /> : null}{active ? <StudentSwitcher accountId={active.id} revision={active.revision} /> : null}<AccountSwitcher /></View>} title="考试列表" />{loading ? <LoadingState label="正在读取本地账号…" /> : storageError ? <Body><Card><Text>{storageError}</Text><Button onPress={() => void reload()}>重试</Button></Card></Body> : !active ? <Body><Card><Text variant="titleLarge">添加第一个账号</Text><Text>选择阅卷平台并登录，之后启动即可查看考试。</Text><Button mode="contained" onPress={() => router.push('/account-edit')}>添加账号</Button></Card></Body> : <>{unclaimed.data?.length ? <Button mode="outlined" onPress={() => router.push({ pathname: '/claims' as never, params: { accountId: active.id } })}>查看待认领考试</Button> : null}<FlatList data={exams} keyExtractor={(exam) => exam.id} contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }} refreshing={query.isRefetching} onRefresh={() => { void query.refetch(); void unclaimed.refetch(); }} ListHeaderComponent={query.error ? <ErrorCard error={query.error} retry={() => void query.refetch()} accountId={active.id} /> : null} ListEmptyComponent={query.isPending ? <LoadingState label="正在加载考试…" /> : !query.error ? <Card><Text>暂无考试</Text></Card> : null} renderItem={({ item }) => <Card compact><Pressable disabled={claim.isPending || item.availability === 'unavailable'} accessibilityRole="button" accessibilityLabel={item.availability === 'unavailable' ? `${item.name}未开放` : item.hasResult === false ? `加载${item.name}` : `查看${item.name}`} onPress={() => openExam(item)} style={{ paddingVertical: 14 }}><Text style={{ fontSize: 16, lineHeight: 22 }}>{item.name}</Text><ExamMeta exam={item} loading={claim.isPending && claim.variables === item.id} /></Pressable>{claim.error && claim.variables === item.id ? <View><Text>加载失败，请稍后重试。</Text><Button compact onPress={() => claim.mutate(item.id)}>重试加载</Button></View> : null}</Card>} ListFooterComponent={query.hasNextPage ? <Button loading={query.isFetchingNextPage} disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()}>加载更多</Button> : null} /></> }</Screen>;
}
