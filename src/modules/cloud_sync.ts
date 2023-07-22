/*interface CloudProvider {
  login: () => Promise<void>;
  upload: (file: File) => Promise<unknown>;
  download: (fileId: string) => Promise<unknown>;
}

class CloudStorageService {
  private provider: CloudProvider;

  constructor(provider: CloudProvider) {
    this.provider = provider;
  }

  async login() {
    return await this.provider.login();
  }

  async upload(file: File) {
    const result = await this.provider.upload(file);
    return result; // Now returns a Promise<unknown>
  }

  async download(fileId: string) {
    const result = await this.provider.download(fileId);
    return result; // Now returns a Promise<unknown>
  }
}

class GDrive {
  async login() {
    // Implement login using Google's OAuth2
  }

  async upload(file: File) {
    // Implement upload using Google Drive API
  }

  async download(fileId: string) {
    // Implement download using Google Drive API
  }
}

class Dropbox {
  async login() {
    // Implement login using Dropbox's OAuth2
  }

  async upload(file: File) {
    // Implement upload using Dropbox API
  }

  async download(fileId: string) {
    // Implement download using Dropbox API
  }
}

class OneDrive {
  async login() {
    // Implement login using OneDrive's OAuth2
  }

  async upload(file: File) {
    // Implement upload using OneDrive API
  }

  async download(fileId: string) {
    // Implement download using OneDrive API
  }
}

// Usage
const gdrive = new GDrive();
const cloudService = new CloudStorageService(gdrive);

//cloudService.login();
//cloudService.upload(new File([''], 'filename'));
//cloudService.download('fileId');*/
