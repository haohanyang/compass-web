const { WorkerRuntime } = require('@mongosh/node-runtime-worker-thread');

export class WorkerRuntimeManager {
  constructor() {
    /** @type {Record<string, WorkerRuntime>} */
    this.workerRuntimes = {};
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

    // Terminate after 10s
    // setTimeout(() => this.terminateWorkerRuntime(id), 10000)

    return workerRuntime;
  }

  async terminateWorkerRuntime(id) {
    if (this.workerRuntimes[id]) {
      await this.workerRuntimes[id].terminate();
      delete this.workerRuntimes[id];
    }
  }

  close() {
    return Promise.all(
      Object.values(this.workerRuntimes).map((rt) => rt.terminate())
    );
  }
}
