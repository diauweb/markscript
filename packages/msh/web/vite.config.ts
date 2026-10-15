import tailwindcss from '@tailwindcss/vite'
import {defineConfig} from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      checks: {moduleLevelDirective: false},
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'markdown',
              test: /react-markdown|remark|mdast|micromark|hast|unist|unified|vfile|property-information/,
            },
            {name: 'ui', test: /node_modules\//},
          ],
        },
      },
    },
  },
})
