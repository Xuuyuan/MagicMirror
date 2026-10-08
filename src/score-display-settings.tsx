import { useState } from 'react';
import { Button, Menu, Text } from 'react-native-paper';
import { useAppStore } from './state/app';
import { gradeDisplayOptions, isGradeDisplayMode } from './services/score-display';
import { Card } from './ui';

export function ScoreDisplaySettings() {
  const showAbsent = useAppStore(state => state.showAbsentSubjects);
  const setShowAbsent = useAppStore(state => state.setShowAbsentSubjects);
  const gradeDisplay = useAppStore(state => state.septnetGradeDisplay);
  const setGradeDisplay = useAppStore(state => state.setSeptnetGradeDisplay);
  const [openMenu, setOpenMenu] = useState<'absent' | 'grade' | null>(null);
  return <Card>
    <Text variant="titleMedium">成绩显示</Text>
    <Text variant="labelLarge">显示缺考科目</Text>
    <Menu anchorPosition="bottom" visible={openMenu === 'absent'} onDismiss={() => setOpenMenu(null)} anchor={<Button mode="outlined" icon="chevron-down" contentStyle={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }} labelStyle={{ flex: 1, textAlign: 'left' }} accessibilityLabel={`显示缺考科目：${showAbsent ? '显示' : '隐藏'}`} onPress={() => setOpenMenu(openMenu === 'absent' ? null : 'absent')}>{showAbsent ? '显示' : '隐藏'}</Button>}>
      {[{ value: true, label: '显示' }, { value: false, label: '隐藏' }].map(option => <Menu.Item key={option.label} title={option.label} leadingIcon={showAbsent === option.value ? 'check' : undefined} onPress={() => { setShowAbsent(option.value); setOpenMenu(null); }} />)}
    </Menu>
    <Text variant="labelLarge">七天学堂-等第显示方式</Text>
    <Menu anchorPosition="bottom" visible={openMenu === 'grade'} onDismiss={() => setOpenMenu(null)} anchor={<Button mode="outlined" icon="chevron-down" contentStyle={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }} labelStyle={{ flex: 1, textAlign: 'left' }} accessibilityLabel="七天学堂-等第显示方式" onPress={() => setOpenMenu(openMenu === 'grade' ? null : 'grade')}>{gradeDisplayOptions.find(option => option.mode === gradeDisplay)?.label}</Button>}>
      {gradeDisplayOptions.map(option => <Menu.Item key={option.mode} title={option.label} leadingIcon={gradeDisplay === option.mode ? 'check' : undefined} onPress={() => { if (isGradeDisplayMode(option.mode)) setGradeDisplay(option.mode); setOpenMenu(null); }} />)}
    </Menu>
  </Card>;
}
