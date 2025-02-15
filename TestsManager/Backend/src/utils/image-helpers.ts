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
      width: Math.min(100, metadata.width - trimLeft),
      height: Math.min(100, metadata.height - trimTop)
    })
    .toBuffer();

  return trimmedImage;
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