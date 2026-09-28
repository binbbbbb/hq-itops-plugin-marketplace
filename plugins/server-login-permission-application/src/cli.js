import fs from "node:fs";
import { safeErrorJson, WorkflowError } from "./errors.js";

async function readInput(stdin = process.stdin) {
  if (stdin.isTTY) return {};
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new WorkflowError("CONFIG_INVALID", undefined, error);
  }
}

export async function run() {
  throw new WorkflowError("CONFIG_INVALID", { reason: "UAT_HTTP_ONLY" });
}

export async function main(argv, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  try {
    const data = await run(argv[0], await readInput(io.stdin));
    io.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  } catch (error) {
    io.stderr.write(`${JSON.stringify(safeErrorJson(error))}\n`);
    process.exitCode = 1;
  }
}
