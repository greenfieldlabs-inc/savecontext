'use client';

/**
 * Animated Background Component
 *
 * Renders a procedural "loss landscape" visualization inspired by gradient descent
 * optimization visualizations. Creates an animated topographic/contour map effect
 * using canvas and sinusoidal functions.
 *
 * How it works:
 * 1. A 2D scalar field (the "landscape") is generated using overlapping sine/cosine waves
 * 2. Contour lines are extracted using a simplified marching squares algorithm
 * 3. The time parameter shifts wave phases to create smooth animation
 *
 * Performance considerations:
 * - Frame throttling: renders every other frame (~30fps)
 * - Grid step of 8px balances detail vs computation
 * - Respects prefers-reduced-motion for accessibility
 * - All computation is client-side; no server cost on Amplify
 */

import { useEffect, useRef } from 'react';

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Respect user's motion preferences for accessibility
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animationId: number;
    let time = 0;
    let frameCount = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resize();
    window.addEventListener('resize', resize);

    /**
     * Procedural terrain function - generates height values for any (x, y) coordinate.
     *
     * Mathematical approach:
     * - Scale factor (0.003) controls wave frequency across screen space
     * - Four overlapping sinusoidal terms create organic, non-repeating patterns
     * - Each term has different frequency multipliers and phase offsets
     * - The time parameter (t) shifts phases to animate the terrain
     *
     * Output range: approximately -1.4 to +1.4
     *
     * Wave breakdown:
     * - Term 1: sin*cos product creates checkerboard-like base pattern
     * - Term 2: diagonal wave (nx - ny) adds directional flow
     * - Term 3: opposite diagonal wave for complexity
     * - Term 4: high-frequency detail layer
     */
    const landscape = (x: number, y: number, t: number): number => {
      const scale = 0.003;
      const nx = x * scale;
      const ny = y * scale;

      return (
        Math.sin(nx * 2 + t * 0.5) * Math.cos(ny * 2 + t * 0.3) * 0.5 +
        Math.sin(nx * 1.5 - ny + t * 0.2) * 0.3 +
        Math.cos(nx + ny * 1.5 + t * 0.4) * 0.4 +
        Math.sin(nx * 3 + t * 0.1) * Math.sin(ny * 3 - t * 0.15) * 0.2
      );
    };

    const draw = () => {
      frameCount++;

      // Skip every other frame for performance (~30fps instead of 60fps)
      if (frameCount % 2 !== 0) {
        animationId = requestAnimationFrame(draw);
        return;
      }

      const width = window.innerWidth;
      const height = window.innerHeight;

      // Clear with background color
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, width, height);

      const contourLevels = 12; // Number of elevation bands to draw
      const step = 8; // Grid cell size in pixels (larger = faster, less detail)

      /**
       * Contour extraction using simplified marching squares.
       *
       * For each contour level (threshold), we scan the grid looking for
       * edges where the terrain crosses that threshold. When found, we draw
       * a short line segment at the interpolated crossing point.
       *
       * Standard marching squares connects segments into paths, but we skip
       * that for performance - the short segments create a stippled effect
       * that looks intentional and renders faster.
       */
      for (let level = 0; level < contourLevels; level++) {
        // Map level index to threshold value in [-1, 1] range
        const threshold = -1 + (level / contourLevels) * 2;

        // Higher elevations get darker lines (0.08 to 0.20 opacity)
        const opacity = 0.08 + (level / contourLevels) * 0.12;

        ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();

        // Scan grid cells
        for (let x = 0; x < width; x += step) {
          for (let y = 0; y < height; y += step) {
            // Sample terrain at current cell and neighbors
            const v = landscape(x, y, time);
            const vRight = landscape(x + step, y, time);
            const vBottom = landscape(x, y + step, time);

            // Check horizontal edge (current to right neighbor)
            // If they're on opposite sides of threshold, contour crosses here
            if ((v < threshold) !== (vRight < threshold)) {
              // Linear interpolation to find exact crossing point
              const t = (threshold - v) / (vRight - v);
              ctx.moveTo(x + t * step, y);
              ctx.lineTo(x + t * step, y + 3); // Short vertical tick
            }

            // Check vertical edge (current to bottom neighbor)
            if ((v < threshold) !== (vBottom < threshold)) {
              const t = (threshold - v) / (vBottom - v);
              ctx.moveTo(x, y + t * step);
              ctx.lineTo(x + 3, y + t * step); // Short horizontal tick
            }
          }
        }
        ctx.stroke();
      }

      // Advance time for animation (slow rate for subtle movement)
      if (!prefersReducedMotion) {
        time += 0.004;
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  // Wrapper div with bg color prevents black flash during hydration
  return (
    <div className="fixed inset-0 -z-10 bg-[#fafafa]">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ background: '#fafafa' }}
      />
    </div>
  );
}
