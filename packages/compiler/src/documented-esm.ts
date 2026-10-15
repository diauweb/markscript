import {mdxjsEsm, type Options} from 'micromark-extension-mdxjs-esm'
import type {Code, State, Tokenizer} from 'micromark-util-types'
import type {Processor} from 'unified'

export function remarkDocumentedEsm(this: Processor, options: Options): void {
  const esm = mdxjsEsm(options).flow?.[101]
  if (!esm) throw new Error('Expected the MDX export construct')
  const tokenize: Tokenizer = function (effects, ok, nok) {
    let dataOpen = false
    const start: State = (code) => {
      effects.enter('mdxjsEsm')
      return commentStart(code)
    }

    const complete: State = (code) => {
      effects.exit('mdxjsEsm')
      return ok(code)
    }

    const commentStart: State = (code) => {
      if (code !== 47) return nok(code)
      consume(code)
      return commentOpen
    }

    const commentOpen: State = (code) => {
      if (code !== 42) return nok(code)
      consume(code)
      return documentationOpen
    }

    const documentationOpen: State = (code) => {
      if (code !== 42) return nok(code)
      consume(code)
      return commentStar
    }

    const comment: State = (code) => {
      if (code === null) return nok(code)
      if (code < -2) return lineEnding(code, comment)
      consume(code)
      return code === 42 ? commentStar : comment
    }

    const commentStar: State = (code) => {
      if (code !== 47) return comment(code)
      consume(code)
      return afterComment
    }

    const afterComment: State = (code) => {
      if (code !== null && code < -2) return lineEnding(code, afterComment)
      if (code !== null && (code === 32 || code < 0)) {
        consume(code)
        return afterComment
      }
      if (code === 47) return commentStart(code)
      closeData()
      return effects.attempt(esm, complete, nok)(code)
    }

    function consume(code: Code): void {
      if (!dataOpen) {
        effects.enter('mdxjsEsmData')
        dataOpen = true
      }
      effects.consume(code)
    }

    function closeData(): void {
      if (dataOpen) effects.exit('mdxjsEsmData')
      dataOpen = false
    }

    function lineEnding(code: Code, next: State): State {
      closeData()
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return next
    }

    return this.interrupt || this.now().column !== 1 ? nok : start
  }

  const data = this.data()
  data.micromarkExtensions ??= []
  data.micromarkExtensions.push({
    flow: {
      47: {
        concrete: true,
        tokenize,
        resolve(events) {
          const outer = events[0]?.[1]
          return events.filter(
            ([, token]) => token.type !== 'mdxjsEsm' || token === outer,
          )
        },
      },
    },
  })
}
