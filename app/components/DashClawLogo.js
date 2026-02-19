import React from 'react';

const DashClawLogo = ({ size = 20, className = "" }) => {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      width={size} 
      height={size}
      className={className}
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="0.4" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <path 
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        fill="#0d0d0d" 
        stroke="#F97316" 
        strokeWidth="0.85"
        strokeLinejoin="round" 
        strokeLinecap="round" 
        filter="url(#glow)"
      />
      <line x1="9.75" y1="8.3" x2="10.45" y2="16.1" stroke="#F97316" strokeWidth="0.85" strokeLinecap="round" filter="url(#glow)"/>
      <line x1="11.95" y1="8.3" x2="12.65" y2="16.1" stroke="#F97316" strokeWidth="0.85" strokeLinecap="round" filter="url(#glow)"/>
      <line x1="14.15" y1="8.3" x2="14.85" y2="16.1" stroke="#F97316" strokeWidth="0.85" strokeLinecap="round" filter="url(#glow)"/>
    </svg>
  );
};

export default DashClawLogo;
