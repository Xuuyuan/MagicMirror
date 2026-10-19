import { useState } from 'react';
import { View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import type { AnswerSheet, EssayDetail, ReportSection } from './domain/models';
import { ReportSectionBody } from './report-sections';
import { Card } from './ui';

/**
 * 作文卡片：合并展示作文统计（`placement: 'essay'` 的报告卡片）、题干全文与本人作答入口，默认收缩。
 * 统计来自科目详情（随页面一起到达），题干与作答图来自 Provider 的 getEssayDetail（懒加载），
 * 两者互不阻塞：数据缺失时不占位，加载中只在有内容时补一行提示。
 * 作答图不内嵌展示，由按钮直接打开放大查看（放大后可长按保存）。
 */
export function EssaySection({
  essay,
  sections,
  pending,
  onView,
}: {
  essay?: EssayDetail;
  sections?: ReportSection[];
  pending: boolean;
  onView: (sheet: AnswerSheet) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const prompt = essay?.prompt;
  const sheets = essay?.answerSheets ?? [];
  const hasContent = !!prompt || sheets.length > 0 || !!sections?.length;
  const loading = pending && !prompt && !sheets.length;
  if (!hasContent && !loading) return null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="titleMedium">作文</Text>
        {hasContent ? (
          <IconButton
            style={{ marginVertical: 0 }}
            icon={expanded ? 'chevron-up' : 'chevron-down'}
            accessibilityLabel={`${expanded ? '收起' : '展开'}作文`}
            onPress={() => setExpanded((value) => !value)}
          />
        ) : null}
      </View>
      {!hasContent ? <Text variant="bodySmall">正在加载作文题干与作答…</Text> : null}
      {expanded && hasContent ? (
        <>
          {sections?.map((section) => (
            <ReportSectionBody key={section.id} section={section} expanded />
          ))}
          {loading ? <Text variant="bodySmall">正在加载作文题干与作答…</Text> : null}
          {prompt ? <Text variant="bodyMedium">{prompt}</Text> : null}
          {sheets.map((sheet, index) => (
            <Button
              key={`${sheet.url}-${index}`}
              mode="contained-tonal"
              icon="magnify"
              onPress={() => onView(sheet)}
            >
              {sheets.length > 1 ? `查看本人作答（第 ${index + 1} 页）` : '查看本人作答'}
            </Button>
          ))}
        </>
      ) : null}
    </Card>
  );
}
