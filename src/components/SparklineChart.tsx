import { View } from 'react-native';
import Svg, { Polyline, Path, Circle } from 'react-native-svg';
import { T } from '@/theme';

interface Props {
  values:      number[];
  color?:      string;
  width?:      number;
  height?:     number;
  filled?:     boolean;
  strokeWidth?: number;
  showDot?:    boolean;
}

export default function SparklineChart({
  values,
  color       = T.accent,
  width       = 80,
  height      = 36,
  filled      = true,
  strokeWidth = 1.5,
  showDot     = true,
}: Props) {
  if (!values || values.length < 2) return <View style={{ width, height }} />;

  const PAD = 3;
  const W   = width  - PAD * 2;
  const H   = height - PAD * 2;

  const min   = Math.min(...values);
  const max   = Math.max(...values);
  const range = max - min || 1;

  const pts = values.map((v, i) => ({
    x: PAD + (i / (values.length - 1)) * W,
    y: PAD + ((max - v) / range) * H,
  }));

  const polylinePoints = pts.map(p => `${p.x},${p.y}`).join(' ');

  const first  = pts[0];
  const last   = pts[pts.length - 1];
  const bottom = height - PAD;
  const areaD  = [
    `M ${first.x},${bottom}`,
    ...pts.map(p => `L ${p.x},${p.y}`),
    `L ${last.x},${bottom}`,
    'Z',
  ].join(' ');

  // Area fill: append '22' for ~13% opacity hex shorthand
  const areaFill = color + '22';

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        {filled && <Path d={areaD} fill={areaFill} />}
        <Polyline
          points={polylinePoints}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {showDot && (
          <Circle
            cx={last.x}
            cy={last.y}
            r={strokeWidth * 1.8}
            fill={color}
          />
        )}
      </Svg>
    </View>
  );
}
