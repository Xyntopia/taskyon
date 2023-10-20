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

    const result = pyodide.runPython(python_script);
    console.log(result);
    return { result };
  } catch (error) {
    console.error('Loading Pyodide failed', error);
    return { error };
  }
}

export async function main() {
  try {
    await loadScript(
      'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js'
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const pyodide = await window.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
    });

    const result = pyodide.runPython('1+1');
    console.log(result);
  } catch (error) {
    console.error('Loading Pyodide failed', error);
  }
}

// you can download the releases from here:
// url: https://github.com/pyodide/pyodide/releases
// this gives us the chnce to package packages our own way :)

// otherwise, its also possible to use this URL:
//

// export async function main() {
//   const pyodideModule= (await import(
//     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//   // @ts-ignore
//     /* webpackIgnore: true */
//     //'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js'));
//   /*const pyodide = await loadPyodide({
//     indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
//   });*/

//   // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//   // @ts-ignore
//   // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
//   const pyodide = await pyodideModule.loadPyodide();

//   // await pyodide.loadPackage()
//   // Pyodide is now ready to use...
//   /*const result = pyodide.runPython(`
//     #import sys
//     #sys.version
//     1+1
//     `) as string;
//   console.log(result);*/
// }
