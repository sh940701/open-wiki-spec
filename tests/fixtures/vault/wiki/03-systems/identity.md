---
type: system
id: identity-system
status: active
tags:
  - auth
  - identity
---

# System: Identity

## Purpose

Manages user authentication, authorization, and session lifecycle.

## Components

- Auth service (Node.js)
- Session store (Redis)
- User database (PostgreSQL)

## Interfaces

- REST API for login/logout
- WebSocket for session notifications
