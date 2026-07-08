import type { Command } from "./Command.js";
import type { CommandDispatcher } from "./CommandDispatcher.js";
import type { MainToWorkerMessage } from "./WorkerProtocol.js";

export class WorkerCommandDispatcher implements CommandDispatcher {
  private worker: Worker;

  constructor(worker: Worker) {
    this.worker = worker;
  }

  dispatch(command: Command): void {
    const msg: MainToWorkerMessage = { type: "command", command };
    this.worker.postMessage(msg);
  }
}
