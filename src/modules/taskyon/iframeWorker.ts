// Create and initialize iframe
function createSandboxedIframe(): HTMLIFrameElement {
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
    try {
    const func = new Function("params", "return (" + code + ")(params)\\n//# sourceURL=" + sourceURL);
    const result = await func(params);
    
    // Post the result back to the parent window
    window.parent.postMessage({ result }, '*');
    } catch (error) {
    window.parent.postMessage({ error: error.message }, '*');
    }
});
//# sourceURL=iframeWorker.js
<\/script>
`;

  // Write the sandboxed script into the iframe
  iframe.srcdoc = iframeContent;
  return iframe;
}

// Singleton iframe instance
let iframe: HTMLIFrameElement | null = null;

function dereferenceReactive(reactiveObject: unknown) {
  return JSON.parse(JSON.stringify(reactiveObject));
}

// Function to execute code in the iframe with parameters
export function executeCodeInIframe(
  code: string,
  params: Record<string, unknown>,
  sourceURL: string = 'sandboxed-code.js', // Default source URL for debugging
): Promise<unknown> {
  // Lazy initialize iframe
  if (!iframe) {
    iframe = createSandboxedIframe();
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
  });
}
