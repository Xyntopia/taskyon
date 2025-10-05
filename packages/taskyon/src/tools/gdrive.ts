import type { JSONSchema7 } from 'json-schema'
import { createTool, makeTaskResult } from '@taskyon/taskyon'
import { useGdrive } from 'src/modules/gdrive' // Import the gdrive module
import { OAUTH_PROVIDERS, usePersistentOauth } from '../../../../src/modules/oauth'

/*const googleDriveTool = createTool({
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
})*/

/**
 * Tool that provides Google Drive integration capabilities for saving, loading,
 * and publishing files to Google Drive.
 */
export const gDriveTool = createTool({
  name: 'gDriveBrowser',
  description: 'Interact with Google Drive to save, load, and publish files',
  longDescription: `This tool provides seamless integration with Google Drive, allowing you to:
- Save JSON objects to Google Drive as JSON files
- Save any file (blob) to Google Drive
- Load files from Google Drive
- Load and parse JSON objects from Google Drive
- Publish markdown files to Google Drive with optional sharing

The tool handles authentication automatically and maintains token validity.
Files can be organized in directories and optionally made public with sharable links.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['saveObject', 'saveFile', 'loadObject', 'loadFile', 'publishMarkdown'],
        description: 'The action to perform on Google Drive',
      },
      directory: {
        type: 'string',
        description:
          'The directory/folder path in Google Drive where the file should be saved or loaded from',
      },
      filename: {
        type: 'string',
        description: 'The name of the file to save or load',
      },
      content: {
        type: 'string',
        description:
          'Content to save (JSON string for objects, file data as base64 for files, markdown text for publishMarkdown)',
      },
      mimeType: {
        type: 'string',
        description: 'The MIME type of the file (required for saveFile action)',
        default: 'application/json',
      },
      share: {
        type: 'boolean',
        description: 'Whether to make the file publicly accessible with a sharable link',
        default: false,
      },
    },
    required: ['action', 'directory', 'filename'],
  } as const satisfies JSONSchema7,
  function: async (
    { action, directory, filename, content, mimeType, share },
    { getSecret, setSecret },
  ) => {
    try {
      // TODO: give gdrivetool its own ability to authenticate through oauth.
      //       do this through ctx
      // an oauth token getter function which persists secrets in our local secretstore!
      const getToken = async () => {
        const tg = usePersistentOauth({
          getSecret: async (name) => await getSecret(name, false),
          setSecret,
        })
        return (
          await tg('google', {
            oauthURL: OAUTH_PROVIDERS.google.authUrl,
            clientId: OAUTH_PROVIDERS.google.clientId,
            scope: OAUTH_PROVIDERS.google.scope,
          })
        ).access_token
      }
      const gdrive = useGdrive(getToken)
      let result

      switch (action) {
        case 'saveObject': {
          if (!content) {
            throw new Error('Content is required for saveObject action')
          }
          const obj = JSON.parse(content)
          await gdrive.saveObjToGdrive(obj, directory, filename)
          result = { success: true, message: `Object saved to ${directory}/${filename}` }
          break
        }

        case 'saveFile': {
          if (!content) {
            throw new Error('Content is required for saveFile action')
          }
          if (!mimeType) {
            throw new Error('MIME type is required for saveFile action')
          }

          // Convert base64 to Blob
          const binaryString = atob(content)
          const len = binaryString.length
          const bytes = new Uint8Array(len)
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          const blob = new File([bytes], filename, { type: mimeType })

          const gdriveFile = await gdrive.saveFileToGdrive(blob, directory, share)
          result = {
            success: true,
            message: `File saved to ${directory}/${filename}`,
            fileInfo: gdriveFile,
          }
          break
        }

        case 'loadObject': {
          const obj = await gdrive.loadObjFromGdrive(directory, filename)
          result = {
            success: true,
            message: `Object loaded from ${directory}/${filename}`,
            data: obj,
          }
          break
        }

        case 'loadFile': {
          const file = await gdrive.loadFileFromGdrive(directory, filename)
          // Convert blob to base64
          const arrayBuffer = await file.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          let binary = ''
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]!)
          }
          const base64 = btoa(binary)

          result = {
            success: true,
            message: `File loaded from ${directory}/${filename}`,
            data: base64,
            mimeType: file.type,
          }
          break
        }

        case 'publishMarkdown': {
          if (!content) {
            throw new Error('Content is required for publishMarkdown action')
          }

          const gdriveFile = await gdrive.publishMarkdown(content, directory, filename, share)
          result = {
            success: true,
            message: `Markdown published to ${directory}/${filename}`,
            fileInfo: gdriveFile,
          }
          break
        }

        default:
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          throw new Error(`Unknown action: ${action}`)
      }

      return makeTaskResult([
        [
          {
            role: 'system',
            content: { type: 'toolresult', data: result },
          },
        ],
      ])
    } catch (error) {
      return makeTaskResult([
        [
          {
            role: 'system',
            content: {
              type: 'toolresult',
              data: {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
            },
          },
        ],
      ])
    }
  },
})
