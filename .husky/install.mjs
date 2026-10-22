if (
  process.env.CI !== 'true' &&
  process.env.HUSKY !== '0' &&
  process.env.NODE_ENV !== 'production'
) {
  const { default: husky } = await import('husky');
  const result = husky();
  if (result) throw new Error(result);
}
