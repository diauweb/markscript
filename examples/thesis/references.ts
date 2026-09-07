import type {DocxBibliographySource} from '@markscript/docx'

export const thesisReferences = [
  {
    id: 'reference-journal',
    title:
      'XXXXX, XXXXX. XXXXXXXXXXXXXXXXXXXX[J]. XXXXX期刊, 202X, XX(X): 12-34.',
  },
  {
    id: 'reference-conference',
    title:
      'XXXXX. XXXXXXXXXXXXXXXXXXXX[C]//XXXXX会议论文集. XXXXX: XXXXX出版社, 202X: 35-48.',
  },
  {
    id: 'reference-book',
    title: 'XXXXX. XXXXXXXXXXXXXXXXXXXX[M]. 第X版. XXXXX: XXXXX出版社, 202X.',
  },
  {
    id: 'reference-thesis',
    title: 'XXXXX. XXXXXXXXXXXXXXXXXXXX[D]. XXXXX: XXXXX大学, 202X.',
  },
  {
    id: 'reference-online',
    title:
      'XXXXX. XXXXXXXXXXXXXXXXXXXX[EB/OL]. https://xxxxx.example/xxxxx, 202X-XX-XX.',
  },
] as const satisfies DocxBibliographySource
