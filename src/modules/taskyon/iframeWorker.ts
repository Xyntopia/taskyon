import { sleep } from '../utils';
import type { OnInterruptFunc } from './types';

// Create and initialize iframe
function createSandboxedIframe(): Promise<HTMLIFrameElement> {
  console.log('create taskyon iframe worker');
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none'; // Hide the iframe
  iframe.sandbox.add('allow-scripts'); // Restrict permissions to only allow scripts
  document.body.appendChild(iframe);

  // Set iframe content to include a message handler for receiving code and params
  const iframeContent = `
<script>
window.addEventListener('message', async (event) => {
    const { code, params, sourceURL } = event.data;
    if (code) {
      try {
        const func = new Function("params", "return (" + code + ")(params)\\n//# sourceURL=" + sourceURL);
        const result = await func(params);
        
        // Post the result back to the parent window
        window.parent.postMessage({ result }, '*');
      } catch (error) {
        window.parent.postMessage({ error: error.message }, '*');
      }
    }
});
// Notify parent that the iframe is ready
window.parent.postMessage({ ready: true }, '*');
//# sourceURL=iframeWorker.js
<\/script>
`;

  // Write the sandboxed script into the iframe
  iframe.srcdoc = iframeContent;

  // Return a promise that resolves when the iframe has notified that it is ready
  return new Promise((resolve) => {
    function handleReady(event: MessageEvent) {
      if (event.data.ready && event.source === iframe.contentWindow) {
        // Remove the listener now that the iframe is ready
        window.removeEventListener('message', handleReady);
        resolve(iframe);
      }
    }
    window.addEventListener('message', handleReady);
  });
}

// Singleton iframe instance and an interrupt flag
let iframe: HTMLIFrameElement | null = null;
let interrupted = false;

function dereferenceReactive(reactiveObject: unknown) {
  return JSON.parse(JSON.stringify(reactiveObject));
}

// Function to interrupt the execution
function interruptExecution(handleMessage: (event: MessageEvent) => void) {
  if (iframe) {
    interrupted = true;

    // Remove the function return listener if it exists
    window.removeEventListener('message', handleMessage);

    // Remove the iframe to terminate the script execution
    document.body.removeChild(iframe);
    iframe = null;
  }
}

// Function to execute code in the iframe with parameters
export async function executeCodeInIframe(
  code: string,
  params: Record<string, unknown>,
  sourceURL: string = 'sandboxed-code.js', // Default source URL for debugging
  onInterrupt: OnInterruptFunc,
) {
  // Lazy initialize iframe
  if (!iframe || interrupted) {
    iframe = await createSandboxedIframe();
    interrupted = false;
    // Add a delay to ensure iframe is fully ready. Its ok, because we normally do this only once here...
    await sleep(100);
  }

  return new Promise((resolve, reject) => {
    function handleMessage(event: MessageEvent) {
      // Ensure the message is coming from the correct iframe
      if (event.source === iframe?.contentWindow) {
        window.removeEventListener('message', handleMessage);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.result);
        }
      }
    }

    // Listen for messages from the iframe
    window.addEventListener('message', handleMessage);

    // Send the code, parameters, and source URL to the iframe for execution
    const sendobj = dereferenceReactive({ code, params, sourceURL });
    iframe!.contentWindow?.postMessage(sendobj, '*');

    // Register the interrupt callback
    onInterrupt((reason) => {
      interruptExecution(handleMessage); // Interrupt the execution
      reject(new Error(reason || 'Execution interrupted'));
    });
  });
}
