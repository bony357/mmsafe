import type { ImageMetadata } from 'astro';
import data from '../content/promocje.json';

export interface Slide {
  id: string;
  image: string;
  tag: string;
  promo: string;
  title: string;
  text: string;
  points: string[];
  cta: string;
  link: string;
}

const images = import.meta.glob<ImageMetadata>('../assets/promo/*.{jpg,jpeg,png,webp}', {
  eager: true,
  import: 'default',
});

export const slides: Slide[] = data.slides;

export function slideImage(slide: Slide): ImageMetadata {
  const img = images[`../assets/promo/${slide.image}`];
  if (!img) throw new Error(`Brak zdjęcia promocji: src/assets/promo/${slide.image}`);
  return img;
}
