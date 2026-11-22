/** How a wait for Enter on stdin ended. `stopped`: the caller's signal fired (Ctrl-C). */
export type EnterWait = "enter" | "eof" | "stopped";

/**
 * Wait for one line on stdin, TTY or not. Anything typed after the first newline stays
 * unread for the next wait, so a piped "\n\n" answers two handoffs.
 */
export function untilEnter(signal?: AbortSignal): Promise<EnterWait> {
  const stdin = process.stdin;
  if (stdin.readableEnded) return Promise.resolve("eof");
  if (signal?.aborted) return Promise.resolve("stopped");
  return new Promise((resolve) => {
    const finish = (how: EnterWait) => {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      signal?.removeEventListener("abort", onAbort);
      stdin.pause();
      resolve(how);
    };
    const onData = (chunk: Buffer) => {
      const at = chunk.indexOf(0x0a);
      if (at === -1) return;
      finish("enter");
      // After finish: unshifting into a flowing stream hands the rest straight back here.
      if (at + 1 < chunk.length) stdin.unshift(chunk.subarray(at + 1));
    };
    const onEnd = () => finish("eof");
    const onAbort = () => finish("stopped");
    stdin.on("data", onData);
    stdin.once("end", onEnd);
    signal?.addEventListener("abort", onAbort, { once: true });
    stdin.resume();
  });
}
