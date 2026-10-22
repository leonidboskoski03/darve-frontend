import path from 'node:path';

const layers = {
  app: ['routes', 'features', 'entities', 'services', 'design-system', 'motion', 'shared'],
  routes: ['features', 'entities', 'services', 'design-system', 'motion', 'shared'],
  features: ['entities', 'services', 'design-system', 'motion', 'shared'],
  entities: ['services', 'shared'],
  services: ['shared'],
  'design-system': ['shared'],
  motion: ['design-system', 'shared'],
  shared: [],
};

const normalize = (value) => value.replaceAll('\\', '/');

function location(filename) {
  const value = normalize(filename);
  const offset = value.lastIndexOf('/src/');
  if (offset === -1) return null;
  const root = value.slice(0, offset + 5);
  const relative = value.slice(offset + 5);
  const [layer, slice] = relative.split('/');
  return { root, relative, layer, slice };
}

export const architectureRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce Darve layer, slice, public entry and infrastructure boundaries.',
    },
    schema: [],
    messages: { boundary: '{{reason}}' },
  },
  create(context) {
    const from = location(context.filename);
    if (!from) return {};
    const report = (node, reason) =>
      context.report({ node, messageId: 'boundary', data: { reason } });

    function inspect(node, source) {
      if (typeof source !== 'string') {
        report(node, 'Imports must use a static module path so architecture can be checked.');
        return;
      }
      if (
        ['entities', 'services', 'shared'].includes(from.layer) &&
        (source === 'react' || source === 'react-dom' || source.startsWith('react/'))
      ) {
        report(node, 'Framework UI belongs above pure entities, services and shared utilities.');
      }
      if (
        (source === 'react-router-dom' || source === 'react-router') &&
        !['app', 'routes'].includes(from.layer)
      ) {
        report(
          node,
          'Routing is composed in app/ and routes/; pass navigation intent into features.',
        );
      }
      if (
        source.startsWith('@tanstack/react-query') &&
        !['app', 'features', 'services'].includes(from.layer)
      ) {
        report(
          node,
          'Server state belongs in app composition, features and service infrastructure.',
        );
      }
      if (
        ['gsap', '@gsap/react', 'framer-motion'].some(
          (pkg) => source === pkg || source.startsWith(`${pkg}/`),
        )
      ) {
        if (from.layer !== 'motion') report(node, 'Animation engines belong in motion/ adapters.');
      }
      if (!source.startsWith('.') && !source.startsWith('@/')) {
        if (source.startsWith('@darve/') || source.startsWith('node:')) {
          report(
            node,
            'Backend contracts must enter through the reviewed services/contracts adapter; server modules are forbidden.',
          );
        }
        return;
      }
      const target = source.startsWith('@/')
        ? `${from.root}${source.slice(2)}`
        : normalize(path.resolve(path.dirname(context.filename), source));
      const to = location(target);
      if (!to || to.root !== from.root || !Object.hasOwn(layers, to.layer)) {
        report(node, 'Application imports must stay inside a declared src/ layer.');
        return;
      }
      if (!Object.hasOwn(layers, from.layer)) {
        report(node, 'Source files must belong to a declared architecture layer.');
        return;
      }
      if (from.layer !== to.layer && !layers[from.layer].includes(to.layer)) {
        report(node, `${from.layer}/ cannot depend on ${to.layer}/. Compose higher up instead.`);
      }
      if (
        ['features', 'entities'].includes(from.layer) &&
        from.layer === to.layer &&
        from.slice !== to.slice
      ) {
        report(node, `Sibling ${from.layer} cannot import one another; compose them in routes/.`);
      }
      if (
        ['features', 'entities', 'services'].includes(to.layer) &&
        (from.layer !== to.layer || from.slice !== to.slice)
      ) {
        if (!/^[^/]+\/[^/]+\/index(?:\.[cm]?[jt]sx?)?$/.test(to.relative)) {
          report(
            node,
            'Cross-module imports must use the small explicit module/index.ts public entry.',
          );
        }
      }
    }

    return {
      Program(node) {
        if (!Object.hasOwn(layers, from.layer))
          report(node, 'Source files must belong to a declared architecture layer.');
      },
      ImportDeclaration: (node) => inspect(node.source, node.source.value),
      ExportNamedDeclaration: (node) => {
        if (node.source) inspect(node.source, node.source.value);
      },
      ExportAllDeclaration: (node) => inspect(node.source, node.source.value),
      ImportExpression: (node) => inspect(node.source, node.source.value),
      TSImportType: (node) => inspect(node, node.argument?.value ?? node.argument?.literal?.value),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          report(node, 'Use static ESM imports; require bypasses the browser module contract.');
        }
      },
    };
  },
};

export const infrastructureRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { boundary: '{{reason}}' },
  },
  create(context) {
    const from = location(context.filename);
    if (!from) return {};
    const report = (node, reason) =>
      context.report({ node, messageId: 'boundary', data: { reason } });
    return {
      Identifier(node) {
        if (
          from.layer !== 'services' &&
          [
            'fetch',
            'EventSource',
            'WebSocket',
            'XMLHttpRequest',
            'localStorage',
            'sessionStorage',
          ].includes(node.name)
        ) {
          report(
            node,
            'Network and browser storage access belong in services/; use its public adapters.',
          );
        }
      },
      MemberExpression(node) {
        if (
          node.object.type === 'MetaProperty' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'env' &&
          from.relative !== 'services/config/environment.ts'
        ) {
          report(node, 'Read public environment configuration through services/config/.');
        }
        if (
          node.computed &&
          node.property.type === 'Literal' &&
          [
            'fetch',
            'EventSource',
            'localStorage',
            'sessionStorage',
            'WebSocket',
            'XMLHttpRequest',
          ].includes(node.property.value) &&
          from.layer !== 'services'
        ) {
          report(node, 'Computed global infrastructure access is also restricted to services/.');
        }
      },
      JSXAttribute(node) {
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'dangerouslySetInnerHTML') {
          report(
            node,
            'Render untrusted provider/viewer content as plain text. Raw HTML is forbidden.',
          );
        }
      },
    };
  },
};

export default { rules: { boundaries: architectureRule, infrastructure: infrastructureRule } };
