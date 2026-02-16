function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(msg: string, ...args: any[]) {
    console.log(`[${timestamp()}] [INFO] ${msg}`, ...args);
  },

  warn(msg: string, ...args: any[]) {
    console.warn(`[${timestamp()}] [WARN] ${msg}`, ...args);
  },

  error(msg: string, ...args: any[]) {
    console.error(`[${timestamp()}] [ERROR] ${msg}`, ...args);
  },

  debug(msg: string, ...args: any[]) {
    if (process.env.DEBUG) {
      console.log(`[${timestamp()}] [DEBUG] ${msg}`, ...args);
    }
  },

  track(trackName: string, msg: string) {
    console.log(`[${timestamp()}] [${trackName.toUpperCase()}] ${msg}`);
  },
};
