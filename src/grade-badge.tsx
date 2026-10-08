import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppStore } from './state/app';
import { formatGradeLabel } from './services/score-display';
import { Badge } from './ui';

export function GradeBadge({ providerId, grade, percentile, style }: {
  providerId?: string; grade?: string; percentile?: string; style?: StyleProp<ViewStyle>;
}) {
  const mode = useAppStore(state => state.septnetGradeDisplay);
  const label = formatGradeLabel(providerId, grade, percentile, mode);
  return label ? <View style={style}><Badge label={label} /></View> : null;
}
