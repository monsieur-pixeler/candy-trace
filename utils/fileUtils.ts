// --- File Parsing ---

export function parseStyleFilename(filename: string): { name: string; type: 'photo' | 'trace'; side: 'A' | 'B' } | null {
  const match = filename.match(/^(.*?)(_trace)?_([AB])\..*$/i);
  if (!match) return null;
  const [, name, isTrace, side] = match;
  return {
    name,
    type: isTrace ? 'trace' : 'photo',
    side: side.toUpperCase() as 'A' | 'B',
  };
}

export function parsePillFilename(filename: string): { name: string; side: 'A' | 'B' } | null {
  const match = filename.match(/^(.*?)_([A-B1-2]|front|back)\..*$/i);
  if (!match) return null;
  const [, name, sideStr] = match;
  let side: 'A' | 'B';
  switch (sideStr.toLowerCase()) {
    case 'a':
    case '1':
    case 'front':
      side = 'A';
      break;
    case 'b':
    case '2':
    case 'back':
      side = 'B';
      break;
    default:
      return null;
  }
  return { name, side };
}

// --- Image Processing ---

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });
}

export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type });
}

export function getApiImageParts(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const parts = result.split(',');
      if (parts.length !== 2) {
        return reject(new Error(`Invalid Data URL format for file ${file.name}.`));
      }
      const meta = parts[0];
      const data = parts[1];
      const mimeMatch = meta.match(/:(.*?);/);
      
      const mimeType = mimeMatch ? mimeMatch[1] : file.type;

      if (!mimeType) {
        return reject(new Error(`Could not determine MIME type for file: ${file.name}. The file may be corrupt or in an unsupported format.`));
      }

      resolve({ data, mimeType });
    };
    reader.onerror = (error) => reject(error);
  });
}

export async function getFileSHA256(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}
