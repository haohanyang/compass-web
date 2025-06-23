import { promises } from 'readable-stream';

export function pipeline(...args) {
  return promises.pipeline(args);
}
