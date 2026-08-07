import { executableSandboxRuntimeSource } from './executableSandboxRuntime.js'

export const denoWorkerSandboxRunnerSource = `
const encoder = new TextEncoder();
let sendQueue = Promise.resolve();

const send = (message) => {
  const bytes = encoder.encode(JSON.stringify(message) + '\\n');
  sendQueue = sendQueue.then(async () => await Deno.stdout.write(bytes));
};

const runtimeUrl = 'data:application/javascript,' + encodeURIComponent(
  ${JSON.stringify(executableSandboxRuntimeSource)}
);
const worker = new Worker(runtimeUrl, {
  type: 'module',
  deno: { namespace: false, permissions: 'none' },
});
const channel = new MessageChannel();
channel.port1.onmessage = (event) => send(event.data);
channel.port1.start();
worker.onerror = (event) => {
  send({
    kind: 'runtime-error',
    error: { message: event.message || 'Deno sandbox worker failed', name: 'Error', stack: '' },
  });
  event.preventDefault();
};
worker.postMessage({ kind: 'connect' }, [channel.port2]);

let inputBuffer = '';
for await (const chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())) {
  inputBuffer += chunk;
  for (;;) {
    const newline = inputBuffer.indexOf('\\n');
    if (newline < 0) break;
    const line = inputBuffer.slice(0, newline);
    inputBuffer = inputBuffer.slice(newline + 1);
    if (line.trim()) channel.port1.postMessage(JSON.parse(line));
  }
}
worker.terminate();
`
