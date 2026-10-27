import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  StatusBar,
  useWindowDimensions,
  View,
  type ImageStyle,
  type ViewStyle,
} from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import {
  fetchSheetImage,
  sheetImageErrorMessage,
  sheetImageFailureMessage,
} from '@/src/services/sheet-images';
import type { AnswerSheet } from '@/src/domain/models';
import { imageRegionBounds, imageRegionLayout } from '@/src/domain/image-region';

function WholeSheetImage({
  sheet,
  style,
  reloadKey = 0,
  onError,
  onLoad,
  resizeMethod = 'none',
}: {
  sheet: AnswerSheet;
  style: ImageStyle & ViewStyle;
  reloadKey?: number;
  onError?: (message?: string) => void;
  onLoad?: (width: number, height: number) => void;
  /** Android 解码方式：列表用 resize（按显示尺寸解码，避免整页扫描件吃满堆），查看器保持 none（缩放清晰）。 */ resizeMethod?:
    'none' | 'resize' | 'auto';
}) {
  const [attempt, setAttempt] = useState<{
    key: string;
    uri?: string;
    failed?: string;
    fallback?: boolean;
  }>({ key: '' });
  const key = `${sheet.url}|${reloadKey}`;
  const state = attempt.key === key ? attempt : { key };
  const callbacks = useRef({ onError, onLoad });
  useEffect(() => {
    callbacks.current = { onError, onLoad };
  }, [onError, onLoad]);
  const task = useRef<{
    key: string;
    active: boolean;
    done: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const fail = useCallback(async () => {
    const current = task.current;
    if (!current?.active || current.key !== key || current.done) return;
    current.done = true;
    clearTimeout(current.timer);
    const message = await sheetImageErrorMessage(sheet.url);
    if (!current.active) return;
    setAttempt({ key, failed: message });
    callbacks.current.onError?.(message);
  }, [key, sheet.url]);
  const handleLoad = (event: { nativeEvent: { source: { width: number; height: number } } }) => {
    const current = task.current;
    if (!current?.active || current.key !== key || current.done) return;
    current.done = true;
    clearTimeout(current.timer);
    callbacks.current.onLoad?.(event.nativeEvent.source.width, event.nativeEvent.source.height);
  };
  useEffect(() => {
    const current = { key, active: true, done: false, timer: setTimeout(() => void fail(), 20000) };
    task.current = current;
    void fetchSheetImage(sheet.url, sheet.headers, reloadKey > 0)
      .then((uri) => {
        if (current.active && !current.done) setAttempt({ key, uri });
      })
      .catch(() => {
        if (current.active && !current.done) setAttempt({ key, fallback: true });
      });
    return () => {
      current.active = false;
      clearTimeout(current.timer);
    };
  }, [key, reloadKey, sheet.url, sheet.headers, fail]);
  if (state.failed)
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center', padding: 16 }]}>
        {!onError && <Text>{state.failed}</Text>}
      </View>
    );
  if (state.fallback)
    return (
      <Image
        source={{ uri: sheet.url, headers: sheet.headers }}
        style={style}
        resizeMode="contain"
        resizeMethod={resizeMethod}
        onLoad={handleLoad}
        onError={() => void fail()}
      />
    );
  if (!state.uri)
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator />
      </View>
    );
  return (
    <Image
      source={{ uri: state.uri }}
      style={style}
      resizeMode="contain"
      resizeMethod={resizeMethod}
      onLoad={handleLoad}
      onError={() => {
        const current = task.current;
        if (!current?.active || current.key !== key || current.done) return;
        if (state.uri === sheet.url) void fail();
        else setAttempt({ key, fallback: true });
      }}
    />
  );
}

type SheetImageProps = Parameters<typeof WholeSheetImage>[0];

export function SheetImage(props: SheetImageProps) {
  return props.sheet.region ? <RegionSheetImage {...props} /> : <WholeSheetImage {...props} />;
}

/** Keep the signed source unchanged; clip only the visible viewport, not the stored image. */
function RegionSheetImage({
  sheet,
  style,
  reloadKey = 0,
  onError,
  onLoad,
  resizeMethod,
}: SheetImageProps) {
  const key = `${sheet.url}|${reloadKey}|${JSON.stringify(sheet.region)}`;
  const [source, setSource] = useState({ key: '', width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [failure, setFailure] = useState({ key: '', message: '' });
  const natural = source.key === key ? source : undefined;
  const layout =
    natural &&
    imageRegionLayout(
      sheet.region!,
      natural.width,
      natural.height,
      viewport.width,
      viewport.height,
    );
  if (failure.key === key)
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center', padding: 16 }]}>
        {!onError && <Text>{failure.message}</Text>}
      </View>
    );
  return (
    <View
      style={[style, { overflow: 'hidden' }]}
      onLayout={(event) => setViewport(event.nativeEvent.layout)}
    >
      <WholeSheetImage
        key={key}
        sheet={sheet}
        reloadKey={reloadKey}
        resizeMethod={resizeMethod}
        style={
          layout
            ? { ...layout, position: 'absolute' }
            : { width: '100%', height: '100%', opacity: 0 }
        }
        onError={(message = sheetImageFailureMessage) => {
          setFailure({ key, message });
          onError?.(message);
        }}
        onLoad={(width, height) => {
          const bounds = imageRegionBounds(sheet.region!, width, height);
          if (!bounds) {
            setFailure({ key, message: sheetImageFailureMessage });
            onError?.(sheetImageFailureMessage);
            return;
          }
          setSource({ key, width, height });
          onLoad?.(bounds.width, bounds.height);
        }}
      />
      {!layout ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );
}

export function AdaptiveSheetImage({
  sheet,
  reloadKey,
  onError,
}: {
  sheet: AnswerSheet;
  reloadKey?: number;
  onError?: (message?: string) => void;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [ratio, setRatio] = useState<number>();
  const height =
    containerWidth > 0
      ? ratio !== undefined
        ? Math.min(520, Math.max(48, Math.round(containerWidth * ratio)))
        : 220
      : 360;
  return (
    <View onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}>
      <SheetImage
        sheet={sheet}
        resizeMethod="resize"
        style={{ width: '100%', height }}
        reloadKey={reloadKey}
        onError={onError}
        onLoad={(width, imageHeight) => {
          if (width > 0 && imageHeight > 0) setRatio(imageHeight / width);
        }}
      />
    </View>
  );
}

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
  gestureRef: {
    current: {
      startScale: number;
      startDistance: number;
      startOffset: { x: number; y: number };
      moved: boolean;
      longPressed: boolean;
      pressTimer: ReturnType<typeof setTimeout> | null;
    };
  };
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
  const {
    distance,
    containScale,
    applyTransform,
    containsPoint,
    onLongPress,
    gestureRef,
    transformRef,
    lastTapRef,
    onDismissRef,
  } = deps;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const touch = event.nativeEvent;
      const previous = lastTapRef.current;
      gestureRef.current = {
        startScale: transformRef.current.scale,
        startDistance: distance(touch.touches),
        startOffset: transformRef.current.offset,
        moved: false,
        longPressed: false,
        pressTimer: setTimeout(() => {
          gestureRef.current.longPressed = true;
          onLongPress();
        }, longPressMs),
      };
      if (
        previous &&
        Date.now() - previous.time < 500 &&
        Math.hypot(touch.pageX - previous.x, touch.pageY - previous.y) < 48
      ) {
        // 双击：在「适配屏幕」与「原图大小」之间切换，回到中心；本次按住不再触发长按。
        lastTapRef.current = null;
        cancelPressTimer(gestureRef.current);
        const contain = containScale();
        const original = Math.max(1, contain);
        applyTransform(transformRef.current.scale > (contain + original) / 2 ? contain : original, {
          x: 0,
          y: 0,
        });
      }
    },
    onPanResponderMove: (event, state) => {
      const touches = event.nativeEvent.touches;
      const currentDistance = distance(touches);
      if (touches.length >= 2 && currentDistance > 0) {
        cancelPressTimer(gestureRef.current);
        if (!gestureRef.current.startDistance) gestureRef.current.startDistance = currentDistance;
        gestureRef.current.moved = true;
        applyTransform(
          (gestureRef.current.startScale * currentDistance) / gestureRef.current.startDistance,
          transformRef.current.offset,
        );
        return;
      }
      if (Math.abs(state.dx) > tapMoveThreshold || Math.abs(state.dy) > tapMoveThreshold) {
        cancelPressTimer(gestureRef.current);
        gestureRef.current.moved = true;
      }
      applyTransform(transformRef.current.scale, {
        x: gestureRef.current.startOffset.x + state.dx,
        y: gestureRef.current.startOffset.y + state.dy,
      });
    },
    onPanResponderRelease: (event) => {
      cancelPressTimer(gestureRef.current);
      // 长按已弹出操作菜单：吞掉本次松开，避免同时触发退出或双击判定。
      if (gestureRef.current.longPressed) {
        lastTapRef.current = null;
        return;
      }
      if (gestureRef.current.moved) {
        lastTapRef.current = null;
        return;
      }
      const touch = event.nativeEvent;
      const x = touch.touches[0]?.pageX ?? touch.pageX;
      const y = touch.touches[0]?.pageY ?? touch.pageY;
      if (!containsPoint(x, y)) {
        onDismissRef.current();
        return;
      }
      lastTapRef.current = { time: Date.now(), x, y };
    },
    onPanResponderTerminate: () => {
      cancelPressTimer(gestureRef.current);
      gestureRef.current.moved = false;
    },
    onPanResponderTerminationRequest: () => false,
  });
}

/**
 * 全屏图片查看器（类似聊天软件的看图）：黑色遮罩铺满屏幕，图片初始适配屏幕。
 * 支持捏合缩放（上限可达原图 1:1）、单指拖动（有边界）、双击在「适配屏幕/原图大小」间切换；
 * 长按触发 `onLongPress`（用于保存/复制等操作）；点击图片外的遮罩或系统返回键退出。
 */
export function SheetViewerModal({
  sheet,
  sheets,
  onDismiss,
  onLongPress,
}: {
  sheet?: AnswerSheet;
  sheets?: AnswerSheet[];
  onDismiss: () => void;
  onLongPress?: (sheet: AnswerSheet) => void;
}) {
  const items = sheets ?? (sheet ? [sheet] : []);
  const key = JSON.stringify(items.map((item) => [item.url, item.region]));
  const [page, setPage] = useState({ key: '', index: 0 });
  const index = page.key === key ? Math.min(page.index, Math.max(0, items.length - 1)) : 0;
  const current = items[index];
  return (
    <Modal
      transparent
      animationType="fade"
      visible={!!current}
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      {current ? (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {current.region && (
            <Text
              style={{
                color: '#fff',
                textAlign: 'center',
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              {current.subject}
            </Text>
          )}
          <ImageViewer
            key={`${key}|${index}`}
            sheet={current}
            onDismiss={onDismiss}
            onLongPress={current.region ? undefined : onLongPress}
          />
          {items.length > 1 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                paddingTop: 8,
                paddingBottom: 32,
                backgroundColor: '#000',
              }}
            >
              <Button
                compact
                textColor="#fff"
                disabled={index === 0}
                accessibilityLabel="上一作答区域"
                onPress={() => setPage({ key, index: index - 1 })}
              >
                上一区域
              </Button>
              <Text style={{ color: '#fff' }} accessibilityLiveRegion="polite">
                区域 {index + 1} / {items.length}
              </Text>
              <Button
                compact
                textColor="#fff"
                disabled={index === items.length - 1}
                accessibilityLabel="下一作答区域"
                onPress={() => setPage({ key, index: index + 1 })}
              >
                下一区域
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}

function ImageViewer({
  sheet,
  onDismiss,
  onLongPress,
}: {
  sheet: AnswerSheet;
  onDismiss: () => void;
  onLongPress?: (sheet: AnswerSheet) => void;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [imageError, setImageError] = useState('');
  const [transform, setTransform] = useState({ scale: 1, offset: { x: 0, y: 0 } });
  const screenRef = useRef({ width: screenWidth, height: screenHeight });
  const naturalRef = useRef({ width: 0, height: 0 });
  const transformRef = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  const gestureRef = useRef({
    startScale: 1,
    startDistance: 0,
    startOffset: { x: 0, y: 0 },
    moved: false,
    longPressed: false,
    pressTimer: null as ReturnType<typeof setTimeout> | null,
  });
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const onDismissRef = useRef(onDismiss);
  const longPressRef = useRef(onLongPress);
  const sheetRef = useRef(sheet);
  const distance = useCallback(
    (touches: readonly { pageX: number; pageY: number }[]) =>
      touches.length < 2
        ? 0
        : Math.hypot(touches[1].pageX - touches[0].pageX, touches[1].pageY - touches[0].pageY),
    [],
  );
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    longPressRef.current = onLongPress;
    sheetRef.current = sheet;
  }, [onLongPress, sheet]);
  const fireLongPress = useCallback(() => {
    const current = sheetRef.current;
    longPressRef.current?.(current);
  }, []);

  const containScale = useCallback((): number => {
    const screen = screenRef.current;
    const size = naturalRef.current;
    return size.width > 0 ? Math.min(screen.width / size.width, screen.height / size.height) : 1;
  }, []);

  const applyTransform = useCallback(
    (nextScale: number, nextOffset: { x: number; y: number }) => {
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
    },
    [containScale],
  );

  const containsPoint = useCallback((pageX: number, pageY: number): boolean => {
    const screen = screenRef.current;
    const size = naturalRef.current;
    const { scale, offset } = transformRef.current;
    return (
      Math.abs(pageX - (screen.width / 2 + offset.x)) <= (size.width * scale) / 2 &&
      Math.abs(pageY - (screen.height / 2 + offset.y)) <= (size.height * scale) / 2
    );
  }, []);

  // 依赖均为稳定回调与 ref，responder 仅创建一次；手势状态全部经 ref 读写，创建放在 effect 里以满足渲染纯度。
  const [panResponder, setPanResponder] = useState<ReturnType<typeof createViewerPanResponder>>();
  useEffect(() => {
    setPanResponder(
      createViewerPanResponder({
        distance,
        containScale,
        applyTransform,
        containsPoint,
        onLongPress: fireLongPress,
        gestureRef,
        transformRef,
        lastTapRef,
        onDismissRef,
      }),
    );
  }, [applyTransform, containScale, containsPoint, distance, fireLongPress]);
  useEffect(
    () => () => {
      cancelPressTimer(gestureRef.current);
      lastTapRef.current = null;
    },
    [],
  );

  const baseWidth = natural.width || screenWidth;
  const baseHeight = natural.height || Math.round(screenWidth * 1.4);
  return (
    <View
      style={{ flex: 1, backgroundColor: '#000' }}
      onLayout={(event) => {
        screenRef.current = {
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        };
        if (naturalRef.current.width > 0) applyTransform(containScale(), { x: 0, y: 0 });
      }}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={{ flex: 1 }} {...panResponder?.panHandlers}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              transform: [
                { translateX: transform.offset.x },
                { translateY: transform.offset.y },
                { scale: transform.scale },
              ],
            }}
          >
            <SheetImage
              sheet={sheet}
              style={{ width: baseWidth, height: baseHeight }}
              onError={(message) => setImageError(message ?? sheetImageFailureMessage)}
              onLoad={(imageWidth, imageHeight) => {
                naturalRef.current = { width: imageWidth, height: imageHeight };
                setNatural({ width: imageWidth, height: imageHeight });
                applyTransform(containScale(), { x: 0, y: 0 });
              }}
            />
          </View>
        </View>
      </View>
      {imageError ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            backgroundColor: '#000',
          }}
        >
          <Text style={{ color: '#fff', textAlign: 'center', paddingHorizontal: 24 }}>
            {imageError}
          </Text>
          <Button textColor="#fff" onPress={onDismiss}>
            关闭预览
          </Button>
        </View>
      ) : null}
    </View>
  );
}
