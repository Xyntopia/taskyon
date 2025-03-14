# How Taskyon Handles Secrets for Plugins

Taskyon is designed to protect your sensitive information with a local, encrypted secret store. Below is an overview that addresses common concerns and explains the inner workings of our secret management system.

## For Non-Technical Users

- **No Data Leakage:**  
  Your secrets remain on your device and are never sent to any server.

- **Plugin-Specific Access:**  
  Only the plugin that created a secret can access it, so your sensitive data stays isolated.

- **Simple and Secure Unlocking:**  
  A passKey is used to unlock a session key, which then decrypts your secrets—making the process secure yet straightforward.

- **Open Source Assurance:**  
  Taskyon's source code is open and available for inspection, so you can verify for yourself how your data is protected.

## Key Security Points

- **Local Storage & Default Encryption:**  
  Taskyon stores all secrets locally on your device. They are encrypted by default and never transmitted to any server.

- **Plugin Isolation:**  
  Each tool or plugin has access only to its own secrets. The secret store is architected so that secrets from one plugin are isolated from all others.

- **PassKey Standard:**  
  To unlock the secret store, Taskyon uses the new passKey standard. A passKey unlocks a session key, which in turn is used to decrypt the stored secrets.

- **Individual Encryption per Secret:**  
  Each secret is encrypted with its own unique key. This ensures that even if one key were compromised, it would not jeopardize the security of other secrets.

- **Transparency & Future Auditing:**  
  The source code for Taskyon is freely available for review. Although Taskyon has not yet been formally audited, we are committed to undergoing an audit in the future.

- **Use of Modern Cryptography:**  
  Taskyon leverages the WebCrypto API along with robust libraries (like noble/ciphers) to handle encryption, ensuring a modern and secure approach to secret management.

- **Developer Responsibility:**  
  While the secret store is built to prevent secrets from leaking to external backends, plugin developers are responsible for ensuring that their tools handle secrets appropriately.

## For Users Familiar with Encryption

- **Encryption Process:**  
  Taskyon uses the WebCrypto API and noble/ciphers to encrypt and decrypt data. Each secret is encrypted with a unique key, and these keys are managed via a layered security model:

  - The **passKey** unlocks a **session key**.
  - The session key is then used to perform the actual decryption/encryption of secrets.
  - This functionality is encapsulated in our `withEncryption` wrapper, which seamlessly integrates with the underlying CRUD operations.

- **Plugin Isolation Architecture:**  
  The secret store ensures that only the originating tool or plugin can access its secrets. This design prevents cross-access and reduces the risk of accidental data leakage.

- **Developer Guidelines:**  
  Although the system enforces local and encrypted storage, developers must ensure that their tools do not inadvertently send secrets to external services.

## Conclusion

Taskyon’s secret management system has been designed with careful consideration for both security and usability. By storing secrets locally, encrypting each one individually, and enforcing strict access isolation, Taskyon provides a secure environment for managing your sensitive data. We remain committed to further audits and improvements to ensure that your secrets are always well protected.
