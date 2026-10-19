// The API accepts JPEG data URLs up to ~90 KB (staff and product photos), so pictures are resized
// and recompressed in the browser before being sent.
export const compressPhoto = (file: File, { width, height }: { width: number; height: number }) => new Promise<string>((resolve, reject) => {
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error('Canvas unavailable'));
    // JPEG has no transparency: transparent areas (PNG logos…) become white, not black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    // Crops to the target ratio, centred.
    const scale = Math.max(width / image.width, height / image.height);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    context.drawImage(image, (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
    let quality = 0.85;
    let result = canvas.toDataURL('image/jpeg', quality);
    while (result.length > 88000 && quality > 0.3) {
      quality -= 0.1;
      result = canvas.toDataURL('image/jpeg', quality);
    }
    if (result.length > 90000) return reject(new Error('Image too large'));
    resolve(result);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Invalid image'));
  };
  image.src = url;
});
