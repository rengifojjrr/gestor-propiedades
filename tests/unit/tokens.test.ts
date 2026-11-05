/**
 * Ningún color escrito a mano fuera de src/styles/tokens.css: ni hex, ni rgb()/hsl(), ni valores
 * arbitrarios de Tailwind (bg-[#…]), ni la paleta por defecto (bg-red-500), que además está apagada.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../src');
const ALLOWED = new Set(['styles/tokens.css']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

const RULES: [RegExp, string][] = [
  [/#[0-9a-fA-F]{3,8}\b(?![\w-]*['"]?\s*:)/g, 'color hex'],
  [/\b(?:rgba?|hsla?|oklch|oklab)\(/g, 'función de color'],
  [/\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|shadow|accent|caret)-\[(?:#|rgb|hsl)/g, 'valor arbitrario de color'],
  [/\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/g, 'paleta por defecto de Tailwind'],
];

describe('tokens de diseño', () => {
  it('no hay colores escritos a mano en componentes', () => {
    const problems: string[] = [];
    for (const file of files(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // Las entidades HTML (&#39;) y los anclas (#contenido, #/ruta) no son colores.
        const clean = line.replace(/&#\d+;/g, '').replace(/['"`]#[\w/-]*['"`]/g, '').replace(/href="#\w+"/g, '');
        for (const [re, what] of RULES) {
          re.lastIndex = 0;
          if (re.test(clean)) problems.push(`${rel}:${i + 1} ${what}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('tokens.css define los colores de Stitch', () => {
    const css = readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8');
    for (const hex of ['#091426', '#1e293b', '#f8f9ff', '#006c49', '#6cf8bb', '#c88000', '#ffb95f', '#ba1a1a', '#ffdad6', '#c5c6cd'])
      expect(css.toLowerCase()).toContain(hex);
    expect(css).toContain('--color-*: initial');
    expect(css).toContain('Manrope');
  });
});
