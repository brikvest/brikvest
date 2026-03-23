import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { objectStorageClient } from './objectStorage';
import { randomUUID } from 'crypto';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for memory storage
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for videos
  },
  fileFilter: (req, file, cb) => {
    // Allow images, videos, and documents
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error('Invalid file type') as any;
      cb(error, false);
    }
  }
});

// Upload to Cloudinary (for images only)
export const uploadToCloudinary = async (
  buffer: Buffer,
  originalName: string,
  folder: string = 'brikvest'
): Promise<{ url: string; publicId: string }> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        public_id: `${Date.now()}-${originalName.split('.')[0]}`,
        format: 'jpg', // Convert all images (including HEIC) to JPG for browser compatibility
        transformation: [
          { quality: 'auto' } // Optimize quality automatically
        ]
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        } else {
          reject(new Error('Upload failed'));
        }
      }
    );

    uploadStream.end(buffer);
  });
};

export const uploadVideoToCloudinary = async (
  buffer: Buffer,
  originalName: string,
  folder: string = 'brikvest/videos'
): Promise<{ url: string; publicId: string }> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'video',
        public_id: `${Date.now()}-${originalName.split('.')[0]}`,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        } else {
          reject(new Error('Upload failed'));
        }
      }
    );

    uploadStream.end(buffer);
  });
};

// Upload to Replit Object Storage (for PDFs and documents)
export const uploadToObjectStorage = async (
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  folder: string = 'documents'
): Promise<{ url: string; path: string }> => {
  try {
    // Get the private directory from env
    const privateDir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!privateDir) {
      throw new Error('PRIVATE_OBJECT_DIR not set');
    }

    // Parse bucket name and base path from PRIVATE_OBJECT_DIR
    // Format: /bucket-name/.private
    const pathParts = privateDir.split('/').filter(p => p);
    const bucketName = pathParts[0];
    
    // Create unique filename
    const fileId = randomUUID();
    const fileExtension = originalName.split('.').pop() || 'pdf';
    const fileName = `${fileId}.${fileExtension}`;
    
    // Full path in bucket: .private/documents/uuid.pdf
    const objectPath = `.private/${folder}/${fileName}`;
    
    // Upload to Object Storage
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectPath);
    
    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          originalName: originalName,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    // Return URL that will be served by our endpoint
    const url = `/api/documents/${folder}/${fileName}`;
    
    return {
      url,
      path: objectPath
    };
  } catch (error) {
    console.error('Error uploading to Object Storage:', error);
    throw new Error('Failed to upload document to Object Storage');
  }
};

export { cloudinary };