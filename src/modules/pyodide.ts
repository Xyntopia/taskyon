/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
//import { loadPyodide, PyodideInterface } from 'pyodide';

function loadScript(src: string): Promise<void> {
  // Specify 'void' if the promise doesn't return a value
  return new Promise<void>((resolve, reject) => {
    // Again, specify 'void' here
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve(); // No arguments are needed for 'resolve' since no value is returned
    script.onerror = () => reject(new Error(`Script load error for ${src}`));
    document.head.appendChild(script);
  });
}

export interface PythonResult {
  result?: string;
  error?: unknown;
  stdout?: string;
}

export async function execute(python_script: string): Promise<PythonResult> {
  try {
    await loadScript(
      'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js'
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const pyodide = await window.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
    });

    let stdout_content = '';

    const stdoutHandler = {
      batched: (str: string) => {
        stdout_content += str + '\n';
      },
    };

    pyodide.setStdout(stdoutHandler);

    await pyodide.loadPackagesFromImports(python_script);

    const result = await pyodide.runPython(python_script);

    // Reset stdout handler to default behavior if necessary
    pyodide.setStdout({ batched: (str: string) => console.log(str) });

    return { result, stdout: stdout_content };
  } catch (error) {
    console.error('Loading Pyodide failed', error);
    return { error };
  }
}


// you can download the releases from here:
// url: https://github.com/pyodide/pyodide/releases
// this gives us the chnce to package packages our own way :)
