use super::*;
use std::sync::Arc;

#[derive(Default)]
struct MemoryVault(Mutex<HashMap<String, Vec<u8>>>);
impl Vault for MemoryVault {
    fn read(&self, id: &str) -> Result<Option<Zeroizing<Vec<u8>>>, DeviceError> {
        Ok(self.0.lock().unwrap().get(id).cloned().map(Zeroizing::new))
    }
    fn write(&self, id: &str, bytes: &[u8]) -> Result<(), DeviceError> {
        self.0.lock().unwrap().insert(id.into(), bytes.to_vec());
        Ok(())
    }
}
fn service(vault: Arc<MemoryVault>, path: &std::path::Path) -> DeviceService {
    DeviceService::new(vault, path.to_path_buf())
}
fn open(service: &DeviceService, namespace: &str) -> DeviceOpen {
    service.open("main", namespace, None).unwrap()
}
#[test]
fn identity_survives_restart_and_is_namespace_scoped() {
    let directory = tempfile::tempdir().unwrap();
    let vault = Arc::new(MemoryVault::default());
    let first = open(&service(vault.clone(), directory.path()), "synthetic-a");
    let restarted = service(vault, directory.path());
    assert_eq!(
        first.device_public_key,
        open(&restarted, "synthetic-a").device_public_key
    );
    assert_ne!(
        first.device_public_key,
        open(&restarted, "synthetic-b").device_public_key
    );
}
#[test]
fn initialized_identity_never_regenerates_when_missing_or_corrupt() {
    let directory = tempfile::tempdir().unwrap();
    let vault = Arc::new(MemoryVault::default());
    let service = service(vault.clone(), directory.path());
    open(&service, "synthetic");
    vault.0.lock().unwrap().clear();
    assert!(matches!(
        service.open("main", "synthetic", None),
        Err(DeviceError::MissingDeviceKey)
    ));
    let id = namespace_id("synthetic").unwrap();
    vault.0.lock().unwrap().insert(id, vec![1; 4]);
    assert!(matches!(
        service.open("main", "synthetic", None),
        Err(DeviceError::CorruptDeviceKey)
    ));
}
#[test]
fn transport_restore_tamper_binding_and_caller_checks() {
    let directory = tempfile::tempdir().unwrap();
    let service = service(Arc::new(MemoryVault::default()), directory.path());
    let opened = open(&service, "synthetic");
    let transport_secret = StaticSecret::random_from_rng(OsRng);
    let transport_public = encode(PublicKey::from(&transport_secret).as_bytes());
    let first = service
        .open_session("main", &opened.handle, &transport_public, None)
        .unwrap();
    let second = service
        .open_session(
            "main",
            &opened.handle,
            &transport_public,
            Some(&first.wrapped_session_key),
        )
        .unwrap();
    let native_public = PublicKey::from(decode32(&opened.device_public_key).unwrap());
    let dh = transport_secret.diffie_hellman(&native_public);
    let key = transport_key(
        dh.as_bytes(),
        &opened.wrapper_id,
        &opened.handle,
        &transport_public,
        "out",
    )
    .unwrap();
    let aad = transport_aad(&opened.wrapper_id, &opened.handle, &transport_public, "out");
    let plain = decrypt(&key, &first.transport_envelope, &aad).unwrap();
    assert_eq!(
        &*plain,
        &*decrypt(&key, &second.transport_envelope, &aad).unwrap()
    );
    let mut damaged = decode_envelope(&first.wrapped_session_key).unwrap();
    damaged[15] ^= 1;
    assert!(service
        .open_session(
            "main",
            &opened.handle,
            &transport_public,
            Some(&format!("native:v1:{}", encode(&damaged)))
        )
        .is_err());
    assert!(matches!(
        service.open_session("headless", &opened.handle, &transport_public, None),
        Err(DeviceError::Unauthorized)
    ));
    assert!(service
        .open_session("main", &opened.handle, &encode(&[0; 32]), None)
        .is_err());
    let binding = encode(PublicKey::from(&StaticSecret::random_from_rng(OsRng)).as_bytes());
    let bound = service.open("main", "synthetic", Some(&binding)).unwrap();
    assert!(service
        .open_session(
            "main",
            &bound.handle,
            &transport_public,
            Some(&first.wrapped_session_key)
        )
        .is_err());
    service.close("main", &opened.handle).unwrap();
    service.close("main", &opened.handle).unwrap();
    assert!(matches!(
        service.open_session("main", &opened.handle, &transport_public, None),
        Err(DeviceError::Closed)
    ));
}
#[test]
fn concurrent_creation_keeps_one_identity() {
    let directory = tempfile::tempdir().unwrap();
    let vault = Arc::new(MemoryVault::default());
    let services: Vec<_> = (0..8)
        .map(|_| service(vault.clone(), directory.path()))
        .collect();
    let keys = std::thread::scope(|scope| {
        services
            .iter()
            .map(|service| scope.spawn(move || open(service, "synthetic").device_public_key))
            .collect::<Vec<_>>()
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert!(keys.iter().all(|key| key == &keys[0]));
}

#[test]
fn webcrypto_transport_vector_matches_native() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../packages/runtime-browser/src/tests/fixtures/native-crypto-v1.json"
    ))
    .unwrap();
    let text = |name: &str| fixture[name].as_str().unwrap();
    let secret = StaticSecret::from(decode32(text("devicePrivateKey")).unwrap());
    assert_eq!(
        encode(PublicKey::from(&secret).as_bytes()),
        text("devicePublicKey")
    );
    let public = PublicKey::from(decode32(text("transportPublicKey")).unwrap());
    let dh = secret.diffie_hellman(&public);
    let key = transport_key(
        dh.as_bytes(),
        text("wrapperId"),
        text("handle"),
        text("transportPublicKey"),
        "out",
    )
    .unwrap();
    let aad = transport_aad(
        text("wrapperId"),
        text("handle"),
        text("transportPublicKey"),
        "out",
    );
    let plain = decrypt(&key, text("transportEnvelope"), &aad).unwrap();
    assert_eq!(&*plain, &decode32(text("sessionKey")).unwrap());
    let wrong_direction = transport_aad(
        text("wrapperId"),
        text("handle"),
        text("transportPublicKey"),
        "in",
    );
    assert!(decrypt(&key, text("transportEnvelope"), &wrong_direction).is_err());
}

#[test]
fn importing_transported_session_preserves_key() {
    let directory = tempfile::tempdir().unwrap();
    let service = service(Arc::new(MemoryVault::default()), directory.path());
    let opened = open(&service, "synthetic-import");
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = encode(PublicKey::from(&secret).as_bytes());
    let dh = secret.diffie_hellman(&PublicKey::from(
        decode32(&opened.device_public_key).unwrap(),
    ));
    let key = transport_key(
        dh.as_bytes(),
        &opened.wrapper_id,
        &opened.handle,
        &public,
        "in",
    )
    .unwrap();
    let incoming = encrypt(
        &key,
        &[7; 32],
        &transport_aad(&opened.wrapper_id, &opened.handle, &public, "in"),
    )
    .unwrap();
    let imported = service
        .session("main", &opened.handle, &public, None, Some(&incoming))
        .unwrap();
    let restored = service
        .open_session(
            "main",
            &opened.handle,
            &public,
            Some(&imported.wrapped_session_key),
        )
        .unwrap();
    let out_key = transport_key(
        dh.as_bytes(),
        &opened.wrapper_id,
        &opened.handle,
        &public,
        "out",
    )
    .unwrap();
    let aad = transport_aad(&opened.wrapper_id, &opened.handle, &public, "out");
    assert_eq!(
        &*decrypt(&out_key, &restored.transport_envelope, &aad).unwrap(),
        &[7; 32]
    );
}

#[test]
fn unavailable_or_locked_vault_never_creates_marker() {
    struct FailedVault;
    impl Vault for FailedVault {
        fn read(&self, _: &str) -> Result<Option<Zeroizing<Vec<u8>>>, DeviceError> {
            Err(DeviceError::Locked)
        }
        fn write(&self, _: &str, _: &[u8]) -> Result<(), DeviceError> {
            panic!("must not write after failed read")
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let service = DeviceService::new(Arc::new(FailedVault), directory.path().to_path_buf());
    assert!(matches!(
        service.open("main", "synthetic", None),
        Err(DeviceError::Locked)
    ));
    assert!(!directory
        .path()
        .join(format!("{}.public", namespace_id("synthetic").unwrap()))
        .exists());
}

/// Explicit subprocess fixture for the WebCrypto contract tests. Never selected by normal tests.
#[test]
#[ignore = "stdin-driven synthetic contract fixture"]
fn contract_server() {
    use std::io::{BufRead, Write};
    let directory = tempfile::tempdir().unwrap();
    let vault = Arc::new(MemoryVault::default());
    let mut service = service(vault.clone(), directory.path());
    for line in std::io::stdin().lock().lines() {
        let request: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
        let text = |field: &str| request[field].as_str().unwrap();
        let result: Result<serde_json::Value, DeviceError> = match text("operation") {
            "open" => service
                .open(
                    "main",
                    text("namespace"),
                    request["bindingPublicKey"].as_str(),
                )
                .map(|v| serde_json::to_value(v).unwrap()),
            "openSession" => service
                .open_session(
                    "main",
                    text("handle"),
                    text("transportPublicKey"),
                    request["wrappedSessionKey"].as_str(),
                )
                .map(|v| serde_json::to_value(v).unwrap()),
            "importSession" => service
                .session(
                    "main",
                    text("handle"),
                    text("transportPublicKey"),
                    None,
                    Some(text("transportEnvelope")),
                )
                .map(|v| serde_json::to_value(v).unwrap()),
            "close" => service
                .close("main", text("handle"))
                .map(|_| serde_json::Value::Null),
            "restart" => {
                service = DeviceService::new(vault.clone(), directory.path().to_path_buf());
                Ok(serde_json::Value::Null)
            }
            _ => Err(DeviceError::Unauthorized),
        };
        println!(
            "NATIVE_TEST_RESULT {}",
            serde_json::json!({"id":request["id"], "result": result})
        );
        std::io::stdout().flush().unwrap();
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
#[test]
#[ignore = "explicit host-only OS vault write/read/delete diagnostic"]
fn os_vault_roundtrip() {
    let directory = tempfile::tempdir().unwrap();
    let mut random = [0; 32];
    OsRng.fill_bytes(&mut random);
    let namespace = format!("synthetic-host-{}", encode(&random));
    let id = namespace_id(&namespace).unwrap();
    let result = (|| -> Result<(), DeviceError> {
        let first_service = DeviceService::new(Arc::new(OsVault), directory.path().to_path_buf());
        let first = first_service.open("synthetic-host", &namespace, None)?;
        let transport = encode(PublicKey::from(&StaticSecret::random_from_rng(OsRng)).as_bytes());
        let session =
            first_service.open_session("synthetic-host", &first.handle, &transport, None)?;
        first_service.close("synthetic-host", &first.handle)?;
        drop(first_service);
        let restarted = DeviceService::new(Arc::new(OsVault), directory.path().to_path_buf());
        let second = restarted.open("synthetic-host", &namespace, None)?;
        assert_eq!(
            first.device_public_key, second.device_public_key,
            "OS vault identity changed"
        );
        restarted.open_session(
            "synthetic-host",
            &second.handle,
            &transport,
            Some(&session.wrapped_session_key),
        )?;
        restarted.close("synthetic-host", &second.handle)?;
        Ok(())
    })();
    let cleanup = keyring::Entry::new("space.taskyon.native-device-v1", &id)
        .and_then(|entry| entry.delete_credential());
    assert!(
        cleanup.is_ok() || matches!(cleanup, Err(keyring::Error::NoEntry)),
        "Synthetic OS vault cleanup failed"
    );
    assert!(
        result.is_ok(),
        "OS vault diagnostic failed with a redacted native error: {:?}",
        result.err()
    );
}

#[test]
fn command_callers_are_restricted_to_app_origins() {
    let url = |value| tauri::Url::parse(value).unwrap();
    assert!(authorize_caller("main", &url("tauri://localhost/"), false).is_ok());
    assert!(authorize_caller("headless", &url("https://tauri.localhost/"), false).is_ok());
    assert!(authorize_caller("tool", &url("tauri://localhost/"), false).is_err());
    assert!(authorize_caller("main", &url("https://remote.invalid/"), true).is_err());
    assert!(authorize_caller("main", &url("http://localhost:9000/"), false).is_err());
    assert!(authorize_caller("main", &url("http://localhost:9000/"), true).is_ok());
    assert!(authorize_caller("main", &url("http://localhost:9001/"), true).is_err());
    assert!(authorize_caller(
        "main",
        &url("http://localhost.attacker.invalid:9000/"),
        true
    )
    .is_err());
}
