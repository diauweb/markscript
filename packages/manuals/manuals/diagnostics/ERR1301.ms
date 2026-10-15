# ERR1301 — Lifecycle API is used outside its valid phase

## Problem

This code reports one of these lifecycle API errors:

- `onTransform`, `onReady`, or `executeDocument` received a value of an incorrect type.
- Code called `onTransform` or `onReady` outside an active document render.
- Code called `onTransform` or `onReady` during the transform, ready, or closed phase of a document lifetime.

## Fix

Pass a function to each lifecycle API.
Register `onTransform` and `onReady` callbacks during document body rendering, before the transform phase starts.
Move these registrations outside transform and ready callbacks.