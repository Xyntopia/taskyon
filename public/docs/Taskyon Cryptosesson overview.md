# Taskyon Cryptosesson overview

All keys are unwrapped non-extractable in the browser.

Taskyon uses cryptoSessions (CS) to unlock user data and keep user data safe and e2e encrypted.

## keys

- device key (DK), automatically managed, device-bound, stored in indexeddb, non-extractable
- session unwrapper (KEK): automatically managed, derived from DK & User account
- session key (SK), automatically managed, used to encrypt user data, long-lived, but can be exchanged
- peer id (PK), automatically managed, ephemeral, used for p2p data exchange & identification
- backup phrase (BK) (forced and based on a seed mnemonic)
- user key (UK), used to sign user data, derived from BK
- session password (SP), used to unlock/unwrap SK in browser

## Taskyon.space additions

- user id (UID), UUID on taskyon.space
- taskyon api keys (TAK), provisioned by taskyon.space as JWT
- user id secret (UIS) set by taskyon inside user metadata and used to link a session key to a taskyon.space account.
- auid (AUID) from taskyon api keys an anomyized UID

## initialization

key sources: SP, DK, UIS

## OS version

- user opens taskyon
- SK is stored in localstorage, wrapped with DK.

### taskyon.space

- user logs in
- user gets UIS,

TODO:

- creates taskon.space specific CS
- activates the CS with taskyon.

### taskyon clients

- we want to protect taskyon data
- by default taskyon simply creates a new SK and encrypts/wraps data with it.

TODO:

- update/change with a SK. We need to be able to send SK to taskyon through the message channel.
- we ask taskyon for its peer ID.
- we use that peer ID together with our own client peer ID to derive a wrapping key. using ECDH/X25519.
- wrap SK.
- pass wrapped SK to taskyon.
- taskyon unwraps SK using its own peer ID & public peer ID from client.

## chain:

W(): wrap
D(): derive

BK -> W(UK)

DK, UID -> D(KEK) -> W(SK)

UK -> W(SK)

## notes

Session key is a long-lived key. But it should be possible to restore users data without it. Under normal circumstances, users should never have to
