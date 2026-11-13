import { BAND_COUNT } from "../analysis";
import { colour, envelope, type StyleDefinition } from "../types";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: number;
}

/**
 * Slow particles drifting on a flow field, tinted by the track's colours.
 * They brighten with their frequency band, speed up with the level, and are
 * pushed outward from the disc on each pluck. Trails fade rather than clear.
 */
export const particles: StyleDefinition = {
  id: "particles",
  label: "Particles",
  create() {
    let items: Particle[] = [];
    let seededFor = "";
    let level = 0;
    let fade = 1; // keep drawing until trails have faded after the music stops

    return {
      isActive: () => level > 0.002 || fade > 0.01,
      draw({ ctx, width, height, origin, palette, dark, lite }, frame, dt, t) {
        const key = `${width}x${height}:${lite}`;
        if (key !== seededFor) {
          const count = lite ? 70 : 160;
          items = Array.from({ length: count }, (_, i) => ({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: 0,
            vy: 0,
            band: i % BAND_COUNT,
          }));
          seededFor = key;
          ctx.clearRect(0, 0, width, height);
        }

        level = envelope(level, frame.level, dt, 0.3, 1.2);
        fade = level > 0.01 ? 1 : fade * Math.exp(-1.5 * dt);

        // Fade previous frame towards transparent to leave short trails.
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = `rgb(0 0 0 / ${Math.min(1, 9 * dt)})`;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";

        const speed = 8 + level * 70;
        for (const p of items) {
          // Cheap smooth flow field from layered sines.
          const angle =
            Math.sin(p.x * 0.0035 + t * 0.12) * Math.cos(p.y * 0.004 - t * 0.09) * Math.PI * 2 + p.band * 0.4;
          p.vx += (Math.cos(angle) * speed - p.vx) * Math.min(1, 2 * dt);
          p.vy += (Math.sin(angle) * speed - p.vy) * Math.min(1, 2 * dt);

          if (frame.onset > 0) {
            const dx = p.x - origin.x;
            const dy = p.y - origin.y;
            const dist = Math.hypot(dx, dy) || 1;
            const push = (frame.onset * 110 * frame.bands[p.band]) / (1 + dist / 300);
            p.vx += (dx / dist) * push;
            p.vy += (dy / dist) * push;
          }

          p.x = (p.x + p.vx * dt + width) % width;
          p.y = (p.y + p.vy * dt + height) % height;

          const b = frame.bands[p.band];
          const size = 1 + b * 2;
          ctx.fillStyle = colour(palette, p.band < 3 ? palette.hue : palette.hue2, (0.12 + 0.5 * b) * fade, dark);
          ctx.beginPath();
          ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      },
    };
  },
};
