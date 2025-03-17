import { clientId } from '../gdrive'
import { createTool } from '../taskyon/tools'

const googleDriveTool = createTool({
  description: 'A tool that saves/loads files from Google Drive using OAuth2 within the iframe',
  longDescription: 'Handles complete OAuth2 flow within iframe using popup window',
  name: 'googleDriveTool',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: ['action', 'clientId'],
    properties: {
      action: {
        type: 'string',
        enum: ['save', 'load'],
        description: 'Whether to save or load a file',
      },
      fileName: {
        type: 'string',
        description: 'Name of the file to save',
      },
      content: {
        type: 'string',
        description: 'File content for saving',
      },
      fileId: {
        type: 'string',
        description: 'Google Drive file ID for loading',
      },
    },
  },
  code: `async ({ action, fileName, content, fileId, clientId }) => {
    const createPopup = () => {
      const width = 600;
      const height = 600;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 4;

      return window.open('', 'oauthPopup',
        \`width=\${width},height=\${height},left=\${left},top=\${top}\`);
    };

    const authWithPopup = () => new Promise((resolve, reject) => {
      const popup = createPopup();
      if (!popup) return reject('Popup blocked - please allow popups');

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', '${clientId}');
      authUrl.searchParams.set('redirect_uri', 'urn:ietf:wg:oauth:2.0:oob');
      authUrl.searchParams.set('response_type', 'token');
      authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
      authUrl.searchParams.set('state', 'drive-auth');

      popup.location = authUrl.href;

      const messageHandler = (event) => {
        if (event.origin !== "https://accounts.google.com") return;
        if (!event.data.includes('access_token')) return;

        const params = new URLSearchParams(event.data);
        const accessToken = params.get('access_token');
        const error = params.get('error');

        window.removeEventListener('message', messageHandler);
        popup.close();

        if (error) reject(error);
        else resolve(accessToken);
      };

      window.addEventListener('message', messageHandler);
    });

    const driveRequest = async (accessToken) => {
      if (action === 'save') {
        const metadata = {
          name: fileName,
          mimeType: 'text/plain'
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], {type: 'application/json'}));
        form.append('file', new Blob([content], {type: 'text/plain'}));

        const response = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          {
            method: 'POST',
            headers: { 'Authorization': \`Bearer \${accessToken}\` },
            body: form
          }
        );
        return await response.json();
      }

      if (action === 'load') {
        const response = await fetch(
          \`https://www.googleapis.com/drive/v3/files/\${fileId}?alt=media\`,
          { headers: { 'Authorization': \`Bearer \${accessToken}\` } }
        );
        return { content: await response.text() };
      }
    };

    try {
      const accessToken = await authWithPopup();
      return await driveRequest(accessToken);
    } catch (error) {
      throw new Error(\`Google Drive error: \${error.message || error}\`);
    }
  }`,
})

export const storageTools = [googleDriveTool]
