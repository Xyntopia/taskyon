import { ref, computed } from 'vue';
import axios from 'axios';
import { googleSdkLoaded } from 'vue3-google-login';
import { useTaskyonStore } from 'stores/taskyonState';
import { deepMergeReactive, sleep } from 'src/modules/taskyon/utils';
import { asyncLruCache } from 'src/modules/taskyon/utils';

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
    const jsonString = JSON.stringify({
      llmSettings: state.llmSettings,
      appConfiguration: state.appConfiguration,
    });
    const fileBlob = new Blob([jsonString], { type: 'application/json' });
    await uploadFileToDrive(
      fileBlob,
      state.appConfiguration.gdriveDir,
      state.appConfiguration.gdriveConfigurationFile,
      'application/json',
      validAccessToken
    );
  } else {
    console.error('Failed to obtain a valid access token.');
  }
}

export async function onUpdateAppConfiguration() {
  const validAccessToken = await getValidAccessToken();
  if (validAccessToken) {
    console.log('update app setting from gdrive');

    const fileId = await findFileOrDirectoryId({
      accessToken: validAccessToken,
      fileName: state.appConfiguration.gdriveConfigurationFile,
      directory: state.appConfiguration.gdriveDir,
    });

    if (fileId) {
      const file = await downloadFileFromDrive(fileId, validAccessToken);
      const jsonstring = await file?.text();
      const loadedConfig = JSON.parse(jsonstring || '') as Record<
        string,
        unknown
      >;
      deepMergeReactive(
        state.appConfiguration,
        (loadedConfig.appConfiguration || {}) as Record<string, unknown>,
        'overwrite'
      );
      deepMergeReactive(
        state.llmSettings,
        (loadedConfig.llmSettings || {}) as Record<string, unknown>,
        'overwrite'
      );
    } else {
      console.error('File not found in GDrive.');
    }
  } else {
    console.error('Failed to obtain a valid access token.');
  }
}

async function uploadFileToDrive(
  file: Blob,
  directory: string,
  fileName: string,
  mimeType: string,
  accessToken: string
) {
  console.log('Uploading or updating file');

  // Check if the directory exists, if not, create it
  const directoryId = await ensureDirectoryExists(directory, accessToken);
  if (!directoryId) {
    console.error('Error in creating or finding directory.');
    return;
  }

  // Check if the file already exists
  const existingFileId = await findFileOrDirectoryId({
    fileName,
    accessToken,
  });

  // Update or create the file
  if (existingFileId) {
    console.log('File exists, updating it');
    return await updateFile(existingFileId, file, mimeType, accessToken);
  } else {
    console.log('File does not exist, creating new file');
    return await pushFile(fileName, mimeType, directoryId, file, accessToken);
  }
}

async function updateFile(
  fileId: string,
  file: Blob,
  mimeType: string,
  accessToken: string
) {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
  const metadata = { mimeType: mimeType };

  const formData = new FormData();
  formData.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  formData.append('file', new Blob([file], { type: mimeType }));

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'multipart/related',
  };

  try {
    const response = await axios.patch<gDriveFile>(url, formData, { headers });
    console.log('File updated, response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error updating file:', error);
    return undefined;
  }
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
    const response = await axios.post<gDriveFile>(url, formData, { headers });
    uploadedfileData = response.data;
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
    let directoryId = await findFileOrDirectoryId({
      accessToken,
      directory: directoryPath,
    });

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

const findFileOrDirectoryId = asyncLruCache<string | null>(10)(
  async ({
    accessToken,
    fileName,
    directory,
  }: {
    accessToken: string;
    fileName?: string;
    directory?: string;
  }) => {
    console.log('Get file or directory ID');

    // Determine the query based on input
    let url;
    if (directory && !fileName) {
      // Only directory is given
      url = `https://www.googleapis.com/drive/v3/files?q=name='${directory}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    } else if (fileName && !directory) {
      // Only file is given
      url = `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
    } else if (fileName && directory) {
      // Both file and directory are given, find the directory ID first
      const directoryId = await findFileOrDirectoryId({
        directory,
        accessToken,
      });
      if (!directoryId) {
        console.error('Directory not found');
        return null;
      }
      url = `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and parents in '${directoryId}' and trashed=false`;
    } else {
      // Neither file nor directory is given
      console.error('No file or directory specified');
      return null;
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };

    try {
      const response = await axios.get<{ files: gDriveFile[] }>(url, {
        headers,
      });
      if (response.data.files[0] && response.data.files.length > 0) {
        return response.data.files[0].id; // Assuming the first found item is the one we want
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error finding file or directory:', error);
      return null;
    }
  }
);

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

export async function downloadFileFromDrive(
  fileId: string,
  accessToken: string
) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };
  try {
    const response = await axios.get(url, { headers, responseType: 'blob' });
    console.log('File downloaded successfully.');
    return response.data as File; // The file data
  } catch (error) {
    console.error('Error downloading file:', error);
    return null;
  }
}
