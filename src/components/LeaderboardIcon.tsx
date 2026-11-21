import React from 'react';

interface LeaderboardIconProps {
  className?: string;
}

/**
 * Custom geometric SYNC Leaderboard SVG emblem:
 * Stepped three-column ranking podium crowned with a synchronized orbital apex spark.
 */
export const LeaderboardIcon: React.FC<LeaderboardIconProps> = ({ className = 'w-5 h-5' }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Apex orbital diamond */}
      <path
        d="M12 2.25L13.35 4.65L15.75 6L13.35 7.35L12 9.75L10.65 7.35L8.25 6L10.65 4.65L12 2.25Z"
        fill="currentColor"
        fillOpacity="0.92"
      />
      {/* Left podium column (#2) */}
      <rect
        x="2.75"
        y="13"
        width="4.5"
        height="8"
        rx="1.35"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      {/* Center podium column (#1) */}
      <rect
        x="9.75"
        y="10.25"
        width="4.5"
        height="10.75"
        rx="1.35"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      {/* Right podium column (#3) */}
      <rect
        x="16.75"
        y="15.25"
        width="4.5"
        height="5.75"
        rx="1.35"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
};
