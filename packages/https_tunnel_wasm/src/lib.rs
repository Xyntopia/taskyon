use std::io::{Cursor, ErrorKind, Read, Write};
use std::sync::Arc;

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore};
use wasm_bindgen::prelude::*;
use webpki_roots::TLS_SERVER_ROOTS;

fn js_error(context: &str, error: impl std::fmt::Display) -> JsError {
    JsError::new(&format!("{context}: {error}"))
}

fn client_config() -> Arc<ClientConfig> {
    let mut roots = RootCertStore::empty();
    roots.extend(TLS_SERVER_ROOTS.iter().cloned());
    let mut config = ClientConfig::builder_with_provider(Arc::new(rustls_rustcrypto::provider()))
        .with_safe_default_protocol_versions()
        .expect("RustCrypto supports the default TLS protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Arc::new(config)
}

#[wasm_bindgen]
pub struct TlsClient {
    connection: ClientConnection,
    plaintext: Vec<u8>,
    peer_closed: bool,
}

fn drain_plaintext(
    connection: &mut ClientConnection,
    plaintext: &mut Vec<u8>,
) -> Result<(), JsError> {
    match connection.reader().read_to_end(plaintext) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::WouldBlock => Ok(()),
        Err(error) => Err(js_error("could not read TLS plaintext", error)),
    }
}

#[wasm_bindgen]
impl TlsClient {
    #[wasm_bindgen(constructor)]
    pub fn new(host: String) -> Result<TlsClient, JsError> {
        let server_name = ServerName::try_from(host)
            .map_err(|error| js_error("invalid TLS server name", error))?;
        let connection = ClientConnection::new(client_config(), server_name)
            .map_err(|error| js_error("could not create TLS client", error))?;
        Ok(Self {
            connection,
            plaintext: Vec::new(),
            peer_closed: false,
        })
    }

    #[wasm_bindgen(js_name = receiveTls)]
    pub fn receive_tls(&mut self, bytes: &[u8]) -> Result<(), JsError> {
        let mut cursor = Cursor::new(bytes);
        while cursor.position() < bytes.len() as u64 {
            let mut chunk = cursor.by_ref().take(4 * 1024);
            let read = self
                .connection
                .read_tls(&mut chunk)
                .map_err(|error| js_error("could not read TLS records", error))?;
            if read == 0 {
                return Err(JsError::new(
                    "TLS peer stopped before consuming the received record",
                ));
            }
            let state = self
                .connection
                .process_new_packets()
                .map_err(|error| js_error("TLS protocol error", error))?;
            self.peer_closed |= state.peer_has_closed();
            drain_plaintext(&mut self.connection, &mut self.plaintext)?;
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = takeTlsBytes)]
    pub fn take_tls_bytes(&mut self) -> Result<Vec<u8>, JsError> {
        let mut bytes = Vec::new();
        while self.connection.wants_write() {
            self.connection
                .write_tls(&mut bytes)
                .map_err(|error| js_error("could not encode TLS records", error))?;
        }
        Ok(bytes)
    }

    #[wasm_bindgen(js_name = writePlaintext)]
    pub fn write_plaintext(&mut self, bytes: &[u8]) -> Result<(), JsError> {
        self.connection
            .writer()
            .write_all(bytes)
            .map_err(|error| js_error("could not write TLS plaintext", error))
    }

    #[wasm_bindgen(js_name = readPlaintext)]
    pub fn read_plaintext(&mut self) -> Result<Vec<u8>, JsError> {
        drain_plaintext(&mut self.connection, &mut self.plaintext)?;
        Ok(std::mem::take(&mut self.plaintext))
    }

    #[wasm_bindgen(js_name = isHandshaking)]
    pub fn is_handshaking(&self) -> bool {
        self.connection.is_handshaking()
    }

    #[wasm_bindgen(js_name = peerClosed)]
    pub fn peer_closed(&self) -> bool {
        self.peer_closed
    }

    #[wasm_bindgen(js_name = protocolVersion)]
    pub fn protocol_version(&self) -> Option<String> {
        self.connection
            .protocol_version()
            .map(|version| match version {
                rustls::ProtocolVersion::TLSv1_2 => "TLS1_2".to_string(),
                rustls::ProtocolVersion::TLSv1_3 => "TLS1_3".to_string(),
                other => format!("{other:?}"),
            })
    }

    #[wasm_bindgen(js_name = cipherSuite)]
    pub fn cipher_suite(&self) -> Option<String> {
        self.connection
            .negotiated_cipher_suite()
            .map(|suite| format!("{:?}", suite.suite()))
    }

    #[wasm_bindgen(js_name = sendCloseNotify)]
    pub fn send_close_notify(&mut self) {
        self.connection.send_close_notify();
    }
}

#[cfg(test)]
mod tests {
    use super::TlsClient;

    #[test]
    fn tls_client_emits_a_client_hello() {
        let mut client = TlsClient::new("example.com".to_string()).unwrap();

        assert!(client.is_handshaking());
        assert!(!client.take_tls_bytes().unwrap().is_empty());
    }
}
