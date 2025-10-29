import { useEffect, useMemo, useState } from 'react';
import { useStdout } from 'ink';

const useStdoutDimensions = (): [number, number] => {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState<[number, number]>([
    stdout?.columns ?? 0,
    stdout?.rows ?? 0,
  ]);

  useEffect(() => {
    if (!stdout) {
      return;
    }

    const update = () => {
      setDimensions([stdout.columns ?? 0, stdout.rows ?? 0]);
    };

    update();
    stdout.on('resize', update);
    return () => {
      stdout.off('resize', update);
    };
  }, [stdout]);

  return dimensions;
};

export const useCompactLayout = (breakpoint = 60) => {
  const [width] = useStdoutDimensions();
  return useMemo(() => {
    if (!width) {
      return false;
    }
    return width <= breakpoint;
  }, [width, breakpoint]);
};
