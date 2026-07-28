const NOISE_PATTERN: &str = "Noise_XX_25519_ChaChaPoly_SHA256";
const MAX_HANDSHAKE_BYTES: usize = 65_535;
const MAX_TRANSPORT_PLAINTEXT: usize = 65_519;
const TRANSPORT_NONCE_BYTES: usize = 4;
const REPLAY_WINDOW_SIZE: u64 = 1_024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoiseRole {
    Initiator,
    Responder,
}

pub struct NoiseHandshake {
    role: NoiseRole,
    state: snow::HandshakeState,
}

impl NoiseHandshake {
    /// Starts a Noise XX handshake with a persistent local static key.
    ///
    /// # Errors
    ///
    /// Returns an error when the protocol name or key is invalid.
    pub fn new(role: NoiseRole, local_static_private: &[u8; 32]) -> Result<Self, String> {
        let params = NOISE_PATTERN
            .parse()
            .map_err(|error: snow::Error| error.to_string())?;
        let builder = snow::Builder::new(params)
            .local_private_key(local_static_private)
            .map_err(|error| error.to_string())?;
        let state = match role {
            NoiseRole::Initiator => builder.build_initiator(),
            NoiseRole::Responder => builder.build_responder(),
        }
        .map_err(|error| error.to_string())?;
        Ok(Self { role, state })
    }

    #[must_use]
    pub const fn role(&self) -> NoiseRole {
        self.role
    }

    #[must_use]
    pub fn is_finished(&self) -> bool {
        self.state.is_handshake_finished()
    }

    #[must_use]
    pub fn remote_static_key(&self) -> Option<[u8; 32]> {
        self.state.get_remote_static()?.try_into().ok()
    }

    /// Writes the next Noise handshake message.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid handshake turn or oversized payload.
    pub fn write(&mut self, payload: &[u8]) -> Result<Vec<u8>, String> {
        if payload.len() > MAX_TRANSPORT_PLAINTEXT {
            return Err("Noise handshake payload exceeds its limit".into());
        }
        let mut out = vec![0_u8; MAX_HANDSHAKE_BYTES];
        let written = self
            .state
            .write_message(payload, &mut out)
            .map_err(|error| error.to_string())?;
        out.truncate(written);
        Ok(out)
    }

    /// Reads the next Noise handshake message and returns its authenticated
    /// payload.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid handshake turn, failed authentication,
    /// or oversized input.
    pub fn read(&mut self, message: &[u8]) -> Result<Vec<u8>, String> {
        if message.len() > MAX_HANDSHAKE_BYTES {
            return Err("Noise handshake message exceeds its limit".into());
        }
        let mut out = vec![0_u8; MAX_HANDSHAKE_BYTES];
        let read = self
            .state
            .read_message(message, &mut out)
            .map_err(|error| error.to_string())?;
        out.truncate(read);
        Ok(out)
    }

    /// Converts a completed handshake into the bidirectional transport state.
    ///
    /// # Errors
    ///
    /// Returns an error if the three-message XX handshake is incomplete.
    pub fn into_transport(self) -> Result<NoiseTransport, String> {
        if !self.state.is_handshake_finished() {
            return Err("Noise handshake is not complete".into());
        }
        let remote_static_key = self
            .state
            .get_remote_static()
            .and_then(|key| key.try_into().ok())
            .ok_or_else(|| "Noise peer did not authenticate a static key".to_string())?;
        let state = self
            .state
            .into_stateless_transport_mode()
            .map_err(|error| error.to_string())?;
        Ok(NoiseTransport {
            state,
            remote_static_key,
            send_nonce: 0,
            replay_window: ReplayWindow::default(),
        })
    }
}

pub struct NoiseTransport {
    state: snow::StatelessTransportState,
    remote_static_key: [u8; 32],
    send_nonce: u64,
    replay_window: ReplayWindow,
}

#[derive(Default)]
struct ReplayWindow {
    highest: Option<u64>,
    seen: std::collections::BTreeSet<u64>,
}

impl ReplayWindow {
    fn accepts(&self, nonce: u64) -> bool {
        if self.seen.contains(&nonce) {
            return false;
        }
        self.highest
            .is_none_or(|highest| nonce > highest || highest - nonce < REPLAY_WINDOW_SIZE)
    }

    fn record(&mut self, nonce: u64) {
        self.highest = Some(self.highest.map_or(nonce, |highest| highest.max(nonce)));
        self.seen.insert(nonce);
        if let Some(highest) = self.highest {
            let oldest = highest.saturating_sub(REPLAY_WINDOW_SIZE - 1);
            self.seen = self.seen.split_off(&oldest);
        }
    }
}

impl NoiseTransport {
    #[must_use]
    pub const fn remote_static_key(&self) -> [u8; 32] {
        self.remote_static_key
    }

    /// Encrypts one authenticated transport payload.
    ///
    /// # Errors
    ///
    /// Returns an error when the payload exceeds Noise limits or the cipher
    /// state rejects the operation.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        if plaintext.len() > MAX_TRANSPORT_PLAINTEXT {
            return Err("Noise transport plaintext exceeds its limit".into());
        }
        if self.send_nonce >= u64::from(u32::MAX) {
            return Err("Noise transport nonce is exhausted".into());
        }
        let wire_nonce = u32::try_from(self.send_nonce)
            .map_err(|_| "Noise transport nonce is exhausted".to_string())?;
        let mut out = vec![0_u8; TRANSPORT_NONCE_BYTES + plaintext.len() + 16];
        out[..TRANSPORT_NONCE_BYTES].copy_from_slice(&wire_nonce.to_be_bytes());
        let written = self
            .state
            .write_message(
                self.send_nonce,
                plaintext,
                &mut out[TRANSPORT_NONCE_BYTES..],
            )
            .map_err(|error| error.to_string())?;
        self.send_nonce += 1;
        out.truncate(TRANSPORT_NONCE_BYTES + written);
        Ok(out)
    }

    /// Decrypts and authenticates one transport message.
    ///
    /// # Errors
    ///
    /// Returns an error for oversized or unauthenticated ciphertext.
    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        if ciphertext.len() > MAX_HANDSHAKE_BYTES + TRANSPORT_NONCE_BYTES {
            return Err("Noise transport ciphertext exceeds its limit".into());
        }
        if ciphertext.len() < TRANSPORT_NONCE_BYTES + 16 {
            return Err("Noise transport ciphertext is truncated".into());
        }
        let nonce = u64::from(u32::from_be_bytes(
            ciphertext[..TRANSPORT_NONCE_BYTES]
                .try_into()
                .map_err(|_| "Noise transport nonce is truncated")?,
        ));
        if !self.replay_window.accepts(nonce) {
            return Err("Noise transport replay was rejected".into());
        }
        let encrypted = &ciphertext[TRANSPORT_NONCE_BYTES..];
        let mut out = vec![0_u8; encrypted.len()];
        let read = self
            .state
            .read_message(nonce, encrypted, &mut out)
            .map_err(|error| error.to_string())?;
        self.replay_window.record(nonce);
        out.truncate(read);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transport_pair() -> (NoiseTransport, NoiseTransport) {
        let params: snow::params::NoiseParams = NOISE_PATTERN.parse().expect("params");
        let initiator_key = snow::Builder::new(params.clone())
            .generate_keypair()
            .expect("initiator key");
        let responder_key = snow::Builder::new(params)
            .generate_keypair()
            .expect("responder key");
        let initiator_private: [u8; 32] = initiator_key.private.try_into().expect("key size");
        let responder_private: [u8; 32] = responder_key.private.try_into().expect("key size");
        let mut initiator =
            NoiseHandshake::new(NoiseRole::Initiator, &initiator_private).expect("initiator");
        let mut responder =
            NoiseHandshake::new(NoiseRole::Responder, &responder_private).expect("responder");

        let first = initiator.write(&[]).expect("first");
        responder.read(&first).expect("read first");
        let second = responder.write(&[]).expect("second");
        initiator.read(&second).expect("read second");
        let third = initiator.write(&[]).expect("third");
        responder.read(&third).expect("read third");

        (
            initiator.into_transport().expect("initiator transport"),
            responder.into_transport().expect("responder transport"),
        )
    }

    #[test]
    fn xx_handshake_authenticates_and_encrypts_both_directions() {
        let (mut initiator, mut responder) = transport_pair();
        let encrypted = initiator.encrypt(b"hello nearby").expect("encrypt");
        assert_ne!(encrypted, b"hello nearby");
        assert_eq!(
            responder.decrypt(&encrypted).expect("decrypt"),
            b"hello nearby"
        );

        let response = responder.encrypt(b"hello back").expect("encrypt response");
        assert_eq!(
            initiator.decrypt(&response).expect("decrypt response"),
            b"hello back"
        );
    }

    #[test]
    fn modified_transport_ciphertext_is_rejected() {
        let (mut initiator, mut responder) = transport_pair();
        let mut encrypted = initiator.encrypt(b"authenticated").expect("encrypt");
        encrypted[TRANSPORT_NONCE_BYTES] ^= 1;

        assert!(responder.decrypt(&encrypted).is_err());
    }

    #[test]
    fn transport_uses_explicit_big_endian_nonces() {
        let (mut initiator, mut responder) = transport_pair();
        let first = initiator.encrypt(b"zero").expect("first");
        let second = initiator.encrypt(b"one").expect("second");

        assert_eq!(&first[..TRANSPORT_NONCE_BYTES], &[0, 0, 0, 0]);
        assert_eq!(&second[..TRANSPORT_NONCE_BYTES], &[0, 0, 0, 1]);
        assert_eq!(responder.decrypt(&second).expect("second first"), b"one");
        assert_eq!(responder.decrypt(&first).expect("first second"), b"zero");
        assert!(responder.decrypt(&first).is_err());
    }
}
