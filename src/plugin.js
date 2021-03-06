import { stripIndent } from 'common-tags';
import { outputFileSync } from 'fs-extra';
import camelCase from 'lodash/camelCase';
import get from 'lodash/get';
import kebabCase from 'lodash/kebabCase';
import { dirname, extname, basename, join, relative } from 'path';
import * as t from '@babel/types';
import template from '@babel/template';
import generate from '@babel/generator';

const buildImport = template('require(FILENAME);');
const buildComponent = template(
  `styled(TAGNAME, OPTIONS, DISPLAYNAME, IMPORT, KEBABNAME, CAMELNAME)`,
);

const STYLES = Symbol('Astroturf');

function getIdentifier(path) {
  const parent = path.findParent(p => p.isVariableDeclarator());
  return parent && t.isIdentifier(parent.node.id) ? parent.node.id.name : '';
}

function wrapInClass(className, value) {
  const imports = [];

  let match;
  const matcher = /@import.*?(?:$|;)/g;

  // eslint-disable-next-line no-cond-assign
  while ((match = matcher.exec(value))) {
    imports.push(match[0]);
  }

  value = value.replace(matcher, '');

  let val = `${className} {\n${value}\n}`;
  if (imports.length) val = `${imports.join('\n')}\n${val}`;
  return val;
}

function createFileName(hostFile, { extension = '.css' }, id) {
  const base = basename(hostFile, extname(hostFile));
  return join(dirname(hostFile), `${base}-${id}${extension}`);
}

function isCssTag(path, tagName, allowGlobal = false) {
  return (
    path.get('tag').node.name === tagName &&
    (path.get('tag').referencesImport('astroturf') ||
      (allowGlobal && path.scope.hasGlobal(tagName)))
  );
}

const isStyledTag = (path, styledTag, allowGlobal) => {
  const { node } = path.get('tag');
  return (
    t.isCallExpression(node) &&
    node.callee.name === styledTag &&
    (allowGlobal || path.get('tag.callee').referencesImport('astroturf'))
  );
};

const isStyledTagShorthand = (path, styledTag, allowGlobal) =>
  t.isMemberExpression(path.get('tag').node) &&
  t.isIdentifier(path.get('tag.property').node) &&
  path.get('tag.object').node.name === styledTag &&
  (allowGlobal || path.get('tag.object').referencesImport('astroturf'));

export default function plugin() {
  function evaluate(path) {
    const { confident, value } = path.evaluate();

    if (!confident) {
      throw path.buildCodeFrameError(
        'Could not evaluate css. Inline styles must be statically analyzable',
      );
    }
    return value;
  }

  function createStyleNode(path, { opts, file }, identifier) {
    const { start, end } = path.node;
    const style = { start, end };
    const getFileName = opts.getFileName || createFileName;

    const hostFile = file.opts.filename;
    style.path = getFileName(hostFile, opts, identifier);

    let filename = relative(dirname(hostFile), style.path);
    if (!filename.startsWith('.')) {
      filename = `./${filename}`;
    }
    style.filename = filename;
    style.identifier = identifier;

    return style;
  }

  function buildStyleRequire(path, state) {
    const { styles } = state.file.get(STYLES);
    const quasiPath = path.get('quasi');
    const style = createStyleNode(path, state, getIdentifier(path));
    style.value = evaluate(quasiPath);

    style.code = `require('${style.filename}')`;

    styles.add(style);
    return buildImport({ FILENAME: t.StringLiteral(style.filename) }); // eslint-disable-line new-cap
  }

  function buildStyledComponent(path, tagName, options, state) {
    const cssState = state.file.get(STYLES);
    const displayName = getIdentifier(path) || tagName.value;

    const style = createStyleNode(path, state, displayName);
    style.tagName = t.isStringLiteral(tagName)
      ? `"${tagName.value}"`
      : tagName;

    const kebabName = kebabCase(displayName);
    style.value = wrapInClass(`.${kebabName}`, evaluate(path.get('quasi')));

    const runtimeNode = buildComponent({
      TAGNAME: tagName,
      OPTIONS: options || t.NullLiteral(),
      DISPLAYNAME: t.StringLiteral(displayName),
      IMPORT: buildImport({
        FILENAME: t.StringLiteral(style.filename),
      }).expression,
      KEBABNAME: t.StringLiteral(kebabName),
      CAMELNAME: t.StringLiteral(camelCase(kebabName)),
    });

    if (state.opts.generateInterpolations)
      style.code = generate(runtimeNode).code;

    cssState.styles.add(style);
    return runtimeNode;
  }

  return {
    pre(file) {
      if (!file.has(STYLES)) {
        file.set(STYLES, {
          id: 0,
          styles: new Set(),
        });
      }
    },

    post(file) {
      const { opts } = this;

      let { styles } = file.get(STYLES);
      styles = Array.from(styles.values());

      file.metadata.astroturf = { styles };

      if (opts.writeFiles !== false) {
        styles.forEach(({ path, value }) => {
          outputFileSync(path, stripIndent([value]));
        });
      }
    },

    visitor: {
      TaggedTemplateExpression(path, state) {
        const {
          tagName = 'css',
          allowGlobal = true,
          styledTag = 'styled',
        } = state.opts;

        if (isStyledTag(path, styledTag, allowGlobal)) {
          const componentType = get(path.get('tag'), 'node.arguments[0]');
          const options = get(path.get('tag'), 'node.arguments[1]');

          path.replaceWith(
            buildStyledComponent(path, componentType, options, state),
          );
          path.addComment('leading', '#__PURE__');

          // styled.button` ... `
        } else if (isStyledTagShorthand(path, styledTag, allowGlobal)) {
          const componentType = t.StringLiteral(
            path.get('tag.property').node.name,
          );

          path.replaceWith(
            buildStyledComponent(path, componentType, null, state),
          );
          path.addComment('leading', '#__PURE__');

          // lone css`` tag
        } else if (isCssTag(path, tagName, allowGlobal)) {
          path.replaceWith(buildStyleRequire(path, state));
          path.addComment('leading', '#__PURE__');
        }
      },
    },
  };
}
