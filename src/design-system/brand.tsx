import logo from './assets/darve-logo.png';

/** Shared Darve mark. Use `wordmark` for the landing/legal Syne treatment. */
export function Brand({ wordmark = false }: { wordmark?: boolean } = {}) {
  return (
    <span className={wordmark ? 'brand brand--wordmark' : 'brand'}>
      <img className="brand-mark" src={logo} alt="" width={32} height={32} />
      <span>Darve</span>
    </span>
  );
}
