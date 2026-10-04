//! Desktop-only device custody. Secrets never cross the command boundary.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use fs2::FileExt;
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

#[derive(Debug, Serialize)]
pub enum DeviceError {
    Locked,
    Unavailable,
    MissingDeviceKey,
    CorruptDeviceKey,
    InvalidEnvelope,
    Unauthorized,
    Closed,
}

trait Vault: Send + Sync {
    fn read(&self, id: &str) -> Result<Option<Zeroizing<Vec<u8>>>, DeviceError>;
    fn write(&self, id: &str, bytes: &[u8]) -> Result<(), DeviceError>;
}
struct OsVault;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn vault_error(error: keyring::Error) -> DeviceError {
    match error {
        keyring::Error::NoStorageAccess(_) => DeviceError::Locked,
        _ => DeviceError::Unavailable,
    }
}
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
impl Vault for OsVault {
    fn read(&self, id: &str) -> Result<Option<Zeroizing<Vec<u8>>>, DeviceError> {
        let entry =
            keyring::Entry::new("space.taskyon.native-device-v1", id).map_err(vault_error)?;
        match entry.get_secret() {
            Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(vault_error(error)),
        }
    }
    fn write(&self, id: &str, bytes: &[u8]) -> Result<(), DeviceError> {
        keyring::Entry::new("space.taskyon.native-device-v1", id)
            .map_err(vault_error)?
            .set_secret(bytes)
            .map_err(vault_error)
    }
}
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
impl Vault for OsVault {
    fn read(&self, _: &str) -> Result<Option<Zeroizing<Vec<u8>>>, DeviceError> {
        Err(DeviceError::Unavailable)
    }
    fn write(&self, _: &str, _: &[u8]) -> Result<(), DeviceError> {
        Err(DeviceError::Unavailable)
    }
}
struct DeviceHandle {
    caller: String,
    secret: StaticSecret,
    wrapper_id: String,
    storage_key: Zeroizing<[u8; 32]>,
}
pub struct DeviceService {
    vault: Arc<dyn Vault>,
    directory: PathBuf,
    handles: Mutex<HashMap<String, DeviceHandle>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceOpen {
    pub handle: String,
    pub device_public_key: String,
    pub wrapper_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSession {
    pub wrapped_session_key: String,
    pub transport_envelope: String,
}
fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}
fn decode32(value: &str) -> Result<[u8; 32], DeviceError> {
    if value.len() != 43 {
        return Err(DeviceError::InvalidEnvelope);
    }
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| DeviceError::InvalidEnvelope)?
        .try_into()
        .map_err(|_| DeviceError::InvalidEnvelope)
}
fn namespace_id(namespace: &str) -> Result<String, DeviceError> {
    if namespace.is_empty()
        || namespace.len() > 512
        || namespace.trim() != namespace
        || namespace.chars().any(char::is_control)
    {
        return Err(DeviceError::Unauthorized);
    }
    Ok(encode(&Sha256::digest(format!(
        "taskyon.native-device.v1:{namespace}"
    ))))
}
fn derive_key(secret: &[u8], salt: &str, info: &[u8]) -> Result<Zeroizing<[u8; 32]>, DeviceError> {
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(salt.as_bytes()), secret)
        .expand(info, &mut *key)
        .map_err(|_| DeviceError::InvalidEnvelope)?;
    Ok(key)
}
fn transport_aad(wrapper: &str, handle: &str, public: &str, direction: &str) -> Vec<u8> {
    serde_json::to_vec(&["taskyon.transport.v1", wrapper, handle, public, direction])
        .expect("string array")
}
fn transport_key(
    dh: &[u8],
    wrapper: &str,
    handle: &str,
    public: &str,
    direction: &str,
) -> Result<Zeroizing<[u8; 32]>, DeviceError> {
    if dh.iter().all(|byte| *byte == 0) {
        return Err(DeviceError::InvalidEnvelope);
    }
    derive_key(
        dh,
        wrapper,
        &transport_aad(wrapper, handle, public, direction),
    )
}
fn storage_aad(wrapper: &str) -> Vec<u8> {
    serde_json::to_vec(&["taskyon.storage.v1", wrapper]).expect("string array")
}
fn encrypt(key: &[u8; 32], plain: &[u8], aad: &[u8]) -> Result<String, DeviceError> {
    let mut nonce = [0; 12];
    OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| DeviceError::InvalidEnvelope)?;
    let ciphertext = cipher
        .encrypt(&Nonce::from(nonce), Payload { msg: plain, aad })
        .map_err(|_| DeviceError::InvalidEnvelope)?;
    Ok(format!(
        "native:v1:{}",
        encode(&[nonce.as_slice(), ciphertext.as_slice()].concat())
    ))
}
fn decode_envelope(envelope: &str) -> Result<Vec<u8>, DeviceError> {
    if envelope.len() != 90 {
        return Err(DeviceError::InvalidEnvelope);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(
            envelope
                .strip_prefix("native:v1:")
                .ok_or(DeviceError::InvalidEnvelope)?,
        )
        .map_err(|_| DeviceError::InvalidEnvelope)?;
    if bytes.len() != 60 {
        return Err(DeviceError::InvalidEnvelope);
    }
    Ok(bytes)
}
fn decrypt(key: &[u8; 32], envelope: &str, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, DeviceError> {
    let bytes = decode_envelope(envelope)?;
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| DeviceError::InvalidEnvelope)?
        .decrypt(
            &Nonce::from(
                <[u8; 12]>::try_from(&bytes[..12]).map_err(|_| DeviceError::InvalidEnvelope)?,
            ),
            Payload {
                msg: &bytes[12..],
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| DeviceError::InvalidEnvelope)
}
impl DeviceService {
    fn new(vault: Arc<dyn Vault>, directory: PathBuf) -> Self {
        Self {
            vault,
            directory,
            handles: Mutex::new(HashMap::new()),
        }
    }
    pub fn os(directory: PathBuf) -> Self {
        Self::new(Arc::new(OsVault), directory.join("native-device-v1"))
    }
    fn load_secret(&self, id: &str) -> Result<StaticSecret, DeviceError> {
        fs::create_dir_all(&self.directory).map_err(|_| DeviceError::Unavailable)?;
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(self.directory.join(format!("{id}.lock")))
            .map_err(|_| DeviceError::Unavailable)?;
        lock.lock_exclusive()
            .map_err(|_| DeviceError::Unavailable)?;
        let marker = self.directory.join(format!("{id}.public"));
        let initialized = marker.try_exists().map_err(|_| DeviceError::Unavailable)?;
        let record = self.vault.read(id)?;
        let secret = match record {
            Some(bytes) if bytes.len() == 33 && bytes[0] == 1 => {
                let mut raw = Zeroizing::new([0; 32]);
                raw.copy_from_slice(&bytes[1..]);
                StaticSecret::from(*raw)
            }
            Some(_) => return Err(DeviceError::CorruptDeviceKey),
            None if initialized => return Err(DeviceError::MissingDeviceKey),
            None => {
                let secret = StaticSecret::random_from_rng(OsRng);
                let mut record = Zeroizing::new(vec![1]);
                record.extend_from_slice(secret.as_bytes());
                self.vault.write(id, &record)?;
                secret
            }
        };
        let public = PublicKey::from(&secret);
        if initialized {
            let expected = fs::read(&marker).map_err(|_| DeviceError::Unavailable)?;
            if expected != public.as_bytes() {
                return Err(DeviceError::CorruptDeviceKey);
            }
        } else {
            let temporary = self.directory.join(format!("{id}.public.tmp"));
            let mut file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&temporary)
                .map_err(|_| DeviceError::Unavailable)?;
            file.write_all(public.as_bytes())
                .map_err(|_| DeviceError::Unavailable)?;
            file.sync_all().map_err(|_| DeviceError::Unavailable)?;
            drop(file);
            fs::rename(temporary, marker).map_err(|_| DeviceError::Unavailable)?;
            #[cfg(unix)]
            fs::File::open(&self.directory)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| DeviceError::Unavailable)?;
        }
        Ok(secret)
    }
    fn open(
        &self,
        caller: &str,
        namespace: &str,
        binding: Option<&str>,
    ) -> Result<DeviceOpen, DeviceError> {
        let id = namespace_id(namespace)?;
        let secret = self.load_secret(&id)?;
        let public = PublicKey::from(&secret);
        let binding = binding
            .map(decode32)
            .transpose()?
            .unwrap_or(*public.as_bytes());
        let dh = secret.diffie_hellman(&PublicKey::from(binding));
        if !dh.was_contributory() {
            return Err(DeviceError::InvalidEnvelope);
        }
        let wrapper_id = encode(&Sha256::digest(
            serde_json::to_vec(&[
                "taskyon.wrapper.v1",
                &id,
                &encode(public.as_bytes()),
                &encode(&binding),
            ])
            .expect("string array"),
        ));
        let storage_key = derive_key(dh.as_bytes(), &wrapper_id, &storage_aad(&wrapper_id))?;
        let mut random = [0; 32];
        OsRng.fill_bytes(&mut random);
        let handle = encode(&random);
        self.handles
            .lock()
            .map_err(|_| DeviceError::Unavailable)?
            .insert(
                handle.clone(),
                DeviceHandle {
                    caller: caller.into(),
                    secret,
                    wrapper_id: wrapper_id.clone(),
                    storage_key,
                },
            );
        Ok(DeviceOpen {
            handle,
            device_public_key: encode(public.as_bytes()),
            wrapper_id,
        })
    }
    fn session(
        &self,
        caller: &str,
        handle: &str,
        transport_public: &str,
        wrapped: Option<&str>,
        imported: Option<&str>,
    ) -> Result<DeviceSession, DeviceError> {
        let handles = self.handles.lock().map_err(|_| DeviceError::Unavailable)?;
        let device = handles.get(handle).ok_or(DeviceError::Closed)?;
        if device.caller != caller {
            return Err(DeviceError::Unauthorized);
        }
        let dh = device
            .secret
            .diffie_hellman(&PublicKey::from(decode32(transport_public)?));
        let out_key = transport_key(
            dh.as_bytes(),
            &device.wrapper_id,
            handle,
            transport_public,
            "out",
        )?;
        let session = if let Some(envelope) = imported {
            let key = transport_key(
                dh.as_bytes(),
                &device.wrapper_id,
                handle,
                transport_public,
                "in",
            )?;
            decrypt(
                &key,
                envelope,
                &transport_aad(&device.wrapper_id, handle, transport_public, "in"),
            )?
        } else if let Some(envelope) = wrapped {
            decrypt(
                &device.storage_key,
                envelope,
                &storage_aad(&device.wrapper_id),
            )?
        } else {
            let mut bytes = Zeroizing::new(vec![0; 32]);
            OsRng.fill_bytes(&mut bytes);
            bytes
        };
        Ok(DeviceSession {
            wrapped_session_key: encrypt(
                &device.storage_key,
                &session,
                &storage_aad(&device.wrapper_id),
            )?,
            transport_envelope: encrypt(
                &out_key,
                &session,
                &transport_aad(&device.wrapper_id, handle, transport_public, "out"),
            )?,
        })
    }
    fn open_session(
        &self,
        caller: &str,
        handle: &str,
        public: &str,
        wrapped: Option<&str>,
    ) -> Result<DeviceSession, DeviceError> {
        self.session(caller, handle, public, wrapped, None)
    }
    fn close(&self, caller: &str, handle: &str) -> Result<(), DeviceError> {
        let mut handles = self.handles.lock().map_err(|_| DeviceError::Unavailable)?;
        if handles
            .get(handle)
            .is_some_and(|device| device.caller != caller)
        {
            return Err(DeviceError::Unauthorized);
        }
        handles.remove(handle);
        Ok(())
    }
}
fn authorize_caller(
    label: &str,
    url: &tauri::Url,
    development: bool,
) -> Result<String, DeviceError> {
    if !matches!(label, "main" | "headless") {
        return Err(DeviceError::Unauthorized);
    }
    let packaged = matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    );
    let development = development
        && url.scheme() == "http"
        && url.host_str() == Some("localhost")
        && url.port() == Some(9000);
    if !packaged && !development {
        return Err(DeviceError::Unauthorized);
    }
    Ok(format!("{}:{}", label, url.origin().ascii_serialization()))
}
fn caller(window: &tauri::WebviewWindow) -> Result<String, DeviceError> {
    let url = window.url().map_err(|_| DeviceError::Unauthorized)?;
    authorize_caller(window.label(), &url, cfg!(debug_assertions))
}
#[tauri::command]
pub async fn device_open(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DeviceService>>,
    namespace: String,
    binding_public_key: Option<String>,
) -> Result<DeviceOpen, DeviceError> {
    let caller = caller(&window)?;
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.open(&caller, &namespace, binding_public_key.as_deref())
    })
    .await
    .map_err(|_| DeviceError::Unavailable)?
}
#[tauri::command]
pub async fn device_open_session(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DeviceService>>,
    handle: String,
    transport_public_key: String,
    wrapped_session_key: Option<String>,
) -> Result<DeviceSession, DeviceError> {
    let caller = caller(&window)?;
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.open_session(
            &caller,
            &handle,
            &transport_public_key,
            wrapped_session_key.as_deref(),
        )
    })
    .await
    .map_err(|_| DeviceError::Unavailable)?
}
#[tauri::command]
pub async fn device_import_session(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DeviceService>>,
    handle: String,
    transport_public_key: String,
    transport_envelope: String,
) -> Result<DeviceSession, DeviceError> {
    let caller = caller(&window)?;
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.session(
            &caller,
            &handle,
            &transport_public_key,
            None,
            Some(&transport_envelope),
        )
    })
    .await
    .map_err(|_| DeviceError::Unavailable)?
}
#[tauri::command]
pub async fn device_close(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DeviceService>>,
    handle: String,
) -> Result<(), DeviceError> {
    let caller = caller(&window)?;
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.close(&caller, &handle))
        .await
        .map_err(|_| DeviceError::Unavailable)?
}
#[cfg(test)]
#[path = "native_crypto_tests.rs"]
mod tests;
