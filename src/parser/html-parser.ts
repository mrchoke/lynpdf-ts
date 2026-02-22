import * as parse5 from 'parse5';

export class HTMLParser {
  /**
   * Parses an HTML string into a DOM tree using parse5.
   * @param html The HTML string to parse.
   * @returns The parsed Document object.
   */
  static parse(html: string): parse5.Document {
    return parse5.parse(html);
  }
}
