import type {SiteDefinition} from '../../src/site.ts'

export default {
  title: 'Fixture documentation',
  home: {
    path: '',
    title: 'Fixture home',
    root: {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{type: 'text', value: 'Fixture home'}],
        },
      ],
    },
  },
  sections: [],
} satisfies SiteDefinition
