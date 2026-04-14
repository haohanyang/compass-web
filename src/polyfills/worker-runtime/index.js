import { EventEmitter } from 'events';

export class WorkerRuntime {
  constructor(uri, driverOptions, cliOptions, workerOptions, eventEmitter) {
    console.log(uri, driverOptions, cliOptions, workerOptions);
  }

  /**
   *
   * @param {string} code
   * @returns {Promise<import('@mongosh/browser-runtime-core').RuntimeEvaluationResult>}
   */
  async evaluate(code) {
    console.log('eval ' + code);
    return {
      printable: false,
    };
  }

  /**
   *
   * @param {string} code
   * @returns {Promise<import('@mongosh/browser-runtime-core').Completion[]>}
   */
  async getCompletions(code) {
    return [];
  }

  async getShellPrompt() {
    return '';
  }

  setEvaluationListener(listener) {
    return null;
  }

  async terminate() {
    return Promise.resolve();
  }

  async interrupt() {
    return true;
  }

  async waitForRuntimeToBeReady() {
    return;
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
