import { Fragment, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Divider, List, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AnswerSheet } from './domain/models';
import { saveSheetToLibrary } from './services/save-sheet';
import { showToast } from './ui';

/** 普通答题卡与分数标注答题卡共用的长按菜单。 */
export function SheetActionsSheet({ sheet, onDismiss }: { sheet?: AnswerSheet; onDismiss: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  async function save(item: AnswerSheet) {
    if (saving) return;
    setSaving(true);
    onDismiss();
    try { await saveSheetToLibrary(item); showToast('已保存到相册'); }
    catch (error) { showToast(`保存失败：${error instanceof Error ? error.message : '请稍后重试'}`); }
    finally { setSaving(false); }
  }
  async function copy(item: AnswerSheet) {
    onDismiss();
    try { await Clipboard.setStringAsync(item.url); showToast('图片链接已复制'); }
    catch { showToast('复制失败，请稍后重试'); }
  }
  if (!sheet) return null;
  // 带请求头的图片需要会话，保留只提供保存操作的规则。
  const entries = [
    ...(sheet.headers || sheet.url.startsWith('data:') ? [] : [{ key: 'copy', icon: 'content-copy', label: '复制链接', onPress: () => void copy(sheet) }]),
    { key: 'save', icon: 'download', label: saving ? '正在保存…' : '保存图片', onPress: () => void save(sheet) },
  ];
  return <Modal transparent visible animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <Pressable style={{ flex: 1 }} accessibilityLabel="关闭操作菜单" onPress={onDismiss} />
      <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 4, paddingBottom: insets.bottom + 8 }}>
        {entries.map((entry, index) => <Fragment key={entry.key}>
          {index > 0 && <Divider />}
          <List.Item title={entry.label} disabled={entry.key === 'save' && saving} left={() => <List.Icon icon={entry.icon} />} onPress={entry.onPress} style={{ paddingHorizontal: 8 }} />
        </Fragment>)}
        <Divider />
        <Pressable accessibilityRole="button" onPress={onDismiss} style={{ padding: 16, alignItems: 'center' }}><Text>取消</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
