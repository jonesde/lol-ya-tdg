import type { ConfirmPayload, HostBindings, PersistStateSlice, SoundName, UiEvent } from "./HostBindings.js";
import type { WorkerToMainMessage } from "./WorkerProtocol.js";

// Inside the worker, `self` is the global DedicatedWorkerGlobalScope.
// We declare a minimal worker-scope shape to avoid pulling in the WebWorker
// lib (which conflicts with the DOM lib used for the main thread).
interface WorkerGlobalScope {
  postMessage(message: WorkerToMainMessage): void;
}
declare const self: WorkerGlobalScope;

// The engine's view of the outside world, living inside the worker. It
// reaches back to the main thread by posting messages through `self.postMessage`
// for sound/UI/persist, and resolves confirm requests when the main thread
// posts a `confirmResult` back.
export class WorkerHostBindings implements HostBindings {
  private confirmRequestCounter = 0;
  private pendingConfirms = new Map<number, (confirmed: boolean) => void>();

  playSound(name: SoundName): void {
    self.postMessage({ type: "playSound", name });
  }

  notifyUi(event: UiEvent): void {
    self.postMessage({ type: "notifyUi", event });
  }

  schedulePersistSave(state: PersistStateSlice): void {
    self.postMessage({ type: "schedulePersistSave", state });
  }

  syncGridTower(x: number, y: number, placed: boolean): void {
    self.postMessage({ type: "gridTowerSync", x, y, placed });
  }

  async requestConfirm(payload: ConfirmPayload): Promise<boolean> {
    const requestId = ++this.confirmRequestCounter;
    return new Promise<boolean>((resolve) => {
      this.pendingConfirms.set(requestId, resolve);
      self.postMessage({ type: "requestConfirm", payload, requestId });
    });
  }

  // Called by the worker's message handler when a confirmResult arrives.
  resolveConfirm(requestId: number, confirmed: boolean): void {
    const resolve = this.pendingConfirms.get(requestId);
    if (resolve) {
      this.pendingConfirms.delete(requestId);
      resolve(confirmed);
    }
  }
}
