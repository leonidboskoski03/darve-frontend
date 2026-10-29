import './starfield.css';

/** Static, deterministic decoration: no animation loop, data, events or accessibility content. */
export function Starfield() {
  return (
    <div className="ds-starfield" aria-hidden="true">
      <svg viewBox="0 0 1440 960" preserveAspectRatio="xMidYMid slice">
        {Array.from({ length: 86 }, (_, index) => (
          <circle
            key={index}
            cx={(index * 257 + 53) % 1440}
            cy={(index * 163 + 91) % 960}
            r={index % 11 === 0 ? 2.4 : index % 3 === 0 ? 1.3 : 0.6}
            className={index % 7 === 0 ? 'ds-starfield__brand' : undefined}
            opacity={0.18 + (index % 5) * 0.07}
          />
        ))}
      </svg>
    </div>
  );
}
