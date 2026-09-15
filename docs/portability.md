# Portability notes

The server currently supports native Windows only. `SessionStore` already receives a
small `KeyStore` interface with synchronous `getPassword`, `setPassword`, and
`deletePassword` operations. Tests use an in-memory implementation; production uses
`@napi-rs/keyring` with Windows Credential Manager.

A macOS or Linux port needs more than a replacement keychain adapter:

- implement `KeyStore` with Keychain Services or Secret Service and preserve the
  current no-plaintext-fallback behavior;
- choose a per-user application-data directory with restrictive permissions and
  preserve atomic writes and cross-process lifecycle locking;
- verify lock and file-permission behavior on the target filesystem;
- install and test the platform-specific Chromium build used for login and renewal;
- review native keyring packaging, CI coverage, logout semantics, and the threat model;
- update platform checks and documentation only after an end-to-end login, renewal,
  tool request, failure-recovery, and logout test on that operating system.

The MCP stdio protocol and Valence API layer are platform-neutral. Portability work
must not weaken encrypted storage, domain restrictions, session validation, or error
redaction.
