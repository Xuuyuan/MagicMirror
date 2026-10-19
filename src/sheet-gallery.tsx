import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Pressable } from 'react-native';
import { Button, Text } from 'react-native-paper';
import type { AnswerSheet } from './domain/models';
import { SheetActionsSheet } from './sheet-actions';
import { AdaptiveSheetImage, SheetViewerModal } from './sheet-image';
import { Screen, Header, Body, Card, ErrorCard, LoadingState, useDoubleTap } from './ui';

interface SheetGalleryProps {
  accountId: string;
  subjectId?: string;
  title: string;
  missingSubjectText: string;
  loadingText: string;
  emptyText: string;
  refreshText: string;
  imageAccessibilityLabel?: (index: number) => string;
  query: Pick<
    UseQueryResult<AnswerSheet[]>,
    'data' | 'error' | 'isPending' | 'isFetching' | 'refetch'
  >;
}

/** 答题卡和原卷共用展示与交互；查询及缓存仍由各路由独立提供。 */
export function SheetGallery({
  accountId,
  subjectId,
  title,
  missingSubjectText,
  loadingText,
  emptyText,
  refreshText,
  imageAccessibilityLabel,
  query,
}: SheetGalleryProps) {
  const [zoom, setZoom] = useState<AnswerSheet>();
  const [actions, setActions] = useState<AnswerSheet>();
  const [imageErrors, setImageErrors] = useState<Set<string>>(() => new Set());
  const [reloadKey, setReloadKey] = useState(0);
  // 按图片及加载轮次区分失败，旧链接或旧轮次的回调不影响新图片。
  function imageErrorKey(sheet: AnswerSheet) {
    return JSON.stringify([accountId, subjectId, sheet.subject, sheet.url, reloadKey]);
  }
  const handleImagePress = useDoubleTap<AnswerSheet>((sheet) => {
    setImageErrors((previous) => {
      const next = new Set(previous);
      next.delete(imageErrorKey(sheet));
      return next;
    });
    setZoom(sheet);
  });
  if (!subjectId)
    return (
      <Screen>
        <Header title={title} back />
        <Body>
          <Card>
            <Text>{missingSubjectText}</Text>
          </Card>
        </Body>
      </Screen>
    );
  if (query.isPending)
    return (
      <Screen>
        <Header title={title} back />
        <LoadingState label={loadingText} />
      </Screen>
    );
  if (query.error)
    return (
      <Screen>
        <Header title={title} back />
        <Body>
          <ErrorCard error={query.error} retry={() => void query.refetch()} accountId={accountId} />
        </Body>
      </Screen>
    );
  const sheets = query.data ?? [];
  function refresh() {
    setImageErrors(new Set());
    setReloadKey((value) => value + 1);
    void query.refetch();
  }
  return (
    <Screen>
      <Header title={title} back />
      <Body>
        {sheets.length ? (
          sheets.map((sheet, index) => (
            <Card key={`${sheet.subject}-${sheet.url}`}>
              <Text variant="titleMedium">
                {sheets.length > 1 ? `${sheet.subject}（第 ${index + 1} 页）` : sheet.subject}
              </Text>
              <Pressable
                accessibilityRole={imageAccessibilityLabel ? 'imagebutton' : undefined}
                accessibilityLabel={imageAccessibilityLabel?.(index)}
                onPress={() => handleImagePress(sheet)}
                onLongPress={() => setActions(sheet)}
              >
                <AdaptiveSheetImage
                  sheet={sheet}
                  reloadKey={reloadKey}
                  onError={() => {
                    const key = imageErrorKey(sheet);
                    setImageErrors((previous) => new Set(previous).add(key));
                  }}
                />
              </Pressable>
              {imageErrors.has(imageErrorKey(sheet)) ? (
                <Text>图片链接可能已过期，请重新获取。</Text>
              ) : null}
              {imageErrors.has(imageErrorKey(sheet)) ? (
                <Button onPress={refresh} loading={query.isFetching}>
                  {refreshText}
                </Button>
              ) : null}
            </Card>
          ))
        ) : (
          <Card>
            <Text>{emptyText}</Text>
          </Card>
        )}
      </Body>
      <SheetViewerModal
        sheet={zoom}
        onDismiss={() => setZoom(undefined)}
        onLongPress={setActions}
      />
      <SheetActionsSheet sheet={actions} onDismiss={() => setActions(undefined)} />
    </Screen>
  );
}
