import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { soundFX } from '../lib/sounds';

interface ZoomableImageLightboxProps {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export const ZoomableImageLightbox: React.FC<ZoomableImageLightboxProps> = ({
  src,
  alt = 'Expanded view',
  onClose,
}) => {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);

  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Touch & pointer gesture refs
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; tx: number; ty: number } | null>(null);
  const lastTapRef = useRef<number>(0);
  const hasDraggedRef = useRef(false);

  const clampTranslate = useCallback((tx: number, ty: number, nextScale: number) => {
    if (nextScale <= 1.02) return { x: 0, y: 0 };
    const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const maxX = Math.max(80, (vw * (nextScale - 1)) / 2 + 40);
    const maxY = Math.max(80, (vh * (nextScale - 1)) / 2 + 40);
    return {
      x: Math.max(-maxX, Math.min(maxX, tx)),
      y: Math.max(-maxY, Math.min(maxY, ty)),
    };
  }, []);

  const applyZoom = useCallback(
    (targetScale: number, targetTranslate?: { x: number; y: number }) => {
      const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale));
      const nextT = clampTranslate(
        targetTranslate ? targetTranslate.x : translateRef.current.x,
        targetTranslate ? targetTranslate.y : translateRef.current.y,
        clampedScale
      );
      scaleRef.current = clampedScale;
      translateRef.current = nextT;
      setScale(clampedScale);
      setTranslate(nextT);
    },
    [clampTranslate]
  );

  // Reset state whenever image opens/changes
  useEffect(() => {
    if (!src) return;
    scaleRef.current = 1;
    translateRef.current = { x: 0, y: 0 };
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setIsInteracting(false);
    activePointersRef.current.clear();
  }, [src]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!src) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        soundFX.playTap();
        applyZoom(scaleRef.current + 0.6);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        soundFX.playTap();
        applyZoom(scaleRef.current - 0.6);
      } else if (e.key === '0') {
        e.preventDefault();
        soundFX.playTap();
        applyZoom(1, { x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [src, onClose, applyZoom]);

  if (!src) return null;

  const getDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
    Math.hypot(p2.x - p1.x, p2.y - p1.y);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hasDraggedRef.current = false;

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      pinchStartDistRef.current = getDistance(pts[0], pts[1]);
      pinchStartScaleRef.current = scaleRef.current;
      dragStartRef.current = null;
      setIsInteracting(true);
    } else if (activePointersRef.current.size === 1) {
      dragStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        tx: translateRef.current.x,
        ty: translateRef.current.y,
      };
      setIsInteracting(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 2 && pinchStartDistRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = getDistance(pts[0], pts[1]);
      if (dist > 0) {
        hasDraggedRef.current = true;
        const ratio = dist / pinchStartDistRef.current;
        applyZoom(pinchStartScaleRef.current * ratio);
      }
    } else if (activePointersRef.current.size === 1 && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.pointerX;
      const dy = e.clientY - dragStartRef.current.pointerY;
      if (Math.hypot(dx, dy) > 5) {
        hasDraggedRef.current = true;
      }
      if (scaleRef.current > 1.02) {
        const nextT = clampTranslate(
          dragStartRef.current.tx + dx,
          dragStartRef.current.ty + dy,
          scaleRef.current
        );
        translateRef.current = nextT;
        setTranslate(nextT);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);

    if (activePointersRef.current.size < 2) {
      pinchStartDistRef.current = null;
    }

    if (activePointersRef.current.size === 1) {
      const remaining = Array.from(activePointersRef.current.values())[0];
      dragStartRef.current = {
        pointerX: remaining.x,
        pointerY: remaining.y,
        tx: translateRef.current.x,
        ty: translateRef.current.y,
      };
    } else {
      dragStartRef.current = null;
      setIsInteracting(false);

      // Double-tap / double-click detection when not dragging
      if (!hasDraggedRef.current) {
        const now = Date.now();
        if (now - lastTapRef.current < 280) {
          lastTapRef.current = 0;
          soundFX.playTap();
          if (scaleRef.current > 1.15) {
            applyZoom(1, { x: 0, y: 0 });
          } else {
            const rect = containerRef.current?.getBoundingClientRect();
            const offsetX = rect ? (rect.left + rect.width / 2 - e.clientX) * 1.1 : 0;
            const offsetY = rect ? (rect.top + rect.height / 2 - e.clientY) * 1.1 : 0;
            applyZoom(2.5, { x: offsetX, y: offsetY });
          }
        } else {
          lastTapRef.current = now;
        }
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const delta = -e.deltaY * 0.0025;
    applyZoom(scaleRef.current + delta);
  };

  const zoomPercent = Math.round(scale * 100);

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo zoom viewer"
      className="fixed inset-0 z-[120] bg-black/95 backdrop-blur-2xl flex flex-col select-none touch-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !hasDraggedRef.current && scale <= 1.05) {
          onClose();
        }
      }}
    >
      {/* Top Floating Zoom & Close HUD */}
      <div className="relative z-30 flex items-center justify-between px-3 sm:px-5 pt-[max(0.85rem,env(safe-area-inset-top))] pb-2.5 pointer-events-none">
        <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-900/90 border border-white/15 shadow-lg pointer-events-auto">
          <button
            type="button"
            disabled={scale <= MIN_SCALE + 0.02}
            onClick={(e) => {
              e.stopPropagation();
              soundFX.playTap();
              applyZoom(scaleRef.current - 0.5);
            }}
            aria-label="Zoom out"
            className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-200 hover:text-white hover:bg-white/10 disabled:opacity-35 transition cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="min-w-[46px] text-center text-xs font-mono font-semibold tabular-nums text-white">
            {zoomPercent}%
          </span>
          <button
            type="button"
            disabled={scale >= MAX_SCALE - 0.02}
            onClick={(e) => {
              e.stopPropagation();
              soundFX.playTap();
              applyZoom(scaleRef.current + 0.5);
            }}
            aria-label="Zoom in"
            className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-200 hover:text-white hover:bg-white/10 disabled:opacity-35 transition cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          {scale > 1.05 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                soundFX.playTap();
                applyZoom(1, { x: 0, y: 0 });
              }}
              aria-label="Reset zoom"
              title="Reset zoom"
              className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            soundFX.playTap();
            onClose();
          }}
          aria-label="Close photo viewer"
          className="w-11 h-11 flex items-center justify-center rounded-full bg-zinc-900/90 border border-white/15 text-white hover:bg-white/20 shadow-lg transition cursor-pointer pointer-events-auto"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Interactive Zoom & Pan Canvas */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onClick={(e) => {
          if (e.target === e.currentTarget && !hasDraggedRef.current && scale <= 1.05) {
            onClose();
          }
        }}
        className={`flex-1 flex items-center justify-center overflow-hidden p-3 sm:p-6 ${
          scale > 1.02 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
        }`}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          referrerPolicy="no-referrer"
          style={{
            transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
            transition: isInteracting ? 'none' : 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="max-w-full max-h-[82dvh] object-contain rounded-2xl border border-white/10 shadow-2xl select-none pointer-events-none will-change-transform"
        />
      </div>

      {/* Subtle Bottom Hint */}
      <div className="pb-[max(0.9rem,env(safe-area-inset-bottom))] text-center pointer-events-none">
        <span className="inline-block px-3 py-1 rounded-full bg-black/60 text-[11px] text-zinc-400">
          {scale > 1.05
            ? 'Drag to pan · Double-tap or − to zoom out'
            : 'Pinch, double-tap, or use + / − to zoom'}
        </span>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
};
