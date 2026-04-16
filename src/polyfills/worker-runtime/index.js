import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';

export class WorkerRuntime {
  constructor(uri, driverOptions, cliOptions, workerOptions, eventEmitter) {
    this.id = randomBytes(8).toString('hex');

    this.configs = {
      id: this.id,
      uri,
      driverOptions: { ...driverOptions, parentHandle: null },
      cliOptions,
      workerOptions,
    };

    this.eventEmitter = eventEmitter;

    this.connect();
  }

  /**
   * @param {string} code
   * @returns {Promise<import('@mongosh/browser-runtime-core').RuntimeEvaluationResult>}
   */
  async evaluate(code) {
    await this._ready;
    return await this._send('evaluate', { code });
  }

  /**
   * @param {string} code
   * @returns {Promise<import('@mongosh/browser-runtime-core').Completion[]>}
   */
  async getCompletions(code) {
    await this._ready;
    return await this._send('completions', { code });
  }

  async getShellPrompt() {
    await this._ready;
    const result = await this._send('shellPrompt', {});
    return result?.prompt;
  }

  setEvaluationListener(_listener) {}

  async terminate() {
    this.ws?.close();
  }

  async interrupt() {
    await this._ready;
    const result = await this._send('interrupt', {});
    return result?.result;
  }

  async waitForRuntimeToBeReady() {
    await this._ready;
  }

  /**
   * @param {string} type
   * @param {object} payload
   * @returns {Promise<any>}
   */
  _send(type, payload) {
    return new Promise((resolve, reject) => {
      const id = `req-${++this._counter}`;
      this._inflight.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, type, payload }));
    });
  }

  connect() {
    this._inflight = new Map();
    this._counter = 0;
    this.ws = new WebSocket('/shell');

    let resolveReady, rejectReady;
    this._ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    this.ws.onopen = () => {
      console.log(`Shell session ${this.id} opened`);
      this._send('init', this.configs).then(resolveReady).catch(rejectReady);
    };

    this.ws.onmessage = (event) => {
      const { id, ok, payload, error } = JSON.parse(event.data);
      const pending = this._inflight.get(id);
      if (!pending) return;
      this._inflight.delete(id);
      if (ok) {
        pending.resolve(payload);
      } else {
        const err = new Error(error.message);
        err.name = error.name;
        if (error.code) err.code = error.code;
        pending.reject(err);
      }
    };

    this.ws.onclose = () => {
      console.log(`Shell session ${this.id} closed`);
      rejectReady?.(new Error('Connection closed'));
      for (const { reject } of this._inflight.values()) {
        reject(new Error('Connection closed'));
      }
      this._inflight.clear();
    };

    this.ws.onerror = (err) => {
      console.error('Shell socket error', err);
      rejectReady?.(err);
    };
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
