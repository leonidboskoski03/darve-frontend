export default {
  '*.{ts,tsx,js,mjs}': ['eslint --max-warnings 0', 'prettier --check'],
  '*.{json,css,md,html,yml,yaml}': 'prettier --check',
};
