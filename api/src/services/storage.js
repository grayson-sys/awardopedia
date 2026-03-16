import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

const BUCKET = process.env.DO_SPACES_BUCKET || 'awardopedia-assets';
const REGION = process.env.DO_SPACES_REGION || 'nyc3';
const CDN_BASE = process.env.DO_SPACES_CDN || `https://${BUCKET}.${REGION}.cdn.digitaloceanspaces.com`;

const s3 = new S3Client({
  endpoint: `https://${REGION}.digitaloceanspaces.com`,
  region: REGION,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY || '',
    secretAccessKey: process.env.DO_SPACES_SECRET || '',
  },
  forcePathStyle: false,
});

const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

const TYPE_PATHS = {
  avatar: 'avatars',
  company_logo: 'logos',
  capability_statement: 'capability-statements',
  proposal_doc: 'proposals',
  other: 'uploads',
};

export async function generateUploadUrl(userId, fileType, mimeType) {
  const ext = MIME_EXTENSIONS[mimeType] || '';
  const folder = TYPE_PATHS[fileType] || 'uploads';
  const id = crypto.randomUUID();
  const storageKey = `${folder}/${userId}/${id}${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: mimeType,
    ACL: 'public-read',
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  const cdnUrl = `${CDN_BASE}/${storageKey}`;

  return { uploadUrl, cdnUrl, storageKey };
}

export async function deleteFile(storageKey) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
  });
  await s3.send(command);
}
