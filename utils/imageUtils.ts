export async function squareImage(file: File, size: number = 1024): Promise<File> {
    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size, size);

    const aspect = image.width / image.height;
    let newWidth, newHeight, newX, newY;

    if (aspect > 1) {
        newWidth = size;
        newHeight = size / aspect;
        newX = 0;
        newY = (size - newHeight) / 2;
    } else {
        newHeight = size;
        newWidth = size * aspect;
        newY = 0;
        newX = (size - newWidth) / 2;
    }
    
    ctx.drawImage(image, newX, newY, newWidth, newHeight);
    
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(new File([blob], file.name, { type: 'image/png' }));
            } else {
                reject(new Error('Canvas to Blob conversion failed'));
            }
        }, 'image/png');
    });
}

export async function calculateShapeDescriptor(file: File, size = 32): Promise<number[]> {
    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    ctx.drawImage(image, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size).data;

    const grayscale = new Float32Array(size * size);
    for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        grayscale[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Spatially-binned Histogram of Oriented Gradients (HOG)
    const cellsPerDim = 4;
    const cellSize = size / cellsPerDim;
    const numBins = 9;
    const binSize = 180 / numBins;

    const cellHistograms = Array.from({ length: cellsPerDim * cellsPerDim }, () => new Array(numBins).fill(0));
    
    const Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const Gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
            let px = 0;
            let py = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const val = grayscale[(y + ky) * size + (x + kx)];
                    px += Gx[ky + 1][kx + 1] * val;
                    py += Gy[ky + 1][kx + 1] * val;
                }
            }
            
            const magnitude = Math.sqrt(px * px + py * py);
            if (magnitude === 0) continue;
            
            let orientation = Math.atan2(py, px) * (180 / Math.PI);
            if (orientation < 0) orientation += 180;

            const cellX = Math.floor(x / cellSize);
            const cellY = Math.floor(y / cellSize);
            const cellIndex = cellY * cellsPerDim + cellX;
            
            const bin = Math.min(Math.floor(orientation / binSize), numBins - 1);
            
            cellHistograms[cellIndex][bin] += magnitude;
        }
    }

    const descriptor = cellHistograms.flat();
    const norm = Math.sqrt(descriptor.reduce((sum, val) => sum + val * val, 0));

    if (norm === 0) return descriptor;
    
    return descriptor.map(val => val / norm);
}

export async function calculateColorDescriptor(file: File, size = 32): Promise<number[]> {
    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    ctx.drawImage(image, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size).data;

    const numBins = 16; // 16 bins for Hue
    const histogram = new Array(numBins).fill(0);

    for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        const a = imageData[i + 3];

        if (a < 255 || (r > 250 && g > 250 && b > 250)) {
            continue;
        }

        const r_ = r / 255, g_ = g / 255, b_ = b / 255;
        const max = Math.max(r_, g_, b_), min = Math.min(r_, g_, b_);
        let h = 0, s, v = max;

        const d = max - min;
        s = max === 0 ? 0 : d / max;

        if (max !== min) {
            switch (max) {
                case r_: h = (g_ - b_) / d + (g_ < b_ ? 6 : 0); break;
                case g_: h = (b_ - r_) / d + 2; break;
                case b_: h = (r_ - g_) / d + 4; break;
            }
            h /= 6;
        }

        const bin = Math.min(Math.floor(h * numBins), numBins - 1);
        histogram[bin]++;
    }

    const total = histogram.reduce((sum, val) => sum + val, 0);
    if (total === 0) return histogram;
    
    return histogram.map(val => val / total);
}


export function l2Distance(vecA: number[], vecB: number[]): number {
    let sum = 0;
    const len = Math.min(vecA.length, vecB.length);
    for (let i = 0; i < len; i++) {
        sum += (vecA[i] - vecB[i]) ** 2;
    }
    return Math.sqrt(sum);
}

export async function getImageOrientation(file: File): Promise<'horizontal' | 'vertical' | 'square'> {
    const image = await createImageBitmap(file);
    if (image.width > image.height * 1.1) return 'horizontal';
    if (image.height > image.width * 1.1) return 'vertical';
    return 'square';
}

export async function combineImages(baseImageUrl: string, overlayImageUrl: string, size: number = 1024): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context for combining images.');

    const loadImage = (url: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous'; // Required for canvas operations on cross-origin images, including data URLs
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(new Error(`Failed to load image from URL: ${url}. Error: ${err}`));
            img.src = url;
        });
    };

    try {
        const [baseImage, overlayImage] = await Promise.all([
            loadImage(baseImageUrl),
            loadImage(overlayImageUrl)
        ]);

        // Draw the base image (e.g., outline)
        ctx.drawImage(baseImage, 0, 0, size, size);

        // Draw the overlay image (e.g., interior) on top
        ctx.drawImage(overlayImage, 0, 0, size, size);

        return canvas.toDataURL('image/png');
    } catch (error) {
        console.error("Error combining images:", error);
        // Fallback to the base image if combination fails
        return baseImageUrl;
    }
}

export async function cleanImageToOneBit(
    dataUrl: string, 
    outputBackground: 'white' | 'transparent',
    size: number = 1024
): Promise<string> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'Anonymous';
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Could not get canvas context for cleaning'));
            }

            ctx.drawImage(image, 0, 0, size, size);
            const imageData = ctx.getImageData(0, 0, size, size);
            const data = imageData.data;
            const threshold = 128; // Grayscale threshold for black

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // Use a simple average for grayscale conversion
                const avg = (r + g + b) / 3;

                if (avg < threshold) {
                    // Black pixel
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                    data[i + 3] = 255; // Fully opaque
                } else {
                    // Background pixel
                    if (outputBackground === 'white') {
                        data[i] = 255;
                        data[i + 1] = 255;
                        data[i + 2] = 255;
                        data[i + 3] = 255; // Fully opaque white
                    } else {
                        data[i + 3] = 0; // Fully transparent
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = (err) => {
            console.error("Failed to load image for cleaning:", err);
            reject(new Error('Failed to load image for 1-bit conversion. It might be a cross-origin issue.'));
        };
        image.src = dataUrl;
    });
}


const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
}

export async function injectPromptIntoPng(dataUrl: string, prompt: string, keyword: string = "prompt"): Promise<string> {
    try {
        const response = await fetch(dataUrl);
        const buffer = await response.arrayBuffer();
        const originalBytes = new Uint8Array(buffer);

        if (originalBytes.length < 12 || originalBytes[0] !== 137 || originalBytes[1] !== 80 || originalBytes[2] !== 78 || originalBytes[3] !== 71) {
             console.warn("Invalid PNG signature. Returning original image.");
             return dataUrl;
        }

        const iendPosition = originalBytes.length - 12;
        const encoder = new TextEncoder();
        const keywordBytes = encoder.encode(keyword);
        const promptBytes = encoder.encode(prompt);
        const nullSeparator = new Uint8Array([0]);
        
        const chunkData = new Uint8Array(keywordBytes.length + 1 + promptBytes.length);
        chunkData.set(keywordBytes, 0);
        chunkData.set(nullSeparator, keywordBytes.length);
        chunkData.set(promptBytes, keywordBytes.length + 1);

        const chunkType = new Uint8Array([116, 69, 88, 116]); // "tEXt"

        const crcData = new Uint8Array(chunkType.length + chunkData.length);
        crcData.set(chunkType, 0);
        crcData.set(chunkData, chunkType.length);
        
        const crc = crc32(crcData);
        const chunkLength = chunkData.length;
        const textChunk = new Uint8Array(12 + chunkLength);
        const view = new DataView(textChunk.buffer);

        view.setUint32(0, chunkLength, false);
        textChunk.set(chunkType, 4);
        textChunk.set(chunkData, 8);
        view.setUint32(8 + chunkLength, crc, false);

        const newPngBytes = new Uint8Array(originalBytes.length + textChunk.length);
        newPngBytes.set(originalBytes.subarray(0, iendPosition), 0);
        newPngBytes.set(textChunk, iendPosition);
        newPngBytes.set(originalBytes.subarray(iendPosition), iendPosition + textChunk.length);

        const blob = new Blob([newPngBytes], { type: 'image/png' });
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

    } catch (error) {
        console.error("Failed to inject prompt into PNG:", error);
        return dataUrl;
    }
}