# Taskyon Cryptosesson overview

All keys are unwrapped non-extractable in the browser.

# keys

- device key (DK), automatically managed, device-bound, stored in indexeddb, non-extractable
- session unwrapper (KEK): automatically managed, derived from DK & User account
- session key (SK), automatically managed, used to encrypt user data, long-lived, but can be exchanged
- peer id (PK), automatically managed, ephemeral, used for p2p data exchange & identification
- backup phrase (BK) (forced and based on a seed mnemonic)
- user key (UK), used to sign user data, derived from BK

## Taskyon.space additions

- user id (UID), UUID on taskyon.space
- taskyon keys (TYK), provisioned by taskyon.space as JWT

## chain:

W(): wrap
D(): derive

BK -> W(UK)

DK, UID -> D(KEK) -> W(SK)

UK -> W(SK)

## notes

Session key is a long-lived key. But it should be possible to restore users data without it. Under normal circumstances, users should never have to
