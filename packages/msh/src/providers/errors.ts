import {AiError} from 'effect/unstable/ai'
import {HttpClientError} from 'effect/unstable/http'

function httpError(status: number): Error {
  return new Error(
    `Provider HTTP ${status}${status === 401 || status === 403 ? ': authentication rejected; run msh login to update this profile' : ''}`,
  )
}

export function providerError(error: unknown): unknown {
  if (AiError.isAiError(error)) {
    const reason = error.reason
    const status = 'http' in reason ? reason.http?.response?.status : undefined
    return status === undefined
      ? new Error(`Provider ${reason._tag}`)
      : httpError(status)
  }
  if (HttpClientError.isHttpClientError(error))
    return error.reason._tag === 'StatusCodeError'
      ? httpError(error.reason.response.status)
      : new Error(`Provider ${error.reason._tag}`)
  return error
}
