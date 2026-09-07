import { executeInWorkerSandbox } from './workerSandbox'
import { loadSandboxArtifactBytes } from './sandboxAssets'
import { jinjaArtifact } from './jinjaArtifact'

export const jinjaSandboxSource = `(function(librarySource, source, values, profile) {
  const module = { exports: {} };
  new Function('module', 'exports', librarySource)(module, module.exports);
  const { Template, Environment, Interpreter } = module.exports;
  const template = new Template(source);
  if (profile === 'task') return template.render(values);
  const env = new Environment();
  for (const [key, value] of Object.entries(values)) env.set(key, value);
  for (const [key, value] of Object.entries({true: true, false: false, none: null, True: true, False: false, None: null})) env.set(key, value);
  env.set('range', (start, end, step = 1) => {
    if (end === undefined) { end = start; start = 0; }
    const count = Math.max(0, Math.ceil((end - start) / step));
    if (![start, end, step, count].every(Number.isSafeInteger) || !step || count > 1000) throw new Error('Document range is limited to 1000 items.');
    return Array.from({length: count}, (_, index) => start + index * step);
  });
  const interpreter = new Interpreter(env);
  const evaluate = interpreter.evaluate.bind(interpreter);
  let steps = 0;
  interpreter.evaluate = (statement, environment) => {
    if (++steps > 20000) throw new Error('Document template exceeds its evaluation budget.');
    if (statement?.type === 'BinaryExpression' && statement.operator?.value === '*') throw new Error('Document template multiplication is unavailable; use a DAG node.');
    const result = evaluate(statement, environment);
    if (result.type === 'UndefinedValue') throw new Error('Document template references an undefined value.');
    if (typeof result.value === 'string' && result.value.length > 8000000) throw new Error('Document template output exceeds 8 MB.');
    return result;
  };
  const result = interpreter.run(template.parsed);
  if (typeof result.value !== 'string') throw new Error('Jinja did not return text.');
  return result.value;
})`

/** Each owner retains only the verified library; each render has a disposable sandbox. */
export const createJinjaTemplateRenderer = () => {
  let library: Promise<string> | undefined
  return async (
    template: string,
    values: Record<string, unknown>,
    options: { profile: 'task' | 'document'; signal?: AbortSignal },
  ) => {
    const maxInput = options.profile === 'task' ? 2 * 1024 * 1024 : 8_000_000
    if (new TextEncoder().encode(JSON.stringify({ template, values })).byteLength > maxInput)
      throw new Error('Jinja input exceeds the configured limit.')
    library ??= loadSandboxArtifactBytes(jinjaArtifact, 'index.cjs')
      .then((bytes) => new TextDecoder().decode(bytes))
      .catch((error: unknown) => {
        library = undefined
        throw error
      })
    return await executeInWorkerSandbox<string>(
      {
        id: 'jinja-template',
        code: jinjaSandboxSource,
        browserRuntime: options.profile === 'task' ? 'iframe' : 'worker',
        reuse: { mode: 'disposable' },
        maxExecutionMs: 2000,
        maxOldSpaceSizeMb: options.profile === 'task' ? 64 : 128,
        maxOutputBytes: options.profile === 'task' ? 1024 * 1024 : 8_000_000,
        stopSignal: options.signal ?? new AbortController().signal,
      },
      await library,
      template,
      values,
      options.profile,
    )
  }
}
