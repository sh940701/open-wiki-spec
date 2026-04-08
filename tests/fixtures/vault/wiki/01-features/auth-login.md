---
type: feature
id: auth-login
status: active
tags:
  - auth
  - security
systems:
  - "[[System: Identity]]"
sources: []
decisions:
  - "[[Decision: Use Passkeys]]"
changes:
  - "[[Change: Add Passkey Support]]"
---

# Feature: Auth Login

## Purpose

Provides authentication for users via password and passkey methods.

## Current Behavior

Users can log in with email and password. Sessions are managed via JWT tokens.

## Constraints

- Must support TOTP 2FA
- Must rate-limit login attempts

## Known Gaps

- No passkey support yet

## Requirements

### Requirement: Password Login

The system SHALL allow users to authenticate using email and password credentials.

#### Scenario: Successful login

WHEN a user submits valid email and password
THEN the system returns a JWT session token
AND the user is redirected to the dashboard

#### Scenario: Invalid password

WHEN a user submits valid email but wrong password
THEN the system returns a 401 error
AND increments the failed attempt counter

### Requirement: Session Management

The system MUST issue JWT tokens with a maximum lifetime of 24 hours.

#### Scenario: Token expiry

WHEN a JWT token is older than 24 hours
THEN the system rejects the token
AND requires re-authentication

## Related Notes

- [[System: Identity]]
- [[Decision: Use Passkeys]]
