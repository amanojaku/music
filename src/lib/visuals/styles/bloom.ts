import { colour, envelope, type StyleDefinition } from "../types";

interface Ring {
  radius: number;
  speed: number;
  life: number; // 1 → 0
  strength: number;
  hue: number;
}

/**
 * Soft rings radiate from the disc on each plucked note, over a glow that
 * swells with the overall level.
 */
export const bloom: StyleDefinition = {
  id: "bloom",
  label: "Bloom",
  create() {
    const rings: Ring[] = [];
    let glow = 0;

    return {
      isActive: () => rings.length > 0 || glow > 0.002,
      draw({ ctx, width, height, origin, palette, dark, lite }, frame, dt) {
        ctx.clearRect(0, 0, width, height);
        glow = envelope(glow, frame.level, dt, 0.2, 1.5);

        if (frame.onset > 0) {
          // Colour by register: bass-heavy plucks use the primary hue.
          const low = frame.bands[0] + frame.bands[1];
          const high = frame.bands[3] + frame.bands[4];
          rings.push({
            radius: origin.radius * 0.95,
            speed: 70 + frame.onset * 110,
            life: 1,
            strength: 0.4 + frame.onset * 0.6,
            hue: low >= high ? palette.hue : palette.hue2,
          });
          if (rings.length > (lite ? 16 : 40)) rings.shift();
        }

        if (glow > 0.002) {
          const r = origin.radius * (1.3 + glow * 0.9);
          const g = ctx.createRadialGradient(origin.x, origin.y, origin.radius * 0.8, origin.x, origin.y, r);
          g.addColorStop(0, colour(palette, palette.hue, 0.28 * glow, dark));
          g.addColorStop(1, colour(palette, palette.hue2, 0, dark));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        for (let i = rings.length - 1; i >= 0; i--) {
          const ring = rings[i];
          ring.radius += ring.speed * dt;
          ring.speed *= Math.exp(-0.35 * dt);
          ring.life -= dt * 0.45;
          if (ring.life <= 0) {
            rings.splice(i, 1);
            continue;
          }
          ctx.beginPath();
          ctx.arc(origin.x, origin.y, ring.radius, 0, Math.PI * 2);
          ctx.lineWidth = 0.75 + 2.5 * ring.strength * ring.life;
          ctx.strokeStyle = colour(palette, ring.hue, 0.55 * ring.life * ring.strength, dark);
          ctx.stroke();
        }
      },
    };
  },
};
