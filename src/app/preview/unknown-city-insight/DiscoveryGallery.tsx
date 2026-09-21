'use client';

import { useEffect, useRef, useState } from 'react';
import type { Discovery } from '@/lib/weekly-discovery';
import styles from './DiscoveryGallery.module.css';

export default function DiscoveryGallery({ images }: { images: NonNullable<Discovery['images']> }) {
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);
    const [hovered, setHovered] = useState(false);
    const touch = useRef<{ x: number; y: number } | null>(null);
    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => { if (media.matches) setPlaying(false); };
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    useEffect(() => {
        if (!playing || hovered || images.length < 2) return;
        const timer = window.setInterval(() => {
            if (!document.hidden) setIndex(value => (value + 1) % images.length);
        }, 5000);
        return () => window.clearInterval(timer);
    }, [playing, hovered, images.length]);
    const select = (value: number) => {
        setPlaying(false);
        setIndex((value + images.length) % images.length);
    };
    const current = images[index];
    return <figure className={styles.gallery} aria-label="다카마쓰 여행 사진 슬라이드" aria-roledescription="carousel"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                select(index + (event.key === 'ArrowLeft' ? -1 : 1));
            }
        }}>
        <div className={styles.stage} onPointerDown={event => {
            setPlaying(false);
            touch.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerCancel={() => { touch.current = null; }} onPointerUp={event => {
            const start = touch.current;
            touch.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) select(index + (dx < 0 ? 1 : -1));
        }}>
            {images.map((photo, i) => (
                // Remote originals retain their source and license below the photograph.
                // eslint-disable-next-line @next/next/no-img-element
                <img key={photo.src} src={photo.src} alt={photo.caption} draggable={false}
                    aria-hidden={i !== index} className={i === index ? styles.active : styles.photo} />
            ))}
            <span className={styles.counter}>{index + 1} / {images.length}</span>
        </div>
        <figcaption className={styles.caption}>
            <div className={styles.dots} aria-label="사진 선택">{images.map((photo, i) => <button key={photo.src}
                aria-label={`${i + 1}번 사진: ${photo.caption}`} aria-current={index === i ? 'true' : undefined}
                onClick={() => select(i)}><span /></button>)}</div>
            <small>사진: <a href={current.source} target="_blank" rel="noreferrer">{current.credit}</a> · <a href={current.licenseUrl} target="_blank" rel="noreferrer">{current.license}</a></small>
        </figcaption>
    </figure>;
}
