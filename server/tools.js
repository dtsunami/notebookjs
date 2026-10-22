import {
  getSlides,
  listSlides,
  readSlide,
  replaceInSlide,
  insertSlide,
  deleteSlide,
  moveSlide,
  setDeckStyle,
  getDeckStyle,
} from './doc.js';
import * as cells from './cells.js';
import * as browser from './browser.js';

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_slides',
      description: 'List every slide in the deck with its id and a short text preview. Call this first.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_slide',
      description: 'Return the exact HTML of one slide. Call before editing it.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Slide id, e.g. "s2".' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_deck_html',
      description: 'Return the entire document. Large — use only when list_slides and read_slide are insufficient.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_slide',
      description:
        'Replace exact text inside one slide. "old" must match the slide HTML byte for byte and occur exactly once in that slide; extend it with surrounding lines to make it unique.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          old: { type: 'string', description: 'Exact existing text, including indentation.' },
          new: { type: 'string', description: 'Replacement text.' },
        },
        required: ['id', 'old', 'new'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_slide',
      description: 'Add a new slide. The markup must carry class="slide" on its outer element. Placement defaults to the end.',
      parameters: {
        type: 'object',
        properties: {
          after: { type: 'string', description: 'Insert after this slide id.' },
          before: { type: 'string', description: 'Insert before this slide id.' },
          content: { type: 'string', description: 'Full slide HTML.' },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_slide',
      description: 'Remove a slide. Refuses to delete the last remaining slide.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_slide',
      description: 'Reorder a slide relative to another.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          after: { type: 'string' },
          before: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_deck_style',
      description: 'Replace the deck-overrides CSS block. Use for deck-wide styling the user asked for. Do not edit theme variables.',
      parameters: { type: 'object', properties: { css: { type: 'string' } }, required: ['css'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_deck_style',
      description: 'Return the current deck-overrides CSS.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_cells',
      description:
        'List every cell with its id, language, the slide it belongs to, and a preview of its source.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_cell',
      description: 'Return the exact source of one cell. Call before editing it.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cell id, e.g. "c1".' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_cell',
      description:
        'Add a notebook cell to a slide, at a position you choose. The id is assigned for you and returned. Creating a cell does not run it: only the human executes cells, and you have no tool that can. Pass `box` to place it (see list_cells for where existing cells sit); omit it and the cell lands at a default position that may overlap other content. Never hand-write a <script type="text/nb-cell"> tag.',
      parameters: {
        type: 'object',
        properties: {
          slideId: {
            type: 'string',
            description: 'Slide to place the cell in. Defaults to the last slide.',
          },
          source: {
            type: 'string',
            description:
              'Cell source. For javascript it runs as a function receiving `cell`; for other languages it is the plain program body.',
          },
          lang: {
            type: 'string',
            enum: ['javascript', 'typescript', 'python', 'ruby'],
            description: 'Kernel language. Defaults to javascript.',
          },
          box: {
            type: 'object',
            description:
              'Where the cell sits on the slide, in percent of the slide (0-100). Omit for the default placement. Give all four or none. A cell under a heading would be x=6, y=34, w=88, h=48; a full-width footer x=6, y=84, w=88, h=13. Leave room for the heading above and keep within 6-94.',
            properties: {
              x: { type: 'number', description: 'Left edge, percent.' },
              y: { type: 'number', description: 'Top edge, percent.' },
              w: { type: 'number', description: 'Width, percent.' },
              h: { type: 'number', description: 'Height, percent.' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
          },
        },
        required: ['source'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_cell',
      description:
        'Replace the entire source of an existing cell, and optionally move it. Call read_cell first if you need to preserve part of it. Does not run the cell.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          source: { type: 'string' },
          box: {
            type: 'object',
            description:
              'New placement in percent of the slide. Omit to leave the cell where it is.',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
          },
        },
        required: ['id', 'source'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_cell',
      description: 'Remove a JavaScript cell from the deck.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Render the deck (or one slide) in a real browser and return a PNG. Use to verify layout after design changes.',
      parameters: { type: 'object', properties: { slideId: { type: 'string' } }, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_dom',
      description: 'Return matched elements with computed styles and bounding boxes. Use to inspect rendered output.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string' }, slideId: { type: 'string' }, limit: { type: 'integer' } },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eval_js',
      description: 'Evaluate a single JS expression in the rendered page and return its value. Must be an expression, not statements.',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string' }, slideId: { type: 'string' } },
        required: ['expression'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'probe',
      description: 'Report elements overflowing the viewport or clipped by overflow:hidden. Use to catch broken slide layouts.',
      parameters: { type: 'object', properties: { slideId: { type: 'string' } }, additionalProperties: false },
    },
  },
];

const MUTATING = new Set([
  'replace_in_slide',
  'insert_slide',
  'delete_slide',
  'move_slide',
  'set_deck_style',
  'create_cell',
  'update_cell',
  'delete_cell',
]);

export const isMutating = (name) => MUTATING.has(name);

async function playwrightGuard(fn) {
  try {
    return await fn();
  } catch (err) {
    if (/Playwright is not available/.test(String(err && err.message))) {
      return { error: err.message };
    }
    throw err;
  }
}

/**
 * Execute one tool call.
 * @returns {Promise<{html?: string, text: string, image?: string}>}
 */
export async function executeTool(name, args, html) {
  const a = args || {};

  switch (name) {
    case 'list_slides': {
      const slides = listSlides(html);
      return {
        text: slides.length
          ? slides.map((s) => `${s.id} (index ${s.index}, ${s.chars} chars): ${s.preview}`).join('\n')
          : 'The deck has no slides yet.',
      };
    }

    case 'read_slide': {
      const r = readSlide(html, a.id);
      if (r.error) return { text: r.error };
      return { text: r.html };
    }

    case 'get_deck_html':
      return { text: html };

    case 'replace_in_slide': {
      const r = replaceInSlide(html, a.id, a.old, a.new);
      if (r.error) return { text: r.error };
      return { html: r.html, text: `Updated slide ${a.id}. ${getSlides(r.html).length} slides in deck.` };
    }

    case 'insert_slide': {
      const r = insertSlide(html, { after: a.after, before: a.before, content: a.content });
      if (r.error) return { text: r.error };
      return { html: r.html, text: `Slide inserted. ${getSlides(r.html).length} slides in deck.` };
    }

    case 'delete_slide': {
      const r = deleteSlide(html, a.id);
      if (r.error) return { text: r.error };
      return { html: r.html, text: `Deleted slide ${a.id}. ${getSlides(r.html).length} slides remain.` };
    }

    case 'move_slide': {
      const r = moveSlide(html, a.id, { after: a.after, before: a.before });
      if (r.error) return { text: r.error };
      return { html: r.html, text: `Moved slide ${a.id}.` };
    }

    case 'set_deck_style': {
      const r = setDeckStyle(html, a.css);
      return { html: r.html, text: 'Deck overrides CSS updated.' };
    }

    case 'get_deck_style':
      return { text: getDeckStyle(html) || '(deck-overrides is empty)' };

    case 'list_cells': {
      const list = cells.listCells(html);
      // Geometry is printed because placement is how a cell is laid out on the
      // slide; two cells at the same x/y are on top of each other, and that is
      // the most common layout mistake to catch.
      const where = (b) => (b ? `x${b.x} y${b.y} w${b.w} h${b.h}` : 'flow');
      return {
        text: list.length
          ? list
              .map(
                (c) =>
                  `${c.id} (slide ${c.slideId}, ${c.lang}, ${where(c.box)}, ${c.chars} chars): ${c.preview}`,
              )
              .join('\n')
          : 'The deck has no cells yet.',
      };
    }

    case 'read_cell': {
      const r = cells.readCell(html, a.id);
      if (r.error) return { text: r.error };
      return { text: r.source };
    }

    case 'create_cell': {
      const r = cells.createCell(html, { slideId: a.slideId, source: a.source, lang: a.lang, box: a.box });
      if (r.error) return { text: r.error };
      const where = a.box
        ? ` at ${a.box.x}%,${a.box.y}% (${a.box.w}%x${a.box.h}%)`
        : ' at the default position';
      return {
        html: r.html,
        text: `Created ${r.lang} cell ${r.id} in slide ${r.slideId || '(end of document)'}${where}. It has not run.`,
      };
    }

    case 'update_cell': {
      const r = cells.updateCell(html, { id: a.id, box: a.box }, a.source);
      if (r.error) return { text: r.error };
      return { html: r.html, text: `Updated cell ${r.id}.` };
    }

    case 'delete_cell': {
      const r = cells.deleteCell(html, { id: a.id });
      if (r.error) return { text: r.error };
      return { html: r.html, text: `Deleted cell ${r.id}.` };
    }

    case 'screenshot':
      return playwrightGuard(async () => {
        const r = await browser.screenshot(html, a.slideId);
        const note = r.errors.length ? `\nPage errors: ${r.errors.join(' | ')}` : '';
        return { image: r.dataUrl, text: `Screenshot of ${a.slideId || 'first slide'} at 1280x720.${note}` };
      });

    case 'query_dom':
      return playwrightGuard(async () => {
        const r = await browser.queryDom(html, a.slideId, a.selector, a.limit || 1);
        return { text: JSON.stringify(r.value, null, 2) };
      });

    case 'eval_js':
      return playwrightGuard(async () => {
        const r = await browser.runExpression(html, a.slideId, a.expression);
        return { text: JSON.stringify(r.value) };
      });

    case 'probe':
      return playwrightGuard(async () => {
        const r = await browser.probe(html, a.slideId);
        return { text: JSON.stringify(r.value, null, 2) };
      });

    default:
      return { text: `Unknown tool "${name}".` };
  }
}