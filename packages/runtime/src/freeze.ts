/** Deeply freeze a document graph without recursing forever through metadata cycles. */
export function deepFreeze<T>(value: T): T {
  assertDeepFreezable(value, new WeakSet<object>())
  freezeValue(value, new WeakSet<object>())
  return value
}

function assertDeepFreezable(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null) {
    if (typeof value === 'function') {
      throw new TypeError(
        'functions lie outside deeply read-only document data',
      )
    }
    return
  }
  if (seen.has(value)) return
  seen.add(value)

  const prototype = Object.getPrototypeOf(value) as unknown
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new TypeError(
      `opaque ${value.constructor?.name ?? 'object'} values lie outside deeply read-only document data`,
    )
  }

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined) continue
    if (!('value' in descriptor)) {
      throw new TypeError(
        'accessor properties lie outside deeply read-only document data',
      )
    }
    assertDeepFreezable(descriptor.value, seen)
  }
}

function freezeValue(value: unknown, seen: WeakSet<object>): void {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return
  }
  if (seen.has(value)) return
  seen.add(value)

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor !== undefined && 'value' in descriptor) {
      freezeValue(descriptor.value, seen)
    }
  }
  Object.freeze(value)
}
