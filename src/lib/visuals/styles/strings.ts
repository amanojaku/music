import { BAND_COUNT } from "../analysis";
import { colour, envelope, type StyleDefinition } from "../types";

/**
 * Six guitar strings running across the screen behind the disc (which sits
 * where the soundhole would be). Each string vibrates with one frequency band:
 * high e on top, low E at the bottom, as in tab.
 */
export const strings: StyleDefinition = {
  id: "strings",
  label: "Strings",
  create() {
    const amp = new Float32Array(BAND_COUNT);
    const phase = new Float32Array(BAND_COUNT);
    let energy = 0;

    return {
      isActive: () => energy > 0.002,
      draw({ ctx, width, height, origin, palette, dark, lite }, frame, dt) {
        ctx.clearRect(0, 0, width, height);
        const spacing = Math.max(12, Math.min(22, origin.radius / 6));
        const step = lite ? 12 : 6;
        energy = 0;

        for (let s = 0; s < BAND_COUNT; s++) {
          const band = BAND_COUNT - 1 - s; // top string ↔ highest band
          const target = frame.bands[band] ** 2 + frame.onset * frame.bands[band] * 0.4;
          amp[s] = envelope(amp[s], Math.min(1.2, target), dt, 0.6, 2.2);
          energy += amp[s];
          phase[s] += dt * (14 + band * 4); // visual vibration rate: higher strings faster

          const y0 = origin.y + (s - (BAND_COUNT - 1) / 2) * spacing;
          const a = amp[s] * spacing * 1.4;
          const thickness = 0.8 + (BAND_COUNT - 1 - band) * 0.35; // wound bass strings are thicker

          ctx.beginPath();
          for (let x = 0; x <= width + step; x += step) {
            const u = x / width;
            // Sum of standing-wave modes; modes 2–3 put movement either side of the disc.
            const y =
              y0 +
              a *
                (0.4 * Math.sin(Math.PI * u) * Math.sin(phase[s]) +
                  Math.sin(2 * Math.PI * u) * Math.sin(phase[s] * 1.5 + s) +
                  0.5 * Math.sin(3 * Math.PI * u) * Math.sin(phase[s] * 2.1 + s * 2));
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          const hue = band < 3 ? palette.hue : palette.hue2;
          // Soft glow pass, then the string itself.
          ctx.lineWidth = thickness + 4 * amp[s];
          ctx.strokeStyle = colour(palette, hue, 0.12 * amp[s], dark, 8);
          ctx.stroke();
          ctx.lineWidth = thickness;
          ctx.strokeStyle = colour(palette, hue, 0.22 + 0.6 * Math.min(1, amp[s]), dark);
          ctx.stroke();
        }
      },
    };
  },
};
