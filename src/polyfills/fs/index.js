export function rmSync() {
  throw new Error('Not supported in browser');
}

export function readFileSync() {
  throw new Error('Not supported in browser');
}

export function stat() {
  throw new Error('Not supported in browser');
}

export function exists() {
  throw new Error('Not supported in browser');
}

export const promises = {
  chmod() {
    return Promise.resolve();
  },

  access() {
    return Promise.reject(new Error('Not supported in browser environment'));
  },

  readFile() {
    return Promise.reject(new Error('Not supported in browser environment'));
  },
};

export default { promises, rmSync, readFileSync, stat, exists };
