# 🚗 COSMIC FORGE — Automotive Studio

> A real-time, browser-based 3D car configurator built with Three.js and OrbitControls. Customize your Lamborghini Revuelto LP 610-4 with full paint, wheel, and brake caliper selection — rendered live in-browser with a premium dark/light studio UI.

---

## 📁 Project Structure

```
cosmic-forge/
├── hdri/                   # Environment lighting maps (.hdr/.exr)
├── images/
│   └── Logo.png            # Brand logo (used in loader + topbar)
├── model/
│   └── car_model/          # 3D car model files (GLTF/GLB)
├── three/                  # Local Three.js build + OrbitControls
├── index.html              # App shell & all markup
├── script.js               # Three.js scene, controls, configurator logic
└── style.css               # Full design system (light + dark mode)
```

---

## ✨ Features

| Feature | Description |
|---|---|
| **3D Viewer** | Real-time Three.js render with drag-to-rotate OrbitControls |
| **Paint Selector** | 8 body colors — Giallo Orion, Viola Aletheia, Grigio Lynx, Nero Noctis, Blu Eleos, Rosso Efesto, Verde Mantis, Arancio Borealis |
| **Wheel Selector** | 3 forged 20" finishes — Diamante Black, Silver, Bronze |
| **Brake Calipers** | 3 caliper colors — Yellow, Red, Black |
| **Camera Presets** | 3/4 Front, Side, Rear, Top — each with a double-click alternate angle |
| **Dark / Light Mode** | Smooth animated theme toggle, persisted via `localStorage` |
| **Loading Screen** | Premium orbital loader with animated progress bar |
| **Focus Config View** | Expanded bottom panel for Body / Wheel / Brake with full-size cards |
| **Vehicle Data Panel** | Chassis specs overlay — weight, displacement, RPM, gearbox, wheelbase, fuel tank |
| **Responsive Layout** | Adapts at 1280px and 900px breakpoints |

---

## 🚀 Getting Started

### Prerequisites

- A modern browser (Chrome 90+, Firefox 88+, Safari 15+, Edge 90+)
- A static file server (required — browsers block local `file://` module imports)

### Running Locally

**Option A — Python (zero install):**
```bash
cd cosmic-forge
python3 -m http.server 8080
# Open http://localhost:8080
```

**Option B — Node.js:**
```bash
npx serve .
# Open the URL shown in terminal
```

**Option C — VS Code:**
Install the **Live Server** extension, right-click `index.html` → *Open with Live Server*.

> ⚠️ **Do not open `index.html` directly via `file://`** — ES module imports (`<script type="module">`) are blocked by browser security policy without a server.

---

## ⚙️ Configuration Limits

### 3D Model
| Limit | Value |
|---|---|
| Supported formats | GLTF / GLB only |
| Model path | `./model/car_model/` |
| Texture path | Embedded in GLB or alongside GLTF |
| Max recommended poly count | ~500k triangles for 60 fps |

### HDRI Lighting
| Limit | Value |
|---|---|
| Supported formats | `.hdr`, `.exr` |
| Path | `./hdri/` |
| Recommended resolution | 2K (2048×1024) — 4K may stall on low-end GPUs |

### Body Colors
| Limit | Value |
|---|---|
| Maximum swatches (compact grid) | 8 (4×2 layout) |
| Maximum swatches (focus panel) | 8 (4×2 layout) |
| Color format | Hex integer (`0xRRGGBB`) |
| Adding more colors | Duplicate a `.csw` block in `index.html` and add a matching `.focus-color-card` |

### Wheel Styles
| Limit | Value |
|---|---|
| Maximum wheels (compact grid) | 3 (3-column layout) |
| Maximum wheels (focus panel) | 3 (3-column layout) |
| Canvas preview size | 70×70 px (compact) / 84×84 px (focus) |
| Adding more wheels | Add a `.wsw` and matching `.focus-wheel-card`; register in `script.js` `WHEELS` array |

### Brake Calipers
| Limit | Value |
|---|---|
| Maximum caliper options | 6 (flex-row, space-between) |
| Adding more calipers | Duplicate a `.calsw` block; no JS changes needed |

### Camera Presets
| Limit | Value |
|---|---|
| Presets in camera bar | 4 (Front 3/4, Side, Rear, Top) |
| Each preset | Click = primary angle; Double-click = alternate angle |
| Adding presets | Add a `.cbtn` in `#cam-bar`; register handler in `script.js` |

---

## 🎨 Design System

### Typography
| Role | Font | Source |
|---|---|---|
| Display / specs | Bebas Neue | Google Fonts |
| Body / UI | DM Sans | Google Fonts |
| Monospace / loader | Space Mono | Google Fonts |
| Brand wordmark | Cormorant SC | Google Fonts |
| Car name label | Teko / Rajdhani | Google Fonts |

### Color Tokens (CSS Variables)
```css
--bg:       #f0f0ee   /* page background (light) */
--white:    #ffffff
--dark:     #111111
--muted:    #999999
--accent:   #E8D44D   /* Lamborghini yellow — active states, loader arc */
--border:   rgba(0,0,0,0.08)
--car-color:#F5C518   /* default paint (Giallo Orion) */
```

### Layout Heights
```css
--h-top:  70px    /* topbar */
--h-bot:  250px   /* bottom config panel (232px @ <1280px) */
--h-foot: 42px    /* footer */
```

### Responsive Breakpoints
| Breakpoint | Changes |
|---|---|
| `≤ 1280px` | Bottom panel shrinks to 232px; grids tighten |
| `≤ 900px` | Topbar shrinks to 56px; specs row hidden; panel scrolls vertically |

---

## 🌙 Dark Mode

Dark mode is toggled via the `☀` button on the right side of the stage.

- Adds `dark-mode` class to `<html>`
- Persisted in `localStorage` under key `cosmic-forge-theme`
- Loaded before first paint (inline `<script>` in `<head>`) to prevent flash
- Smooth transitions enabled via `html.theme-ready` class (added after load)

---

## 📦 Dependencies

All dependencies are **local** — no CDN calls required at runtime.

| Library | Location | Purpose |
|---|---|---|
| Three.js r152+ | `./three/` | 3D scene, renderer, lighting |
| OrbitControls | `./three/` | Mouse / touch camera control |
| Google Fonts | CDN (preconnect) | Typography — requires internet |

> To make the app **fully offline**, download the Google Fonts and host them locally, then update the `<link>` in `index.html`.

---

## 🔧 Customisation Guide

### Changing the Car Model
1. Replace files in `./model/car_model/`
2. Update mesh name references in `script.js` (body, wheel, caliper mesh selectors)
3. Update spec values in the `#topbar` HTML

### Adding a New Paint Color
```html
<!-- In #color-grid (index.html) -->
<div class="csw" data-paint-hex="0xRRGGBB" onclick="selectColor(this,0xRRGGBB)">
  <div class="cdot" style="background:#RRGGBB">
    <svg class="chk" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.5">
      <polyline points="13,4 6,11 3,8"/>
    </svg>
  </div>
  <span>Color Name</span>
</div>
```
Then mirror the same block inside `.focus-color-grid` with class `focus-color-card`.

### Adding a New Wheel
1. Add a `.wsw` card to `#wheel-grid` with a unique `data-wheel-type`
2. Add a matching `.focus-wheel-card` to `.focus-wheel-grid`
3. In `script.js`, add a new entry to the `WHEELS` config array with draw logic for the canvas preview

### Updating Vehicle Specs
Edit the `.spec` blocks in `#topbar` (HTML) and the `.vdi` blocks in `#vd-panel`.

---

## 🛠 Known Limitations

- **No mobile touch-drag-to-rotate** on the 3D canvas below 900px — OrbitControls touch events may require pointer-events tuning
- **GLTF only** — OBJ / FBX / STL formats are not supported without adding a loader
- **No Save/Share backend** — "Save Build" and "Share" buttons in the footer are UI-only placeholders
- **Google Fonts require internet** — the loader and topbar brand fonts will fall back to system sans-serif offline
- **HDRI format support** depends on Three.js `RGBELoader` / `EXRLoader` — ensure the correct loader is imported in `script.js` for your file format

---

## 📄 License

This project is proprietary. All assets, models, and UI code are the property of their respective owners. The Lamborghini Revuelto name and design are trademarks of Automobili Lamborghini S.p.A.

---

<div align="center">
  Built with Three.js · Designed for performance · Dark mode ready
</div>
