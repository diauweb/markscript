import {inspect, wait} from 'msh/kernel'

/** A code thread waits for one message, returns its result, and ends. */
export default async function worker() {
  const received = await wait()
  return {thread: inspect().id, received: received.messages}
}
