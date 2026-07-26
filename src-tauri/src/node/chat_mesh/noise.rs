const NOISE_PATTERN: &str = "Noise_XX_25519_ChaChaPoly_SHA256";
const MAX_HANDSHAKE_BYTES: usize = 65_535;
const MAX_TRANSPORT_PLAINTEXT: usize = 65_519;

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
            .into_transport_mode()
            .map_err(|error| error.to_string())?;
        Ok(NoiseTransport {
            state,
            remote_static_key,
        })
    }
}

pub struct NoiseTransport {
    state: snow::TransportState,
    remote_static_key: [u8; 32],
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
        let mut out = vec![0_u8; plaintext.len() + 16];
        let written = self
            .state
            .write_message(plaintext, &mut out)
            .map_err(|error| error.to_string())?;
        out.truncate(written);
        Ok(out)
    }

    /// Decrypts and authenticates one transport message.
    ///
    /// # Errors
    ///
    /// Returns an error for oversized or unauthenticated ciphertext.
    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        if ciphertext.len() > MAX_HANDSHAKE_BYTES {
            return Err("Noise transport ciphertext exceeds its limit".into());
        }
        let mut out = vec![0_u8; ciphertext.len()];
        let read = self
            .state
            .read_message(ciphertext, &mut out)
            .map_err(|error| error.to_string())?;
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
        encrypted[0] ^= 1;

        assert!(responder.decrypt(&encrypted).is_err());
    }
}
