import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const OUT_DIR = 'src/static/tabbar';
mkdirSync(OUT_DIR, { recursive: true });

const SIZE = 20;

const ICONS = {
  home: {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none">
      <path d="M3 11.2L12 4l9 7.2V20a1 1 0 0 1-1 1h-4v-6h-8v6H4a1 1 0 0 1-1-1v-8.8Z"
        stroke="#7a7e83" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    </svg>`,
    selectedSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none">
      <path d="M3 11.2L12 4l9 7.2V20a1 1 0 0 1-1 1h-4v-6h-8v6H4a1 1 0 0 1-1-1v-8.8Z"
        stroke="#3cc51f" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    </svg>`,
  },
  clock: {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#7a7e83" stroke-width="1.6" fill="none"/>
      <path d="M12 7v5l3.5 2" stroke="#7a7e83" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    </svg>`,
    selectedSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#3cc51f" stroke-width="1.6" fill="none"/>
      <path d="M12 7v5l3.5 2" stroke="#3cc51f" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  chart: {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none">
      <path d="M5 20V13" stroke="#7a7e83" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M12 20V8"  stroke="#7a7e83" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M19 20V4"  stroke="#7a7e83" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`,
    selectedSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none">
      <path d="M5 20V13" stroke="#3cc51f" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M12 20V8"  stroke="#3cc51f" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M19 20V4"  stroke="#3cc51f" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`,
  },
  gear: {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3.2" stroke="#7a7e83" stroke-width="1.6" fill="none"/>
      <path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"
        stroke="#7a7e83" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,
    selectedSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3.2" stroke="#3cc51f" stroke-width="1.6" fill="none"/>
      <path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"
        stroke="#3cc51f" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,
  },
};

for (const [name, { svg, selectedSvg }] of Object.entries(ICONS)) {
  await sharp(Buffer.from(svg)).resize(SIZE, SIZE).png().toFile(`${OUT_DIR}/${name}.png`);
  await sharp(Buffer.from(selectedSvg)).resize(SIZE, SIZE).png().toFile(`${OUT_DIR}/${name}-active.png`);
  console.log(`Generated ${name}.png and ${name}-active.png`);
}

console.log('Done!');
