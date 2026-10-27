import logo from './assets/darve-logo.png';

export function Brand() {
  return (
    <span className="brand">
      <img className="brand-mark" src={logo} alt="" width={32} height={32} />
      <span>Darve</span>
    </span>
  );
}
