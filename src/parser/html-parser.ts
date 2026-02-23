import type { DefaultTreeAdapterMap } from 'parse5'
import { parse } from 'parse5'

export class HTMLParser {
  /**
   * Parses an HTML string into a DOM tree using parse5.
   * @param html The HTML string to parse.
   * @returns The parsed Document object.
   */
  static parse (html: string): DefaultTreeAdapterMap['document'] {
    return parse(html)
  }
}
