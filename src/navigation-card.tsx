import { View } from 'react-native';
import { Card, List } from 'react-native-paper';

export function NavigationCard({ title, icon, external = false, onPress }: {
  title: string;
  icon: string;
  external?: boolean;
  onPress: () => void;
}) {
  return (
    <Card mode="contained" accessibilityRole={external ? 'link' : 'button'} accessibilityLabel={title} onPress={onPress}>
      <View pointerEvents="none">
        <List.Item
          title={title}
          style={{ paddingHorizontal: 16 }}
          left={(props) => <List.Icon {...props} style={[props.style, { marginHorizontal: 0 }]} icon={icon} />}
          right={(props) => <List.Icon {...props} style={[props.style, { marginHorizontal: 0 }]} icon={external ? 'open-in-new' : 'chevron-right'} />}
        />
      </View>
    </Card>
  );
}
