import Constants from 'expo-constants';
import { Alert, Image, Linking, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { Body, Card, Header, Screen } from '@/src/ui';
import { NavigationCard } from '@/src/navigation-card';

const projectUrl = 'https://github.com/Xuuyuan/MagicMirror';
const licenseUrl = 'https://github.com/Xuuyuan/MagicMirror?tab=Apache-2.0-1-ov-file';

export default function About() {
  const theme = useTheme();

  async function openLink(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('无法打开链接', '请稍后重试，或在浏览器中打开项目 GitHub 地址。');
    }
  }

  return (
    <Screen>
      <Header title="关于" back />
      <Body>
        <Card>
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 16 }}>
            <Image source={require('../assets/icon.png')} accessibilityLabel="魔镜 App logo" resizeMode="contain" style={{ width: 96, height: 96, borderRadius: 24 }} />
            <Text variant="titleLarge" style={{ textAlign: 'center' }}>魔镜</Text>
            <Text variant="bodyMedium" style={{ textAlign: 'center' }}>{Constants.expoConfig?.version ?? '未知'}</Text>
          </View>
          <Text variant="bodyMedium" style={{ textAlign: 'left' }}>
            本项目遵循 <Text accessibilityRole="link" style={{ color: theme.colors.primary, textDecorationLine: 'underline' }} onPress={() => void openLink(licenseUrl)}>Apache-2.0 license</Text>{' 开源。'}
          </Text>
        </Card>
        <NavigationCard
          title="GitHub"
          icon="github"
          external
          onPress={() => void openLink(projectUrl)}
        />
      </Body>
    </Screen>
  );
}
