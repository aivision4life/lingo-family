import type { TapeEvent } from "./mixedTape";

/**
 * One line of the mixed tape's own account of itself (M6.5).
 *
 * Kept in the product, not only in the spike that proved the tape works: the one branch no test
 * and no amount of local trying can cover is a real phone on a real network having to wait for the
 * next clip. If that ever goes wrong during a sitting, this log is the only evidence there will be
 * — and the person it has to be readable by is holding the phone, with no developer tools.
 */
export function describeTapeEvent(e: TapeEvent): string {
  switch (e.kind) {
    case "unlocked":
      return e.blocked === 0 ? "GỠ KHOÁ: cả 2 thẻ audio OK" : `GỠ KHOÁ: ${e.blocked}/2 thẻ BỊ CHẶN`;
    case "preloading":
      return `nạp trước đoạn ${e.index + 1} (${e.src})`;
    case "ready":
      return `đoạn ${e.index + 1} sẵn sàng`;
    case "playing":
      return `PHÁT đoạn ${e.index + 1} (${e.src})`;
    case "waiting":
      return `CHỜ đoạn ${e.index + 1} nạp xong (im lặng, không nhảy cóc)`;
    case "switched":
      return `chuyển ${e.from + 1} → ${e.to + 1}${e.waitedMs > 0 ? `, đã chờ ${e.waitedMs}ms` : ", không phải chờ"}`;
    case "finished":
      return "HẾT BĂNG";
    case "skipped":
      return `BỎ QUA đoạn ${e.index + 1} (${e.reason})`;
    case "error":
      return `LỖI: ${e.message}`;
  }
}

/** Timestamped, so a gap in the tape can be lined up with what the phone was doing. */
export const tapeLogLine = (e: TapeEvent, at: Date) => `${at.toISOString().slice(14, 23)}  ${describeTapeEvent(e)}`;
