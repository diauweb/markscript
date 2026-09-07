import {
  getManual,
  listManuals,
  MANUAL_CATEGORIES,
  type ManualCategory,
  type ManualDocument,
} from '@markscript/manuals'
import type {
  SiteDefinition,
  SiteNavigationSection,
  SitePage,
} from '@markscript/msdocs'

const site = {
  title: 'MarkScript Manual',
  home: manualPage(requiredManual('')),
  sections: MANUAL_CATEGORIES.map(manualSection),
} satisfies SiteDefinition

export default site

function manualSection(category: ManualCategory): SiteNavigationSection {
  const index = requiredManual(category)
  return {
    title: index.title,
    pages: [
      manualPage(index),
      ...listManuals(category).map(({selector}) =>
        manualPage(requiredManual(selector)),
      ),
    ],
  }
}

function requiredManual(selector: string): ManualDocument {
  const document = getManual(selector)
  if (document === undefined) {
    throw new Error(`Manual catalog is missing ${JSON.stringify(selector)}`)
  }
  return document
}

function manualPage(document: ManualDocument): SitePage {
  return {
    path:
      document.selector === ''
        ? ''
        : document.kind === 'index'
          ? `${document.selector}/`
          : `${document.category}/${document.selector}`,
    title:
      document.kind === 'page'
        ? `${document.selector} — ${document.title}`
        : document.title,
    root: document.root,
  }
}
