import React from 'react';

/** The app mark: a lightning bolt crossing two transmission lines, on a tile
 *  in Fingrid's grid blue. Mirrors public/favicon.svg. */
export const Logo: React.FC<{ size?: number; radius?: number }> = ({ size = 32, radius = 9 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="fingridflow-mark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#4CC5FA" />
        <stop offset="100%" stopColor="#0365A8" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx={radius} fill="url(#fingridflow-mark)" />
    <g stroke="#fff" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 11h24" />
      <path d="M4 21h24" />
    </g>
    <path d="M18.4 4 8.8 18H15l-1.8 10 11.6-15.4h-6.6z" fill="#fff" />
  </svg>
);

export default Logo;
