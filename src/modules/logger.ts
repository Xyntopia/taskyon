// Interface for log messages
export interface logMsg {
  timestamp: number;
  msg: string;
  level: string;
  data?: unknown;
}

// Log target function type
type logTarget = (msg: logMsg) => void;

export type logFunc = (msg: string, data?: unknown) => void;

// Logger configuration interface
interface LoggerConfig {
  targets: Record<string, logTarget[]>;
  timestamp: () => number;
}

// Logger function, automatically inferring log levels from targets
export function createLogger<T extends string>(
  config: LoggerConfig & { targets: Record<T, logTarget[]> },
) {
  // define hierarchies, by adding self-referring "strings" to our definition
  //  use a structure which iherently  can not be misused with cyclc dependenices though

  // Function to log messages based on level
  const log = (level: string) => (msg: string, data?: unknown) => {
    const message = {
      timestamp: config.timestamp(),
      msg,
      level,
      data,
    };
    config.targets[level]?.forEach((t) => t(message));
  };

  const logger = Object.keys(config.targets).reduce(
    (loggers, level) => {
      loggers[level as T] = log(level as T);
      return loggers;
    },
    {} as { [K in T]: logFunc },
  );

  // Dynamically generate logging functions based on the defined levels (keys of targets)
  return {
    ...logger,
    _: {
      // we can call this to extend/overwrite our logger wth more targets / log levels
      extend: <U extends string>(
        xconfig: LoggerConfig & { targets: Record<U, logTarget[]> },
      ) => {
        const newLogger = createLogger(xconfig);
        return {
          ...logger,
          ...newLogger,
        } as { [K in U | T]: logFunc };
      },
    },
  };
}
