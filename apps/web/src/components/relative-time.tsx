import { absoluteTime, relativeTime } from "../lib/format.ts";

/** "2 min ago", with the absolute UTC time on hover. */
export function RelativeTime({ timestamp, now }: { timestamp: number; now: number }) {
  return (
    <time dateTime={new Date(timestamp * 1000).toISOString()} title={absoluteTime(timestamp)}>
      {relativeTime(timestamp, now)}
    </time>
  );
}
