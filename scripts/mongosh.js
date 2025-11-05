const { EventEmitter } = require('events');
const { WorkerRuntime } = require('@mongosh/node-runtime-worker-thread');
const readline = require('readline');

global.Worker = require('web-worker');

process.loadEnvFile();

const emitter = new EventEmitter();

const runtime = new WorkerRuntime(
  process.env.MONGO_URI,
  {},
  {},
  {
    type: 'module',
  },
  emitter
);

console.log('Welcome to the Mini Mongosh!');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

rl.prompt();

rl.on('line', (input) => {
  if (input.trim()) {
    runtime
      .evaluate(input)
      .then((result) => {
        console.log(result.printable ?? '');
      })
      .catch((err) => {
        console.error('Error:', err.message);
      })
      .finally(() => {
        rl.prompt();
      });
  } else {
    rl.prompt();
  }
}).on('close', () => {
  console.log('Goodbye!');
  runtime.terminate().finally(() => {
    process.exit(0);
  });
});
