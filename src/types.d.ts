declare module 'fontkit' {
  export interface Font {
    unitsPerEm: number
    ascent: number
    descent: number
    lineGap: number
    layout (text: string): { advanceWidth: number; glyphs: any[] }
  }

  export function openSync (path: string): Font
}

declare module 'svg-to-pdfkit' {
  function SVGtoPDF (
    doc: any,
    svg: string,
    x: number,
    y: number,
    options?: {
      width?: number
      height?: number
      preserveAspectRatio?: string
    }
  ): void
  export default SVGtoPDF
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'
  interface TaskListsOptions {
    enabled?: boolean
    label?: boolean
    labelAfter?: boolean
  }
  function taskListPlugin (md: MarkdownIt, options?: TaskListsOptions): void
  export default taskListPlugin
}
