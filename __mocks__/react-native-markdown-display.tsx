import type { ReactNode } from 'react';
import { Text } from 'react-native';

export default function Markdown({ children }: { children?: ReactNode }) {
  return <Text>{children}</Text>;
}
