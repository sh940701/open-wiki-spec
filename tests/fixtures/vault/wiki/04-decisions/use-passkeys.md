---
type: decision
id: use-passkeys
status: active
features:
  - "[[Feature: Auth Login]]"
changes:
  - "[[Change: Add Passkey Support]]"
tags:
  - auth
---

# Decision: Use Passkeys

## Context

Passwords are a weak authentication factor. WebAuthn passkeys provide phishing-resistant authentication.

## Decision

We will adopt WebAuthn passkeys as a primary authentication method alongside passwords.

## Consequences

- Need to implement WebAuthn registration/authentication flows
- Need to support credential storage in the identity system
