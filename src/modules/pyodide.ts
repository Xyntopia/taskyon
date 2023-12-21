//import { loadPyodide, PyodideInterface } from 'pyodide';
import type { PyodideInterface } from 'pyodide';

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
  await loadScript('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js');
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const pyodide: PyodideInterface = await window.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
  });

  return await executeScript(pyodide, python_script);
}

export async function executeScript(
  pyodide: PyodideInterface,
  python_script: string
) {
  try {
    let stdout_content = '';

    const stdoutHandler = {
      batched: (str: string) => {
        stdout_content += str + '\n';
      },
    };

    pyodide.setStdout(stdoutHandler);

    await pyodide.loadPackagesFromImports(python_script);

    // result is the direct result of the execution of the python script
    // if it is a python object, it would be a Pyodide object
    // otherwise is corresponds to one of these types here:
    //  https://pyodide.org/en/stable/usage/type-conversions.htmls
    let result: unknown = await pyodide.runPythonAsync(python_script);

    result = convertRes2Js(result);

    // Reset stdout handler to default behavior if necessary
    pyodide.setStdout({ batched: (str: string) => console.log(str) });

    return { result, stdout: stdout_content };
  } catch (error) {
    console.error('Loading Pyodide failed', error);
    return { error };
  }
}

function convertRes2Js(result: unknown) {
  let convres;
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
        convres = (result as { toJs: () => unknown }).toJs();
      } catch (error) {
        console.error('Error converting Python object to JavaScript', error);
      }
    } else if ('toString' in result) {
      // Fallback to using toString() for other types of objects
      try {
        convres = result.toString();
      } catch (error) {
        console.error('Error converting Python object to string', error);
      }
    }
  }
  return convres;
}

// you can download the releases from here:
// url: https://github.com/pyodide/pyodide/releases
// this gives us the chnce to package packages our own way :)
