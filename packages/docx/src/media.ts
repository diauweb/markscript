import {Resvg} from '@resvg/resvg-js'
import type {Image, Nodes, Paragraph, Parent} from 'mdast'

export function svgImage(
  parent: Parent,
  svg: string,
  options: {
    alt: string
    width: number
    height: number
    fallback?: Uint8Array
  },
): Nodes {
  const image: Image = {
    type: 'image',
    url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    alt: options.alt,
    data: {
      docx: {
        image: {
          type: 'svg',
          transformation: {width: options.width, height: options.height},
          ...(options.fallback === undefined
            ? {}
            : {
                fallback: `data:image/png;base64,${Buffer.from(options.fallback).toString('base64')}`,
              }),
          altText: {
            name: options.alt,
            description: options.alt,
            title: options.alt,
          },
        },
      },
    },
  }
  if (isPhrasingParent(parent)) return image
  const paragraph: Paragraph = {type: 'paragraph', children: [image]}
  return paragraph
}

export function rasterizedSvgImage(
  parent: Parent,
  svg: string,
  options: {alt: string; width: number; height: number; pixelRatio: number},
): Nodes {
  const png = renderSvgPng(svg, {pixelRatio: options.pixelRatio})
  const image: Image = {
    type: 'image',
    url: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    alt: options.alt,
    data: {
      docx: {
        image: {
          type: 'png',
          transformation: {width: options.width, height: options.height},
          altText: {
            name: options.alt,
            description: options.alt,
            title: options.alt,
          },
        },
      },
    },
  }
  if (isPhrasingParent(parent)) return image
  const paragraph: Paragraph = {type: 'paragraph', children: [image]}
  return paragraph
}

export function renderSvgPng(
  svg: string,
  options: {
    pixelRatio?: number
    fontFiles?: readonly string[]
  } = {},
): Uint8Array {
  const pixelRatio = options.pixelRatio ?? 1
  return new Resvg(svg, {
    ...(pixelRatio === 1
      ? {}
      : {fitTo: {mode: 'zoom' as const, value: pixelRatio}}),
    ...(options.fontFiles === undefined
      ? {}
      : {
          font: {
            fontFiles: [...options.fontFiles],
            loadSystemFonts: false,
          },
        }),
  })
    .render()
    .asPng()
}

function isPhrasingParent(parent: Parent): boolean {
  return (
    parent.type === 'paragraph' ||
    parent.type === 'heading' ||
    parent.type === 'emphasis' ||
    parent.type === 'strong' ||
    parent.type === 'delete' ||
    parent.type === 'link' ||
    parent.type === 'linkReference' ||
    parent.type === 'tableCell' ||
    parent.type === 'textDirective'
  )
}
