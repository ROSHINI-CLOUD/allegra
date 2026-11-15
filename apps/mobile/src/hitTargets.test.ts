import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Small presses reach the 48dp target (Control.target). A Tactile, Pressable or TouchableOpacity that takes a press and
 * styles itself under 48 needs a hitSlop that makes up the difference. This counts the ones that do not, per file,
 * against hitTargets.baseline.json. The ratchet works as in designGuards.test.ts: a file may not go above its number,
 * a file not listed must be zero, and a file below its number asks for the baseline to be lowered.
 */
const SRC = __dirname;
const BASELINE_FILE = path.join(SRC, 'hitTargets.baseline.json');
const UI_DIR = path.join(SRC, 'ui');
const TARGET = 48;
const PRESSABLES = new Set(['Tactile', 'Pressable', 'TouchableOpacity']);

interface Dims {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
}

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || full === UI_DIR ? [] : sourceFiles(full);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [full] : [];
  });

/** The numeric width, height and minimums of each entry in the file's StyleSheet.create. Tokens are ignored. */
const styleDimensions = (sourceFile: ts.SourceFile): Map<string, Dims> => {
  const dims = new Map<string, Dims>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'StyleSheet.create' && ts.isObjectLiteralExpression(node.arguments[0])) {
      for (const style of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(style) || !ts.isObjectLiteralExpression(style.initializer)) continue;
        const entry: Dims = {};
        for (const prop of style.initializer.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name) || !ts.isNumericLiteral(prop.initializer)) continue;
          const value = Number(prop.initializer.text);
          if (prop.name.text === 'width') entry.width = value;
          else if (prop.name.text === 'height') entry.height = value;
          else if (prop.name.text === 'minWidth') entry.minWidth = value;
          else if (prop.name.text === 'minHeight') entry.minHeight = value;
        }
        dims.set(style.name.getText(sourceFile), entry);
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return dims;
};

/** The StyleSheet keys a style attribute names directly: styles.X, or the styles.X entries of an array literal. */
const styleKeys = (attribute: ts.JsxAttribute, sourceFile: ts.SourceFile): string[] => {
  const value = attribute.initializer;
  if (!value || !ts.isJsxExpression(value) || !value.expression) return [];
  const keyOf = (node: ts.Expression): string[] =>
    ts.isPropertyAccessExpression(node) && node.expression.getText(sourceFile) === 'styles' ? [node.name.text] : [];
  return ts.isArrayLiteralExpression(value.expression) ? value.expression.elements.flatMap(keyOf) : keyOf(value.expression);
};

/** A width or height under the target, with no minimum that reaches it. */
const isSmall = (dims: Dims): boolean => {
  const short = [dims.width, dims.height].some(v => v !== undefined && v < TARGET);
  const guarded = [dims.minWidth, dims.minHeight].some(v => v !== undefined && v >= TARGET);
  return short && !guarded;
};

/** How many pressables in this file take a press through a small style with no hitSlop. */
const countSmallPressables = (sourceFile: ts.SourceFile): number => {
  const dims = styleDimensions(sourceFile);
  let count = 0;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && PRESSABLES.has(node.tagName.getText(sourceFile))) {
      const attributes = node.attributes.properties.filter((p): p is ts.JsxAttribute => ts.isJsxAttribute(p));
      const named = (name: string) => attributes.find(a => a.name.getText(sourceFile) === name);
      const style = named('style');
      if (named('onPress') && !named('hitSlop') && style && styleKeys(style, sourceFile).some(key => {
        const entry = dims.get(key);
        return entry !== undefined && isSmall(entry);
      })) {
        count += 1;
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return count;
};

const countInText = (text: string): number =>
  countSmallPressables(ts.createSourceFile('inline.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));

const countAll = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const n = countSmallPressables(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
    if (n > 0) counts[path.relative(SRC, file).split(path.sep).join('/')] = n;
  }
  return counts;
};

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Record<string, number>;

describe('hit targets', () => {
  it('counts a 30dp pressable that has no slop', () => {
    expect(countInText('const styles = StyleSheet.create({ dot: { width: 30, height: 30 } }); const v = <Tactile onPress={f} style={styles.dot} />;')).toBe(1);
  });

  it('accepts the same pressable once it has a hitSlop', () => {
    expect(countInText('const styles = StyleSheet.create({ dot: { width: 30, height: 30 } }); const v = <Tactile onPress={f} hitSlop={9} style={styles.dot} />;')).toBe(0);
  });

  it('ignores token sizes and pressables that only take a long press', () => {
    expect(countInText('const styles = StyleSheet.create({ dot: { width: Space.lg, height: Space.lg } }); const v = <Tactile onPress={f} style={styles.dot} />;')).toBe(0);
    expect(countInText('const styles = StyleSheet.create({ dot: { width: 30, height: 30 } }); const v = <Tactile onLongPress={f} style={styles.dot} />;')).toBe(0);
  });

  it('no file goes above its baseline, and the baseline only shrinks', () => {
    const counts = countAll();
    const over: string[] = [];
    const under: string[] = [];
    for (const [file, n] of Object.entries(counts)) {
      const max = baseline[file] ?? 0;
      if (n > max) over.push(`${file}: ${n} (allowed ${max})`);
    }
    for (const [file, max] of Object.entries(baseline)) {
      const n = counts[file] ?? 0;
      if (n < max) under.push(`${file}: ${n} (baseline ${max}) — lower it in hitTargets.baseline.json`);
    }
    expect({ over }).toEqual({ over: [] });
    expect({ under }).toEqual({ under: [] });
  });
});
