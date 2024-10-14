export interface logMsg {
  timestamp: number;
  msg: string;
  level: string;
  data?: unknown;
}

export function tyLogger(toTarget: (msg: logMsg) => void) {
  function createLevelLogger(level: string) {
    return function info(msg: string, data?: unknown) {
      toTarget({
        timestamp: Date.now(),
        msg,
        level,
        data,
      });
    };
  }

  return {
    info: createLevelLogger('info'),
    error: createLevelLogger('error'),
  };
}
