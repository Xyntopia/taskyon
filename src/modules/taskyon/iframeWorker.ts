// Create and initialize iframe
function createSandboxedIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none'; // Hide the iframe
  iframe.sandbox.add('allow-scripts'); // Restrict permissions to only allow scripts
  document.body.appendChild(iframe);

  // Set iframe content to include a message handler for receiving code
  const iframeContent = `
    <script>
      window.addEventListener('message', async (event) => {
        try {
          const { code } = event.data;
          // Safely evaluate the code using the Function constructor
          const result = await new Function('return ' + code)();
          // Post the result back to the parent window
          window.parent.postMessage({ result }, '*');
        } catch (error) {
          window.parent.postMessage({ error: error.message }, '*');
        }
      });
    </script>
  `;

  // Write the sandboxed script into the iframe
  iframe.srcdoc = iframeContent;
  return iframe;
}

// Singleton iframe instance
let iframe: HTMLIFrameElement | null = null;

// Function to execute code in the iframe
export function executeCodeInIframe(code: string): Promise<unknown> {
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

    // Send the code to the iframe for execution
    iframe!.contentWindow?.postMessage({ code }, '*');
  });
}
