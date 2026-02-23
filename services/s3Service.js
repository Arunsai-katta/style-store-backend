const { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Configure AWS S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

// Upload single image to S3
exports.uploadImage = async (file, folder = 'products') => {
  try {
    if (!file) {
      throw new Error('No file provided');
    }
    
    // Generate unique filename
    const ext = path.extname(file.originalname);
    const key = `${folder}/${uuidv4()}${ext}`;
    
    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    };
    
    await s3Client.send(new PutObjectCommand(params));
    
    // Generate permanent public URL
    const region = process.env.AWS_REGION || 'ap-south-1';
    const url = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
    
    return {
      success: true,
      key: key,
      url: url
    };
  } catch (error) {
    console.error('S3 Upload Error:', error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
};

// Upload multiple images to S3
exports.uploadMultipleImages = async (files, folder = 'products') => {
  try {
    if (!files || files.length === 0) {
      throw new Error('No files provided');
    }
    
    const uploadPromises = files.map(file => this.uploadImage(file, folder));
    const results = await Promise.all(uploadPromises);
    
    return {
      success: true,
      keys: results.map(result => result.key),
      urls: results.map(result => result.url)
    };
  } catch (error) {
    console.error('S3 Multiple Upload Error:', error);
    throw new Error(`Failed to upload images: ${error.message}`);
  }
};

// Delete image from S3
exports.deleteImage = async (key) => {
  try {
    if (!key) {
      throw new Error('No key provided');
    }
    
    const params = {
      Bucket: BUCKET_NAME,
      Key: key
    };
    
    await s3Client.send(new DeleteObjectCommand(params));
    
    return {
      success: true,
      message: 'Image deleted successfully'
    };
  } catch (error) {
    console.error('S3 Delete Error:', error);
    throw new Error(`Failed to delete image: ${error.message}`);
  }
};

// Delete multiple images from S3
exports.deleteMultipleImages = async (keys) => {
  try {
    if (!keys || keys.length === 0) {
      return { success: true, message: 'No images to delete' };
    }
    
    const params = {
      Bucket: BUCKET_NAME,
      Delete: {
        Objects: keys.map(key => ({ Key: key })),
        Quiet: false
      }
    };
    
    await s3Client.send(new DeleteObjectsCommand(params));
    
    return {
      success: true,
      message: `${keys.length} images deleted successfully`
    };
  } catch (error) {
    console.error('S3 Multiple Delete Error:', error);
    throw new Error(`Failed to delete images: ${error.message}`);
  }
};

// Extract key from S3 URL
exports.extractKeyFromUrl = (url) => {
  try {
    if (!url) return null;
    
    const urlObj = new URL(url);
    // Remove leading slash
    return urlObj.pathname.substring(1);
  } catch (error) {
    console.error('Extract Key Error:', error);
    return null;
  }
};

// Get signed URL for temporary access (max 7 days with SigV4)
exports.getSignedUrl = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    
    return {
      success: true,
      url
    };
  } catch (error) {
    console.error('S3 Signed URL Error:', error);
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }
};

// Get multiple signed URLs in bulk
exports.getSignedUrls = async (keys, expiresIn = 604800) => {
  try {
    if (!keys || keys.length === 0) {
      return { success: true, urls: [] };
    }

    const promises = keys.map(key => {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key
      });
      return getSignedUrl(s3Client, command, { expiresIn });
    });

    const urls = await Promise.all(promises);
    
    return {
      success: true,
      urls
    };
  } catch (error) {
    console.error('S3 Bulk Signed URLs Error:', error);
    throw new Error(`Failed to generate signed URLs: ${error.message}`);
  }
};

// Check if S3 is configured
exports.isConfigured = () => {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET_NAME
  );
};
