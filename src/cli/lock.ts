import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { ensureRunDir, RUN_DIR } from "../core/run";

const holder = (file: string) => {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * `.busbar/lock`, created exclusively and holding this process's pid, so two bb commands
 * never read and write one project's state at once. A lock whose process is gone is taken
 * over. Released on every exit, Ctrl-C included.
 */
export function lockProject(projectDir: string) {
  const file = join(ensureRunDir(projectDir), "lock");
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(file, "wx", 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = holder(file);
      const gone = pid === null ? !existsSync(file) : !alive(pid);
      if (gone && attempt === 0) {
        if (pid !== null) rmSync(file, { force: true });
        continue;
      }
      throw new Error(
        pid === null
          ? `${RUN_DIR}/lock is there but names no process. If no bb command is running in this project, delete it.`
          : `another bb command is running in this project (pid ${pid}). Let it finish or stop it, then run this again.`,
      );
    }
  }
  process.on("exit", () => {
    if (holder(file) === process.pid) rmSync(file, { force: true });
  });
  // A handoff wait or Puppeteer may have its own Ctrl-C handler; only exit when none does.
  process.on("SIGINT", () => {
    if (process.listenerCount("SIGINT") === 1) process.exit(130);
  });
}
