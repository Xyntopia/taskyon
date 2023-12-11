import { ref, computed } from 'vue';
import axios from 'axios';
import { googleSdkLoaded } from 'vue3-google-login';
import { useTaskyonStore } from 'stores/taskyonState';
import { sleep } from 'src/modules/utils';

export const state = useTaskyonStore();

type gDriveFile = {
  kind: string; //"drive#file",
  id: string; //"1G4SJ8bBP13mNRWp9CIzeYNKsjc_q8BHP",
  name: string; //"taskyon/templates.json",
  mimeType: string; //"application/json"
};

const maxTokenAgeMinutes = 55;
const accessToken = ref(''); // Store the access token
const tokenReceivedTime = ref(0); // Unix timestamp of when the token was received
const clientId =
  '14927198496-1flnp4qo0e91phctnjsfrci5ce0rp91s.apps.googleusercontent.com';
const scope = 'https://www.googleapis.com/auth/drive.file';
let tokenClient:
  | {
      requestAccessToken: (
        overridableClientConfig?: Record<string, unknown> | undefined
      ) => void;
      callback:
        | ((response: { access_token: string; error: unknown }) => void)
        | undefined;
    }
  | undefined = undefined;

const isTokenExpired = computed(() => {
  const currentTime = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
  const tokenAgeSeconds = currentTime - tokenReceivedTime.value;
  return tokenAgeSeconds > maxTokenAgeMinutes * 60; // Convert minutes to seconds
});

function setTokenReceivedTime() {
  tokenReceivedTime.value = Math.floor(Date.now() / 1000); // Set to current Unix timestamp
}

googleSdkLoaded((google) => {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: scope,
  }) as typeof tokenClient;
});

async function getValidAccessToken() {
  if (!accessToken.value || isTokenExpired.value) {
    if (!tokenClient) {
      console.error('Token client is not initialized.');
      return null; // Return null to indicate failure
    }

    // Request a new token
    tokenClient.callback = (response) => {
      if (response.error) {
        console.error('Error refreshing token:', response.error);
        return;
      }
      accessToken.value = response.access_token; // Update the access token
      setTokenReceivedTime(); // Update the token received time
    };

    tokenClient.requestAccessToken({ prompt: '' });

    // Wait for the token to be refreshed
    while (isTokenExpired.value) {
      await sleep(1000); // Wait for 1 second before checking again
    }
  }

  return accessToken.value; // Return the valid access token
}

export async function onSyncGdrive() {
  const validAccessToken = await getValidAccessToken();
  if (validAccessToken) {
    console.log('sync settings to gdrive');
    const jsonString = JSON.stringify(state.chatState.taskChatTemplates);
    const fileBlob = new Blob([jsonString], { type: 'application/json' });
    await uploadFileToDrive(
      fileBlob,
      state.appConfiguration.gdriveDir + '/templates.json',
      'application/json',
      validAccessToken
    );
  } else {
    console.error('Failed to obtain a valid access token.');
  }
}

async function uploadFileToDrive(
  file: Blob,
  fileName: string,
  mimeType: string,
  accessToken: string
) {
  console.log('uploading file!');
  // Prepend the directory path to the file name
  const fullPath = state.appConfiguration.gdriveDir + '/' + fileName;

  // First, check if the directory exists, if not create it
  const directoryId = await ensureDirectoryExists(
    state.appConfiguration.gdriveDir,
    accessToken
  );

  // If the directory doesn't exist or there was an error, don't proceed
  if (!directoryId) {
    console.error('Error in creating or finding directory.');
    return;
  }

  const fileInfo = await pushFile(
    fileName,
    mimeType,
    directoryId,
    file,
    accessToken
  );
  return fileInfo;
}

async function pushFile(
  fileName: string,
  mimeType: string,
  directoryId: string | undefined,
  file: Blob | undefined,
  accessToken: string
) {
  const url =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  // Now, modify the metadata to include the parent directory
  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType: mimeType,
  };

  if (directoryId) {
    metadata.parents = [directoryId]; // Set the parent directory
  }

  const formData = new FormData();
  formData.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  if (file) {
    formData.append('file', new Blob([file], { type: mimeType }));
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'multipart/related',
  };

  let uploadedfileData: gDriveFile | undefined = undefined;
  try {
    const response = await axios.post(url, formData, { headers });
    uploadedfileData = response.data as gDriveFile;
    console.log('File uploaded, response:', response);
  } catch (error) {
    console.error('Error uploading file:', error);
  }

  return uploadedfileData;
}

async function ensureDirectoryExists(
  directoryPath: string,
  accessToken: string
): Promise<string | null> {
  console.log('ensure dir exists');
  try {
    // Search for the directory
    let directoryId = await findDirectoryId(directoryPath, accessToken);

    // If directory is not found, create it
    if (!directoryId) {
      directoryId = await createDirectory(directoryPath, accessToken);
    }

    return directoryId;
  } catch (error) {
    console.error('Error ensuring directory exists:', error);
    return null;
  }
}

async function findDirectoryId(directoryPath: string, accessToken: string) {
  console.log('get directory ID');
  const url = `https://www.googleapis.com/drive/v3/files?q=name='${directoryPath}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };

  try {
    const response: { data: { files: gDriveFile[] } } = await axios.get(url, {
      headers,
    });
    if (response.data.files) {
      const files = response.data.files;
      if (files.length > 0) {
        // Assuming the first found directory is the one we want
        return files[0].id;
      } else {
        return null;
      }
    }
  } catch (error) {
    console.error('Error finding directory:', error);
    return null;
  }
}

async function createDirectory(directoryPath: string, accessToken: string) {
  console.log('create directory using pushFile method');
  const directoryMimeType = 'application/vnd.google-apps.folder';

  // Call pushFile to create the directory
  const directoryInfo = await pushFile(
    directoryPath,
    directoryMimeType,
    undefined, // No parent directory ID as we are creating a new directory
    undefined,
    accessToken
  );

  // Return the ID of the newly created directory
  return directoryInfo ? directoryInfo.id : null;
}
