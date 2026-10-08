import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, PanResponder, StatusBar, useWindowDimensions, View, type ImageStyle, type ViewStyle } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { fetchSheetImage } from '@/src/services/sheet-images';
import type { AnswerSheet } from '@/src/domain/models';

export function SheetImage({ sheet, style, reloadKey = 0, onError, onLoad }: { sheet: AnswerSheet; style: ImageStyle & ViewStyle; reloadKey?: number; onError?: () => void; onLoad?: (width: number, height: number) => void }) { const [attempt, setAttempt] = useState<{ key: string; uri?: string; failed?: boolean; fallback?: boolean }>({ key: '' }); const key = `${sheet.url}|${reloadKey}`; const state = attempt.key === key ? attempt : { key }; const handleLoad = (event: { nativeEvent: { source: { width: number; height: number } } }) => onLoad?.(event.nativeEvent.source.width, event.nativeEvent.source.height); useEffect(() => { let active = true; void fetchSheetImage(sheet.url, sheet.headers, reloadKey > 0).then((uri) => { if (active) setAttempt({ key, uri }); }).catch(() => { if (active) setAttempt({ key, fallback: true }); }); return () => { active = false; }; }, [key, reloadKey, sheet.url, sheet.headers]); if (state.failed) return <View style={style} />; if (state.fallback) return <Image source={{ uri: sheet.url, headers: sheet.headers }} style={style} resizeMode="contain" resizeMethod="none" onLoad={handleLoad} onError={() => { setAttempt({ key, failed: true }); onError?.(); }} />; if (!state.uri) return <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator /></View>; return <Image source={{ uri: state.uri }} style={style} resizeMode="contain" resizeMethod="none" onLoad={handleLoad} onError={() => { setAttempt({ key, fallback: true }); }} />; }

export function AdaptiveSheetImage({ sheet, reloadKey, onError }: { sheet: AnswerSheet; reloadKey?: number; onError?: () => void }) { const [containerWidth, setContainerWidth] = useState(0); const [ratio, setRatio] = useState<number>(); const height = containerWidth > 0 ? (ratio !== undefined ? Math.min(520, Math.max(48, Math.round(containerWidth * ratio))) : 220) : 360; return <View onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}><SheetImage sheet={sheet} style={{ width: '100%', height }} reloadKey={reloadKey} onError={onError} onLoad={(width, imageHeight) => { if (width > 0 && imageHeight > 0) setRatio(imageHeight / width); }} /></View>; }

/** 单指位移超过该距离视为拖动，而不是点击。 */
const tapMoveThreshold = 6;
/** 按住该时长且未移动视为长按（弹出保存/复制等操作）。 */
const longPressMs = 500;

/** 查看器手势依赖的稳定回调与 ref；回调只在触摸事件里执行，创建 responder 本身是纯操作。 */
interface ViewerGestureDeps {
  distance: (touches: readonly { pageX: number; pageY: number }[]) => number;
  containScale: () => number;
  applyTransform: (nextScale: number, nextOffset: { x: number; y: number }) => void;
  containsPoint: (pageX: number, pageY: number) => boolean;
  onLongPress: () => void;
  gestureRef: { current: { startScale: number; startDistance: number; startOffset: { x: number; y: number }; moved: boolean; longPressed: boolean; pressTimer: ReturnType<typeof setTimeout> | null } };
  transformRef: { current: { scale: number; offset: { x: number; y: number } } };
  lastTapRef: { current: { time: number; x: number; y: number } | null };
  onDismissRef: { current: () => void };
}

/** 取消当前手势的长按计时（移动、捏合、松开时调用）。 */
function cancelPressTimer(gesture: ViewerGestureDeps['gestureRef']['current']): void {
  if (gesture.pressTimer) clearTimeout(gesture.pressTimer);
  gesture.pressTimer = null;
}

/** 创建全屏查看器的手势处理：捏合缩放、单指拖动（有边界）、双击切换适配/原图、长按弹操作、点遮罩退出。 */
function createViewerPanResponder(deps: ViewerGestureDeps) {
  const { distance, containScale, applyTransform, containsPoint, onLongPress, gestureRef, transformRef, lastTapRef, onDismissRef } = deps;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const touch = event.nativeEvent;
      const previous = lastTapRef.current;
      gestureRef.current = { startScale: transformRef.current.scale, startDistance: distance(touch.touches), startOffset: transformRef.current.offset, moved: false, longPressed: false, pressTimer: setTimeout(() => { gestureRef.current.longPressed = true; onLongPress(); }, longPressMs) };
      if (previous && Date.now() - previous.time < 500 && Math.hypot(touch.pageX - previous.x, touch.pageY - previous.y) < 48) {
        // 双击：在「适配屏幕」与「原图大小」之间切换，回到中心；本次按住不再触发长按。
        lastTapRef.current = null;
        cancelPressTimer(gestureRef.current);
        const contain = containScale();
        const original = Math.max(1, contain);
        applyTransform(transformRef.current.scale > (contain + original) / 2 ? contain : original, { x: 0, y: 0 });
      }
    },
    onPanResponderMove: (event, state) => {
      const touches = event.nativeEvent.touches;
      const currentDistance = distance(touches);
      if (touches.length >= 2 && currentDistance > 0) {
        cancelPressTimer(gestureRef.current);
        if (!gestureRef.current.startDistance) gestureRef.current.startDistance = currentDistance;
        gestureRef.current.moved = true;
        applyTransform(gestureRef.current.startScale * currentDistance / gestureRef.current.startDistance, transformRef.current.offset);
        return;
      }
      if (Math.abs(state.dx) > tapMoveThreshold || Math.abs(state.dy) > tapMoveThreshold) {
        cancelPressTimer(gestureRef.current);
        gestureRef.current.moved = true;
      }
      applyTransform(transformRef.current.scale, { x: gestureRef.current.startOffset.x + state.dx, y: gestureRef.current.startOffset.y + state.dy });
    },
    onPanResponderRelease: (event) => {
      cancelPressTimer(gestureRef.current);
      // 长按已弹出操作菜单：吞掉本次松开，避免同时触发退出或双击判定。
      if (gestureRef.current.longPressed) { lastTapRef.current = null; return; }
      if (gestureRef.current.moved) { lastTapRef.current = null; return; }
      const touch = event.nativeEvent;
      const x = touch.touches[0]?.pageX ?? touch.pageX;
      const y = touch.touches[0]?.pageY ?? touch.pageY;
      if (!containsPoint(x, y)) { onDismissRef.current(); return; }
      lastTapRef.current = { time: Date.now(), x, y };
    },
    onPanResponderTerminate: () => { cancelPressTimer(gestureRef.current); gestureRef.current.moved = false; },
    onPanResponderTerminationRequest: () => false,
  });
}

/**
 * 全屏图片查看器（类似聊天软件的看图）：黑色遮罩铺满屏幕，图片初始适配屏幕。
 * 支持捏合缩放（上限可达原图 1:1）、单指拖动（有边界）、双击在「适配屏幕/原图大小」间切换；
 * 长按触发 `onLongPress`（用于保存/复制等操作）；点击图片外的遮罩或系统返回键退出。
 */
export function SheetViewerModal({ sheet, onDismiss, onLongPress }: { sheet: AnswerSheet | undefined; onDismiss: () => void; onLongPress?: (sheet: AnswerSheet) => void }) {
  return <Modal transparent animationType="fade" visible={!!sheet} onRequestClose={onDismiss} statusBarTranslucent>
    {sheet ? <ImageViewer sheet={sheet} onDismiss={onDismiss} onLongPress={onLongPress} /> : null}
  </Modal>;
}

function ImageViewer({ sheet, onDismiss, onLongPress }: { sheet: AnswerSheet; onDismiss: () => void; onLongPress?: (sheet: AnswerSheet) => void }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState({ scale: 1, offset: { x: 0, y: 0 } });
  const screenRef = useRef({ width: screenWidth, height: screenHeight });
  const naturalRef = useRef({ width: 0, height: 0 });
  const transformRef = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  const gestureRef = useRef({ startScale: 1, startDistance: 0, startOffset: { x: 0, y: 0 }, moved: false, longPressed: false, pressTimer: null as ReturnType<typeof setTimeout> | null });
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const onDismissRef = useRef(onDismiss);
  const longPressRef = useRef(onLongPress);
  const sheetRef = useRef(sheet);
  const distance = useCallback((touches: readonly { pageX: number; pageY: number }[]) => touches.length < 2 ? 0 : Math.hypot(touches[1].pageX - touches[0].pageX, touches[1].pageY - touches[0].pageY), []);
  useEffect(() => { screenRef.current = { width: screenWidth, height: screenHeight }; }, [screenWidth, screenHeight]);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => { longPressRef.current = onLongPress; sheetRef.current = sheet; }, [onLongPress, sheet]);
  const fireLongPress = useCallback(() => { const current = sheetRef.current; longPressRef.current?.(current); }, []);

  const containScale = useCallback((): number => {
    const screen = screenRef.current;
    const size = naturalRef.current;
    return size.width > 0 ? Math.min(screen.width / size.width, screen.height / size.height) : 1;
  }, []);

  const applyTransform = useCallback((nextScale: number, nextOffset: { x: number; y: number }) => {
    const screen = screenRef.current;
    const size = naturalRef.current;
    const contain = containScale();
    const boundedScale = Math.min(Math.max(1, contain) * 4, Math.max(contain, nextScale));
    const maxX = Math.max(0, (size.width * boundedScale - screen.width) / 2);
    const maxY = Math.max(0, (size.height * boundedScale - screen.height) / 2);
    const boundedOffset = {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y)),
    };
    transformRef.current = { scale: boundedScale, offset: boundedOffset };
    setTransform({ scale: boundedScale, offset: boundedOffset });
  }, [containScale]);

  const containsPoint = useCallback((pageX: number, pageY: number): boolean => {
    const screen = screenRef.current;
    const size = naturalRef.current;
    const { scale, offset } = transformRef.current;
    return Math.abs(pageX - (screen.width / 2 + offset.x)) <= (size.width * scale) / 2
      && Math.abs(pageY - (screen.height / 2 + offset.y)) <= (size.height * scale) / 2;
  }, []);

  // 依赖均为稳定回调与 ref，responder 仅创建一次；手势状态全部经 ref 读写，创建放在 effect 里以满足渲染纯度。
  const [panResponder, setPanResponder] = useState<ReturnType<typeof createViewerPanResponder>>();
  useEffect(() => {
    setPanResponder(createViewerPanResponder({ distance, containScale, applyTransform, containsPoint, onLongPress: fireLongPress, gestureRef, transformRef, lastTapRef, onDismissRef }));
  }, [applyTransform, containScale, containsPoint, distance, fireLongPress]);

  const baseWidth = natural.width || screenWidth;
  const baseHeight = natural.height || Math.round(screenWidth * 1.4);
  return <View style={{ flex: 1, backgroundColor: '#000' }}>
    <StatusBar barStyle="light-content" backgroundColor="#000000" />
    <View style={{ flex: 1 }} {...panResponder?.panHandlers}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ transform: [{ translateX: transform.offset.x }, { translateY: transform.offset.y }, { scale: transform.scale }] }}>
          <SheetImage sheet={sheet} style={{ width: baseWidth, height: baseHeight }} onLoad={(imageWidth, imageHeight) => { naturalRef.current = { width: imageWidth, height: imageHeight }; setNatural({ width: imageWidth, height: imageHeight }); applyTransform(containScale(), { x: 0, y: 0 }); }} />
        </View>
      </View>
    </View>
  </View>;
}
