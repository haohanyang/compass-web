import { EventEmitter } from 'events';
import { WorkerRuntime } from '@mongosh/node-runtime-worker-thread';

export class WorkerRuntime {
  constructor(uri, driverOptions, cliOptions, workerOptions, eventEmitter) {}

  /**
   *
   * @param {string} code
   * @returns {Promise<import('@mongosh/browser-runtime-core').RuntimeEvaluationResult>}
   */
  evaluate(code) {
    console.log('eval ' + code);
    return Promise.resolve({
      printable: false,
    });
  }

  /**
   *
   * @param {string} code
   * @returns {Promise<import('@mongosh/browser-runtime-core').Completion[]>}
   */
  getCompletions(code) {
    console.log('getCompletions ' + code);
    return Promise.resolve([]);
  }

  getShellPrompt() {
    console.log('getShellPrompt');
    return Promise.resolve('');
  }
  setEvaluationListener(listener) {
    console.log('setEvaluationListener');
    return null;
  }
  terminate() {
    console.log('terminate');
    return Promise.resolve();
  }
  interrupt() {
    console.log('interrupt');
    return Promise.resolve(true);
  }
  waitForRuntimeToBeReady() {
    console.log('waitForRuntimeToBeReady');
    return Promise.resolve();
  }
}

/**
 *
 * @param {import('@mongodb-js/compass-connections/provider').DataService} dataService
 * @param {import('@mongodb-js/compass-logging/provider').MongoLogWriter} log
 * @param {import('@mongodb-js/compass-telemetry/provider').TrackFunction} track
 * @param {import('@mongodb-js/compass-connections/provider').ConnectionInfoRef} connectionInfo
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
