const { WorkerRuntime } = require('@mongosh/node-runtime-worker-thread');

export class WorkerRuntimeManager {
  constructor(args) {
    this.enabled = args.enableShell;

    /** @type {Record<string, WorkerRuntime>} */
    this.workerRuntimes = {};

    /** @type {Record<string, import('ws').WebSocket>} */
    this.sockets = {};
  }

  getWorkerRuntime(id) {
    return this.workerRuntimes[id];
  }

  async createWorkerRuntime({
    id,
    uri,
    driverOptions,
    cliOptions,
    workerOptions,
    emitter,
  }) {
    if (!this.enabled) {
      throw new Error('Mongo Shell is not enabled');
    }

    if (this.workerRuntimes[id]) {
      await this.workerRuntimes[id].terminate();
    }

    const workerRuntime = new WorkerRuntime(
      uri,
      driverOptions,
      cliOptions,
      {
        ...workerOptions,
        type: 'module',
      },
      emitter
    );

    await workerRuntime.waitForRuntimeToBeReady();

    this.workerRuntimes[id] = workerRuntime;

    return workerRuntime;
  }

  createWorkerRuntimeSocket(id, socket) {
    this.sockets[id] = socket;
  }

  async terminateWorkerRuntime(id) {
    if (this.workerRuntimes[id]) {
      await this.workerRuntimes[id].terminate();
      delete this.workerRuntimes[id];
    }

    if (this.sockets[id]) {
      this.sockets[id].terminate();
      delete this.sockets[id];
    }
  }

  close() {
    return Promise.all(
      Object.values(this.workerRuntimes).map((rt) => rt.terminate())
    );
  }
}
