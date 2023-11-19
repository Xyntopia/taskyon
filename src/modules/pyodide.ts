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

export async function execute(python_script: string) {
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

    let result = await pyodide.runPython(python_script);

    // Check if result is a Pyodide proxy object
    if (result && typeof result === 'object') {
      // Check if the object is a list, array, map (dictionary), or set
      if (
        'length' in result ||
        result.constructor.name === 'PyProxyMap' ||
        result.constructor.name === 'PyProxySet'
      ) {
        // Try to convert the Python object to a JavaScript object
        try {
          result = result.toJs();
        } catch (error) {
          console.error('Error converting Python object to JavaScript', error);
        }
      } else if ('toString' in result) {
        // Fallback to using toString() for other types of objects
        try {
          result = result.toString();
        } catch (error) {
          console.error('Error converting Python object to string', error);
        }
      }
    }

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
