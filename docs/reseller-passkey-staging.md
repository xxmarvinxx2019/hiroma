# Reseller passkey staging checklist

Passkeys are an opt-in reseller staging feature. Password sign-in remains the recovery path.

## Required configuration

- Serve staging over HTTPS.
- Set `PASSKEY_ORIGIN` to the exact staging origin.
- Set `PASSKEY_RP_ID` to that origin's hostname.
- Set `PASSKEY_RP_NAME` to the displayed relying-party name.
- Enable `passkey_test_enabled` for one designated reseller test account only.

## Credential reset required after Scope 5

Credentials registered before discoverable credentials became mandatory are not supported. Remove every pre-Scope-5 staging passkey from the reseller Security Settings page and register it again. There is no legacy compatibility path.

## Real-device verification

1. Sign in with the test reseller's password.
2. Register a passkey and confirm the current password when prompted.
3. Sign out, enter the reseller username, and use Face ID, fingerprint, or the device PIN.
4. Repeat on a second supported device and confirm both devices are listed.
5. Confirm an unknown username receives the same public options shape and generic failure behavior.
6. Confirm payouts and reseller payment-method changes still require the configured Hiroma security PIN.
7. Reset the reseller password and confirm all old sessions and passkeys stop working.

Do not enable production accounts until the database migration is explicitly approved and applied, staging evidence is complete, and rollback has been tested.
