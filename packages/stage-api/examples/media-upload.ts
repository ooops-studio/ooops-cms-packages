import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OoopsStageClient } from '@ooopsstudio/stage-api';

const filePath = process.argv[2];
if (!filePath) {
  throw new Error('Usage: tsx examples/media-upload.ts ./image.png');
}

const fileName = path.basename(filePath);
const file = await readFile(filePath);
const mimeType = fileName.endsWith('.png') ? 'image/png' : 'application/octet-stream';

const stage = new OoopsStageClient({
  baseUrl: process.env.OOOPS_STAGE_API_BASE_URL ?? 'https://stage.ooops.work/api/stage/v1',
  token: process.env.OOOPS_STAGE_API_TOKEN ?? ''
});

const completed = await stage.media.upload<{
  ok: true;
  asset: { id: string; title?: string | null; url?: string | null };
}>({
  fileName,
  mimeType,
  sizeBytes: file.byteLength,
  data: file
});

console.log(`Uploaded ${completed.asset.title ?? fileName}: ${completed.asset.id}`);
