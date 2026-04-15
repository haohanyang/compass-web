import { EventEmitter } from 'events';

export class WorkerRuntime {
  constructor(uri, driverOptions, cliOptions, workerOptions, eventEmitter) {
    console.log(
      'New WorkerRuntime created',
      uri,
      driverOptions,
      cliOptions,
      workerOptions
    );

    this.workerConfigs = {
      uri,
      driverOptions: { ...driverOptions, parentHandle: null },
      cliOptions,
      workerOptions,
    };

    this.eventEmitter = eventEmitter;
  }

  /**
   *
   * @param {string} code
   * @returns {Promise<import('@mongosh/browser-runtime-core').RuntimeEvaluationResult>}
   */
  async evaluate(code) {
    const res = await fetch('/api/shell/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        ...this.workerConfigs,
        code,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      // Re-instantiate error
      const { error: errorValue } = await res.json();

      const error = new Error();
      error.name = errorValue.name;
      error.message = errorValue.message;
      error.stack = ' ';

      if (errorValue.code) {
        error.code = errorValue.code;
      }

      throw error;
    }
    return await res.json();
  }

  /**
   *
   * @param {string} code
   * @returns {Promise<import('@mongosh/browser-runtime-core').Completion[]>}
   */
  async getCompletions(code) {
    const res = await fetch('/api/shell/completions', {
      method: 'POST',
      body: JSON.stringify({
        ...this.workerConfigs,
        code,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return await res.json();
  }

  async getShellPrompt() {
    const res = await fetch('/api/shell/shellPrompt', {
      method: 'POST',
      body: JSON.stringify(this.workerConfigs),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return (await res.json()).prompt;
  }

  setEvaluationListener(_listener) {
    console.warn('setEvaluationListener not implemented');
  }

  async terminate() {
    await fetch('/api/shell/terminate', {
      method: 'POST',
      body: JSON.stringify(this.workerConfigs),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async interrupt() {
    const res = await fetch('/api/shell/interrupt', {
      method: 'POST',
      body: JSON.stringify(this.workerConfigs),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return (await res.json()).result;
  }

  async waitForRuntimeToBeReady() {
    await fetch('/api/shell/init', {
      method: 'POST',
      body: JSON.stringify(this.workerConfigs),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}

/**
 * @param {import('../../../compass/packages/compass-connections/src/provider').DataService} dataService
 * @param {import('../../../compass/packages/compass-logging/provider').MongoLogWriter} log
 * @param {import('../../../compass/packages/compass-telemetry/provider').TrackFunction} track
 * @param {import('../../../compass/packages/compass-connections/provider').ConnectionInfoRef} connectionInfo
 * @returns {import('@mongosh/node-runtime-worker-thread').WorkerRuntime}
 */
export function createWorkerRuntime(dataService, log, track, connectionInfo) {
  const emitter = new EventEmitter();

  // We also don't need to pass a proper user id, since that is
  // handled by the Compass tracking code.
  emitter.emit('mongosh:new-user', '<compass user>');

  const {
    url: driverUrl,
    options: driverOptions,
    // Not really provided by dataService, used only for testing purposes
    cliOptions,
  } = {
    cliOptions: {},
    url: '',
    ...dataService.getMongoClientConnectionOptions(),
  };

  const runtime = new WorkerRuntime(
    driverUrl,
    driverOptions,
    cliOptions ?? {},
    {
      name: 'Compass Shell Worker',
    },
    emitter
  );

  return runtime;
}
