// Interface for log messages
export interface logMsg {
  timestamp: number;
  msg: string;
  level: string;
  data?: unknown;
}

// Logger configuration interface
export interface LoggerConfig {
  targets: Record<string, logTarget[]>;
  timestamp: () => number;
}

// Log target function type
export type logTarget = (msg: logMsg) => void;

// Logger function, automatically inferring log levels from targets
export function createLogger<T extends string>(
  config: LoggerConfig & { targets: Record<T, logTarget[]> },
) {
  // Function to resolve target routes from a tree-like structure
  function resolveTargets(
    level: string,
    targets: Record<string, logTarget[]>,
  ): logTarget[] {
    let result: logTarget[] = [];

    // Traverse the tree from the most specific to the general levels
    let currentLevel = level;
    while (currentLevel) {
      if (targets[currentLevel]) {
        result = result.concat(targets[currentLevel]);
      }
      // Move to parent level by splitting based on dot notation (e.g., "global.error" -> "global")
      currentLevel = currentLevel.includes('.')
        ? currentLevel.split('.').slice(0, -1).join('.')
        : '';
    }

    return result;
  }

  // Function to log messages based on level
  const log = (level: T) => (msg: string, data?: unknown) => {
    const logMessage: logMsg = {
      timestamp: config.timestamp(),
      msg,
      level,
      data,
    };

    // Get the associated targets from the hierarchical structure
    const targetFns = resolveTargets(level, config.targets);

    // Dispatch the message to all determined targets
    targetFns.forEach((targetFn) => targetFn(logMessage));
  };

  // Dynamically generate logging functions based on the defined levels (keys of targets)
  return Object.keys(config.targets).reduce(
    (loggers, level) => {
      loggers[level as T] = log(level as T);
      return loggers;
    },
    {} as { [K in T]: (msg: string, data?: unknown) => void },
  );
}

// Target function that logs to the console
const consoleLog = (msg: logMsg) => {
  console.log(msg.msg, msg.data);
};

// Target function that logs to the console
const consoleError = (msg: logMsg) => {
  console.error(msg.msg, msg.data);
};

// Target function that simulates sending logs to a client
const sendToClient = (msg: logMsg) => {
  console.log(`Sending to client: ${msg.msg}`, msg.data);
};

// Example usage with tree-like structure for log routing
const logger = createLogger({
  targets: {
    info: [consoleLog],
    error: [consoleError],
    clienterr: [consoleError, sendToClient],
  }, // Define hierarchical structure of log targets
  timestamp: () => Date.now(), // Timestamp generator
});

// Log some messages
logger.info('This is an info message'); // Goes to console
logger.error('This is an error message', { errorCode: 123 }); // Goes to console and client
logger.clienterr('This is a global error message'); // Goes to client only
