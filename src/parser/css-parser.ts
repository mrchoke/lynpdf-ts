import * as cssTree from 'css-tree';

export class CSSParser {
  /**
   * Parses a CSS string into an Abstract Syntax Tree (AST) using css-tree.
   * @param css The CSS string to parse.
   * @returns The parsed CSS AST.
   */
  static parse(css: string): cssTree.CssNode {
    return cssTree.parse(css);
  }
}
