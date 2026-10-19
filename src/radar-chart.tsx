import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg';
import type { RadarReport } from './domain/models';

export function RadarChart({ data }: { data: RadarReport }) {
  const theme = useTheme();
  const colors = [
    theme.colors.primary,
    theme.colors.tertiary,
    theme.colors.secondary,
    theme.colors.outline,
  ];
  const size = 360;
  const center = size / 2;
  const radius = 112;
  const point = (index: number, value: number) => {
    const angle = (index * 2 * Math.PI) / data.axes.length - Math.PI / 2;
    return {
      x: center + (Math.cos(angle) * radius * value) / 100,
      y: center + (Math.sin(angle) * radius * value) / 100,
    };
  };
  const coordinates = (index: number, value: number) => {
    const position = point(index, value);
    return `${position.x},${position.y}`;
  };
  if (!data.axes.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ width: '100%', aspectRatio: 1, maxWidth: 460, alignSelf: 'center' }}>
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size} ${size}`}
          accessibilityLabel="学科水平雷达图，刻度0至100"
        >
          {[0, 20, 40, 60, 80, 100].map((value) => (
            <Polygon
              key={value}
              points={data.axes.map((_, index) => coordinates(index, value)).join(' ')}
              fill="none"
              stroke={theme.colors.outline}
              strokeWidth={1}
            />
          ))}
          <Circle cx={center} cy={center} r={1.5} fill={theme.colors.outline} />
          {data.axes.map((label, index) => {
            const edge = point(index, 100);
            return (
              <Line
                key={`axis-${index}`}
                x1={center}
                y1={center}
                x2={edge.x}
                y2={edge.y}
                stroke={theme.colors.outlineVariant}
              />
            );
          })}
          {data.series.map((series, seriesIndex) => {
            const color = colors[seriesIndex % colors.length];
            const complete =
              series.values.length === data.axes.length &&
              series.values.every((value) => value != null);
            return (
              <G key={series.label}>
                {complete && data.axes.length >= 3 && (
                  <Polygon
                    points={series.values
                      .map((value, index) => coordinates(index, value!))
                      .join(' ')}
                    fill={color}
                    fillOpacity={0.08}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray={seriesIndex === 0 ? undefined : `${6 - seriesIndex} 3`}
                  />
                )}
                {series.values.map((value, index) => {
                  if (value == null) return null;
                  const position = point(index, value);
                  const nextIndex = (index + 1) % data.axes.length;
                  const next = series.values[nextIndex];
                  const endpoint = next == null ? undefined : point(nextIndex, next);
                  return (
                    <G key={index}>
                      {(!complete || data.axes.length < 3) && endpoint && (
                        <Line
                          x1={position.x}
                          y1={position.y}
                          x2={endpoint.x}
                          y2={endpoint.y}
                          stroke={color}
                          strokeWidth={2}
                          strokeDasharray={seriesIndex === 0 ? undefined : '4 3'}
                        />
                      )}
                      <Circle
                        cx={position.x}
                        cy={position.y}
                        r={3}
                        fill={color}
                        accessibilityLabel={`${data.axes[index]} ${series.label}${value} / 100`}
                      />
                    </G>
                  );
                })}
              </G>
            );
          })}
          {data.axes.map((label, index) => {
            const caption = point(index, 126);
            return (
              <SvgText
                key={`label-${index}`}
                x={caption.x}
                y={caption.y + 4}
                textAnchor="middle"
                fontSize={12}
                fill={theme.colors.onSurface}
              >
                {label}
              </SvgText>
            );
          })}
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
        {data.series.map((series, index) => (
          <View key={series.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View
              style={{ width: 16, height: 3, backgroundColor: colors[index % colors.length] }}
            />
            <Text variant="labelMedium">{series.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
