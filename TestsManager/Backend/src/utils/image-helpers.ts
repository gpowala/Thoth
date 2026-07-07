import assert from 'assert';
import sharp from 'sharp';

export async function trimClickEventView(imageBuffer: Buffer, clickX: number, clickY: number, radius: number) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to process image metadata.');
  }

  const {trimTop, trimLeft} = getTrimValues(metadata, clickX, clickY, radius);

  const trimmedImage = await image
    .extract({
      top: trimTop,
      left: trimLeft,
      width: Math.min(radius, metadata.width - trimLeft),
      height: Math.min(radius, metadata.height - trimTop)
    })
    .toBuffer();

  return trimmedImage;
}

// Extract an arbitrary rectangle from a screenshot, clamped to the image bounds.
// Coordinates are in the screenshot's own pixel space. Returns the full image
// untouched if the rectangle is degenerate or out of bounds.
export async function extractRegion(
    imageBuffer: Buffer,
    left: number,
    top: number,
    right: number,
    bottom: number
): Promise<Buffer> {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error('Unable to process image metadata.');
    }

    const clampedLeft = Math.max(0, Math.min(Math.floor(left), metadata.width - 1));
    const clampedTop = Math.max(0, Math.min(Math.floor(top), metadata.height - 1));
    const width = Math.min(Math.ceil(right - left), metadata.width - clampedLeft);
    const height = Math.min(Math.ceil(bottom - top), metadata.height - clampedTop);

    if (width <= 0 || height <= 0) {
        return image.toBuffer();
    }

    return image
        .extract({ top: clampedTop, left: clampedLeft, width, height })
        .toBuffer();
}

function getTrimValues(metadata: sharp.Metadata, clickX: number, clickY: number, radius: number) {
    assert(metadata.width && metadata.height, 'Invalid metadata');
    
    let trimTop = -1;
    let trimLeft = -1;
    
    if (metadata.width && clickX + (radius/2) > metadata.width)
        trimLeft = metadata.width - radius;
    else if (clickX - (radius/2) <0)
        trimLeft = 0;
    else
        trimLeft = clickX - (radius/2);

    if (metadata.height && clickY + (radius/2) > metadata.height)
        trimTop = metadata.height - radius;
    else if (clickY - (radius/2) <0)
        trimTop = 0;
    else
        trimTop = clickY - (radius/2);

    assert(trimTop >= 0 && trimTop < metadata.height && trimLeft >= 0 && trimLeft < metadata.width, 'Invalid trim values');

    return { trimTop, trimLeft };
}