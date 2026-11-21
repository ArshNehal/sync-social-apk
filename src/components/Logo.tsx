import React from 'react';
import { useAuth } from '../context/AuthContext';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ className = '', size = 'md', showText = true }) => {
  const { brandName } = useAuth();
  const currentBrand = brandName || 'SYNC';

  const sizeMap = {
    sm: { box: 'w-7 h-7 rounded-lg', text: 'text-sm tracking-[0.2em]' },
    md: { box: 'w-9 h-9 rounded-xl', text: 'text-base tracking-[0.22em]' },
    lg: { box: 'w-11 h-11 rounded-2xl', text: 'text-lg tracking-[0.24em]' },
    xl: { box: 'w-14 h-14 rounded-2xl', text: 'text-2xl tracking-[0.25em]' },
  };

  return (
    <div className={`flex items-center gap-2.5 select-none group cursor-pointer ${className}`}>
      {/* Simple, sleek, premium geometric emblem */}
      <div
        className={`${sizeMap[size].box} relative flex items-center justify-center bg-black border border-white/20 shadow-[0_2px_12px_rgba(255,255,255,0.08)] overflow-hidden transition-all duration-300 group-hover:border-white/50 group-hover:shadow-[0_4px_20px_rgba(255,255,255,0.2)] group-hover:-translate-y-0.5`}
      >
        {/* Subtle glass reflection sheen */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-transparent pointer-events-none" />

        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-3/5 h-3/5 relative z-10 transition-transform duration-300 group-hover:scale-105"
        >
          {/* Two elegant, harmonious overlapping connection rings */}
          <circle
            cx="11.5"
            cy="16"
            r="6.5"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeOpacity="0.8"
          />
          <circle
            cx="20.5"
            cy="16"
            r="6.5"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeOpacity="0.8"
          />
          {/* Luminous central union focal point */}
          <path
            d="M16 11.4C17.4 12.7 18.2 14.3 18.2 16C18.2 17.7 17.4 19.3 16 20.6C14.6 19.3 13.8 17.7 13.8 16C13.8 14.3 14.6 12.7 16 11.4Z"
            fill="#FFFFFF"
          />
        </svg>
      </div>

      {showText && (
        <span
          className={`font-bold uppercase text-white font-mono tracking-widest transition-colors duration-200 group-hover:text-zinc-100 ${sizeMap[size].text}`}
        >
          {currentBrand}
        </span>
      )}
    </div>
  );
};
