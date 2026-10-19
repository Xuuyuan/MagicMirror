import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { Button, Menu, Text, TextInput } from 'react-native-paper';
import { useAccounts } from '@/src/accounts-context';
import {
  ProviderError,
  type ExamBindingCandidate,
  type ExamBindingResult,
} from '@/src/domain/models';
import { providerRegistry } from '@/src/providers/registry';
import {
  bindExam,
  previewExamBinding,
  searchableExamsQueryOptions,
  supportsExamBinding,
} from '@/src/services/exam-binding';
import { accountQueryKeys } from '@/src/services/queries';
import { Screen, Header, Body, Card, LoadingState, backOrHome, showToast } from '@/src/ui';

const errorMessage = (error: unknown) =>
  error instanceof ProviderError ? error.message : '请求失败，请检查网络后重试';

export default function ExamSearch() {
  const { accountId, revision } = useLocalSearchParams<{ accountId: string; revision: string }>();
  const { active, loading } = useAccounts();
  if (loading)
    return (
      <Screen>
        <Header title="搜索考试项目" back />
        <LoadingState />
      </Screen>
    );
  if (!active || active.id !== accountId || active.revision !== revision)
    return (
      <Screen>
        <Header title="搜索考试项目" back />
        <Body>
          <Card>
            <Text>账号已变更，请返回考试列表重新进入。</Text>
            <Button onPress={backOrHome}>返回考试列表</Button>
          </Card>
        </Body>
      </Screen>
    );
  if (!supportsExamBinding(providerRegistry.get(active.providerId)))
    return (
      <Screen>
        <Header title="搜索考试项目" back />
        <Body>
          <Card>
            <Text>该平台不支持搜索考试项目。</Text>
          </Card>
        </Body>
      </Screen>
    );
  return (
    <ExamSearchForm key={`${accountId}:${revision}`} accountId={accountId} revision={revision} />
  );
}

export function ExamSearchForm({ accountId, revision }: { accountId: string; revision: string }) {
  const queryClient = useQueryClient();
  const exams = useQuery(searchableExamsQueryOptions(accountId, revision));
  const { width: screenWidth } = useWindowDimensions();
  const [examMenu, setExamMenu] = useState(false);
  const [examId, setExamId] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [candidate, setCandidate] = useState<ExamBindingCandidate>();
  const [error, setError] = useState('');
  const [done, setDone] = useState<ExamBindingResult['status']>();
  const [refreshError, setRefreshError] = useState(false);
  const [working, setWorking] = useState<'preview' | 'bind' | 'refresh'>();
  const pending = useRef<{ controller: AbortController; sequence: number } | null>(null);
  const sequence = useRef(0);
  const binding = useRef(false);
  useEffect(
    () => () => {
      sequence.current++;
      pending.current?.controller.abort();
    },
    [],
  );
  const submit = useMutation({
    mutationFn: ({ value, signal }: { value: ExamBindingCandidate; signal: AbortSignal }) =>
      bindExam(accountId, revision, value, signal),
    retry: false,
    gcTime: 0,
  });

  function clearPreview() {
    sequence.current++;
    pending.current?.controller.abort();
    pending.current = null;
    setCandidate(undefined);
    setError('');
    setWorking(undefined);
  }
  function begin() {
    pending.current?.controller.abort();
    const request = { controller: new AbortController(), sequence: ++sequence.current };
    pending.current = request;
    return request;
  }
  function current(request: { sequence: number }) {
    return sequence.current === request.sequence;
  }
  async function finish(status: ExamBindingResult['status'], request: { sequence: number }) {
    if (!current(request)) return;
    setDone(status);
    setCandidate(undefined);
    setStudentCode('');
    setRefreshError(false);
    setWorking('refresh');
    try {
      const queryKey = accountQueryKeys.exams(accountId, revision);
      await queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
      await queryClient.refetchQueries({ queryKey, type: 'all' }, { throwOnError: true });
      if (current(request)) {
        showToast(status === 'bound' ? '绑定成功' : '该考试已关联，请在列表查看');
        backOrHome();
      }
    } catch {
      if (current(request)) setRefreshError(true);
    } finally {
      if (current(request)) setWorking(undefined);
    }
  }
  async function check() {
    if (binding.current || !examId || !studentCode.trim()) return;
    const request = begin();
    setCandidate(undefined);
    setError('');
    setWorking('preview');
    try {
      const result = await previewExamBinding(
        accountId,
        revision,
        examId,
        studentCode,
        request.controller.signal,
      );
      if (!current(request)) return;
      if (result.status === 'already-bound') await finish(result.status, request);
      else setCandidate(result.candidate);
    } catch (cause) {
      if (current(request)) setError(errorMessage(cause));
    } finally {
      if (current(request)) setWorking(undefined);
    }
  }
  async function confirm() {
    if (!candidate || binding.current) return;
    binding.current = true;
    const request = begin();
    setWorking('bind');
    setError('');
    try {
      const result = await submit.mutateAsync({
        value: candidate,
        signal: request.controller.signal,
      });
      await finish(result.status, request);
    } catch (cause) {
      if (current(request)) {
        setCandidate(undefined);
        setError(errorMessage(cause));
      }
    } finally {
      binding.current = false;
      submit.reset();
      if (current(request)) setWorking(undefined);
    }
  }
  const locked = working === 'bind' || working === 'refresh';
  const projects = exams.data ?? [];
  const selectedExam = projects.find((exam) => exam.id === examId);
  return (
    <Screen>
      <Header title="搜索考试项目" back />
      <Body>
        {done ? (
          <Card>
            <Text>{done === 'bound' ? '绑定成功。' : '该考试已关联，请在考试列表查看。'}</Text>
            {working === 'refresh' ? <Text>正在刷新考试列表…</Text> : null}
            {refreshError ? (
              <>
                <Text>考试列表刷新失败，绑定状态已确认，无需再次提交。</Text>
                <Button onPress={() => void finish(done, begin())}>重新刷新考试列表</Button>
              </>
            ) : null}
            <Button disabled={working === 'refresh'} onPress={backOrHome}>
              返回考试列表
            </Button>
          </Card>
        ) : (
          <>
            <Card>
              <Text>
                选择当前学校的考试项目，填写本人准考证号并核对信息。确认绑定后，考试将加入账号列表。
              </Text>
            </Card>
            {exams.isPending ? (
              <LoadingState label="正在读取本校考试项目…" />
            ) : exams.error ? (
              <Card>
                <Text>{errorMessage(exams.error)}</Text>
                <Button onPress={() => void exams.refetch()}>重试读取项目</Button>
              </Card>
            ) : (
              <Card>
                <Text variant="titleMedium">考试项目</Text>
                {!projects.length ? (
                  <Text>学校暂无可查询的考试项目。</Text>
                ) : (
                  <Menu
                    visible={examMenu}
                    onDismiss={() => setExamMenu(false)}
                    statusBarHeight={0}
                    anchorPosition="bottom"
                    contentStyle={{ width: screenWidth - 64 }}
                    anchor={
                      <Button
                        mode="outlined"
                        icon="chevron-down"
                        accessibilityLabel="选择考试项目"
                        disabled={locked}
                        onPress={() => setExamMenu(true)}
                        style={{ width: '100%' }}
                        contentStyle={{
                          flexDirection: 'row-reverse',
                          justifyContent: 'space-between',
                        }}
                      >
                        {selectedExam?.name ?? '请选择考试项目'}
                      </Button>
                    }
                  >
                    {projects.map((exam) => (
                      <Menu.Item
                        key={exam.id}
                        leadingIcon={exam.id === examId ? 'check' : undefined}
                        title={exam.name}
                        disabled={locked}
                        onPress={() => {
                          clearPreview();
                          setExamId(exam.id);
                          setExamMenu(false);
                        }}
                      />
                    ))}
                  </Menu>
                )}
                <TextInput
                  label="本人准考证号"
                  accessibilityLabel="本人准考证号"
                  value={studentCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  disabled={locked}
                  onChangeText={(value) => {
                    clearPreview();
                    setStudentCode(value);
                  }}
                />
                <Button
                  mode="contained"
                  disabled={!examId || !studentCode.trim() || !!working}
                  loading={working === 'preview'}
                  onPress={() => void check()}
                >
                  核对考生
                </Button>
              </Card>
            )}
            {candidate ? (
              <Card>
                <Text variant="titleMedium">请确认考生信息</Text>
                <Text>考试：{candidate.examName}</Text>
                <Text>学校：{candidate.schoolName || '未提供'}</Text>
                <Text>姓名：{candidate.displayName}</Text>
                <Text>班级：{candidate.className || '未提供'}</Text>
                <Text>准考证号：{candidate.studentCode}</Text>
                <Text>请确认以上是本人信息。点击确认后将绑定至当前账号。</Text>
                <Button disabled={locked} onPress={clearPreview}>
                  返回修改
                </Button>
                <Button
                  mode="contained"
                  disabled={locked}
                  loading={working === 'bind'}
                  onPress={() => void confirm()}
                >
                  确认绑定
                </Button>
              </Card>
            ) : null}
            {error ? (
              <Card>
                <Text accessibilityRole="alert">{error}</Text>
                <Button onPress={backOrHome}>返回考试列表核实</Button>
              </Card>
            ) : null}
          </>
        )}
      </Body>
    </Screen>
  );
}
