import { type Logger, pino } from "pino";

export type { Logger };

/** JSON logs with the fields every Leash service carries (04-conventions §1). */
export function createLogger(level: string, cluster: string): Logger {
  return pino({ level, base: { service: "facilitator", cluster } });
}
