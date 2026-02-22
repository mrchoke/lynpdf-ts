export class ColorParser {
  static parse(colorStr: string): { color: string, opacity: number } | null {
    if (!colorStr) return null;
    
    colorStr = colorStr.trim().toLowerCase();
    
    if (colorStr === 'transparent' || colorStr === 'none') {
      return null;
    }

    // Hex
    if (colorStr.startsWith('#')) {
      return { color: colorStr, opacity: 1 };
    }

    // RGB / RGBA
    if (colorStr.startsWith('rgb')) {
      const match = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
      if (match) {
        const r = parseInt(match[1]!, 10);
        const g = parseInt(match[2]!, 10);
        const b = parseInt(match[3]!, 10);
        const a = match[4] ? parseFloat(match[4]) : 1;
        // Convert to hex string so PDFKit accepts it without casting
        const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        return { color: hex, opacity: a };
      }
    }

    // Named colors (PDFKit supports standard CSS color names)
    return { color: colorStr, opacity: 1 };
  }
}
