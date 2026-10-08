import { useState } from 'react';
import { Platform } from 'react-native';
import { Button } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { diagnosticSnapshot } from './services/diagnostics';
import { useAppStore } from './state/app';

const diagnosticBuild = '20261004-clean-1';

export function DiagnosticButton() {
  const debugMode = useAppStore((state) => state.debugMode);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await Clipboard.setStringAsync(JSON.stringify({ build: diagnosticBuild, appVersion: Constants.expoConfig?.version, os: Platform.OS, osVersion: Platform.Version, events: diagnosticSnapshot() }, null, 2));
      setCopied(true);
    } catch { setCopied(false); }
  }
  if (!debugMode) return null;
  return <Button icon="content-copy" onPress={() => void copy()}>{copied ? '已复制调试信息' : '复制调试信息'}</Button>;
}
