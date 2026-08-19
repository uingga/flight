/**
 * Crop an overly tall destination photo for Naver Blog without stretching it.
 *
 * Usage:
 *   node scripts/crop-blog-image.mjs input.jpg output.jpg --position center
 *
 * Options:
 *   --position center|top|bottom  Crop anchor (default: center)
 *   --ratio 1.25                 Maximum height / width ratio (default: 4:5)
 *   --width 1400                 Maximum output width (default: 1400)
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const positional = args.filter(arg => !arg.startsWith('--'));
const option = name => {
    const inline = args.find(arg => arg.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
};

const input = positional[0];
const output = positional[1];
const position = option('position') || 'center';
const maxRatio = Number(option('ratio') || 1.25);
const maxWidth = Number(option('width') || 1400);

if (!input || !output) {
    console.error('Usage: node scripts/crop-blog-image.mjs <input> <output.jpg> [--position center|top|bottom]');
    process.exit(1);
}
if (!fs.existsSync(input)) throw new Error(`Input image not found: ${input}`);
if (!['center', 'top', 'bottom'].includes(position)) throw new Error(`Invalid position: ${position}`);
if (!Number.isFinite(maxRatio) || maxRatio <= 0) throw new Error(`Invalid ratio: ${maxRatio}`);
if (!Number.isFinite(maxWidth) || maxWidth <= 0) throw new Error(`Invalid width: ${maxWidth}`);

const extension = path.extname(input).toLowerCase();
const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
const source = `data:${mime};base64,${fs.readFileSync(input).toString('base64')}`;

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage();
    const result = await page.evaluate(async ({ source, position, maxRatio, maxWidth }) => {
        const image = new Image();
        image.src = source;
        await image.decode();

        const sourceWidth = image.naturalWidth;
        const sourceHeight = image.naturalHeight;
        const cropHeight = Math.min(sourceHeight, Math.round(sourceWidth * maxRatio));
        const cropY = position === 'top'
            ? 0
            : position === 'bottom'
                ? sourceHeight - cropHeight
                : Math.round((sourceHeight - cropHeight) / 2);
        const outputWidth = Math.min(sourceWidth, maxWidth);
        const outputHeight = Math.round(cropHeight * outputWidth / sourceWidth);

        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, cropY, sourceWidth, cropHeight, 0, 0, outputWidth, outputHeight);

        return {
            data: canvas.toDataURL('image/jpeg', 0.92).split(',')[1],
            sourceWidth,
            sourceHeight,
            outputWidth,
            outputHeight,
            cropped: cropHeight < sourceHeight,
        };
    }, { source, position, maxRatio, maxWidth });

    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, Buffer.from(result.data, 'base64'));
    console.log(`${result.cropped ? 'Cropped' : 'Resized'}: ${result.sourceWidth}x${result.sourceHeight} -> ${result.outputWidth}x${result.outputHeight}`);
    console.log(`Saved: ${path.resolve(output)}`);
} finally {
    await browser.close();
}
