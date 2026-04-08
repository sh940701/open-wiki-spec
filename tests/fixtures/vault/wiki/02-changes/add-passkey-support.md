---
type: change
id: add-passkey-support
status: proposed
created_at: "2024-03-15"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
  - "[[System: Identity]]"
systems:
  - "[[System: Identity]]"
sources: []
decisions:
  - "[[Decision: Use Passkeys]]"
tags:
  - auth
  - passkey
---

# Change: Add Passkey Support

## Why

Users need passwordless authentication via WebAuthn passkeys for improved security.

## Delta Summary

- ADDED requirement "Passkey Authentication" to [[Feature: Auth Login]] [base: n/a]
- MODIFIED requirement "Password Login" in [[Feature: Auth Login]] [base: sha256:def456abc]
- MODIFIED section "Current Behavior" in [[Feature: Auth Login]]: updated to reflect passkey support

## Proposed Update

Add WebAuthn passkey registration and authentication flows.

## Impact

- Identity system needs WebAuthn endpoint
- Frontend needs passkey UI components

## Design Approach

Use the WebAuthn standard with FIDO2 credentials.

## Tasks

- [x] Define passkey registration flow
- [ ] Implement WebAuthn endpoint
- [ ] Add passkey UI components
- [ ] Update session management for passkey auth

## Validation

- All scenarios pass
- Manual testing of passkey flow
