/** Tiny leveled logger with a stable, greppable prefix per subsystem. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const envLevel = (process.env.PRISM_LOG || 'info').toLowerCase();
let threshold = LEVELS[envLevel] ?? LEVELS.info;

export function setLogLevel(level) {
  threshold = LEVELS[level] ?? threshold;
}

const COLOURS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;

function emit(level, scope, args) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 23);
  const tag = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}]`;
  const line = useColour ? `${COLOURS[level]}${tag}${RESET}` : tag;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line, ...args);
}

export function logger(scope) {
  return {
    debug: (...a) => emit('debug', scope, a),
    info: (...a) => emit('info', scope, a),
    warn: (...a) => emit('warn', scope, a),
    error: (...a) => emit('error', scope, a),
  };
}

export default logger;