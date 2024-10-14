// Interface for log messages
export interface logMsg {
  timestamp: number;
  msg: string;
  level: string;
  data?: unknown;
}

// Log target function type
export type logTarget = (msg: logMsg) => void;

// Logger configuration interface
export interface LoggerConfig {
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
