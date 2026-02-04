import express from "express";
import cors from "cors";
import multer from "multer";
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Helper function to safely destroy Cloudinary resource
const safeCloudinaryDestroy = async (publicId, resourceType = 'image') => {
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (e) {
      console.warn(`Could not destroy Cloudinary asset ${publicId}:`, e);
    }
  }
};

// --- CLOUDINARY CONFIGURATION ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- MONGODB CONFIGURATION ---
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5001;

// --- MONGOOSE SCHEMAS ---

// Products Schema - Updated with new fields
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  mainImage: { type: String, required: true },
  mainImagePublicId: { type: String, required: true },
  otherPhotos: [{ type: String }],
  otherPhotosPublicIds: [{ type: String }],
  description: { type: String, required: false, trim: true },
  classifications: { type: String, required: false, trim: true },
  uploadDate: { type: Date, default: Date.now },
}, { timestamps: true });

// --- MODELS ---
const Product = mongoose.model('Product', productSchema);

// --- EXPRESS APP SETUP ---
const app = express();

// --- MIDDLEWARE ---
app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --- DATABASE CONNECTION CHECK MIDDLEWARE ---
const checkDbConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ 
      error: "Database unavailable", 
      message: "MongoDB connection is not ready. Please try again later." 
    });
  }
  next();
};

// --- CLOUDINARY MULTER SETUP FOR IMAGES ---
const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'smarthome-products',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp', 'svg'],
    public_id: (req, file) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
      return `${timestamp}-${safeName.split('.')[0]}`;
    },
  }
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// --- ROUTES ---

app.get("/", (req, res) => {
  res.json({
    message: "SmartHome Products API ✅",
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    readyState: mongoose.connection.readyState
  });
});

// ========== PRODUCTS ROUTES ==========

// CREATE PRODUCT
app.post("/products/upload", checkDbConnection, uploadImage.fields([
  { name: 'mainImage', maxCount: 1 },
  { name: 'otherPhotos', maxCount: 10 }
]), async (req, res) => {
  console.log('📦 Product upload request');
  
  try {
    const { name, price, description, classifications } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({ error: "Product name is required" });
    }

    if (!price || isNaN(parseFloat(price))) {
      return res.status(400).json({ error: "Valid price is required" });
    }

    if (!req.files || !req.files.mainImage) {
      return res.status(400).json({ error: "Main image is required" });
    }

    const mainImageFile = req.files.mainImage[0];
    const otherPhotosFiles = req.files.otherPhotos || [];

    const newProduct = new Product({
      name: name.trim(),
      price: parseFloat(price),
      mainImage: mainImageFile.path,
      mainImagePublicId: mainImageFile.filename,
      otherPhotos: otherPhotosFiles.map(file => file.path),
      otherPhotosPublicIds: otherPhotosFiles.map(file => file.filename),
      description: description ? description.trim() : '',
      classifications: classifications ? classifications.trim() : '',
    });

    await newProduct.save();
    console.log(`✅ Product created: ${newProduct._id}`);

    res.status(201).json({
      message: "Product created successfully!",
      product: newProduct
    });

  } catch (error) {
    console.error('❌ Error creating product:', error);
    res.status(500).json({ error: "Failed to create product", details: error.message });
  }
});

// GET ALL PRODUCTS
app.get("/products", checkDbConnection, async (req, res) => {
  try {
    const products = await Product.find().sort({ uploadDate: -1 });
    res.json({ products });
  } catch (error) {
    console.error('❌ Error fetching products:', error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// GET SINGLE PRODUCT
app.get("/products/:id", checkDbConnection, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json({ product });
  } catch (error) {
    console.error('❌ Error fetching product:', error);
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

// UPDATE PRODUCT
app.put("/products/:id", checkDbConnection, uploadImage.fields([
  { name: 'mainImage', maxCount: 1 },
  { name: 'otherPhotos', maxCount: 10 }
]), async (req, res) => {
  try {
    const { name, price, description, classifications } = req.body;
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Update text fields
    if (name) product.name = name.trim();
    if (price !== undefined) {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice)) {
        return res.status(400).json({ error: "Invalid price value" });
      }
      product.price = parsedPrice;
    }
    if (description !== undefined) product.description = description.trim();
    if (classifications !== undefined) product.classifications = classifications.trim();

    // Update main image if new one is uploaded
    if (req.files && req.files.mainImage) {
      await safeCloudinaryDestroy(product.mainImagePublicId);
      const mainImageFile = req.files.mainImage[0];
      product.mainImage = mainImageFile.path;
      product.mainImagePublicId = mainImageFile.filename;
    }

    // Update other photos if new images are uploaded
    if (req.files && req.files.otherPhotos) {
      // Delete old photos
      for (const publicId of product.otherPhotosPublicIds) {
        await safeCloudinaryDestroy(publicId);
      }
      
      const otherPhotosFiles = req.files.otherPhotos;
      product.otherPhotos = otherPhotosFiles.map(file => file.path);
      product.otherPhotosPublicIds = otherPhotosFiles.map(file => file.filename);
    }

    await product.save();
    console.log(`✅ Product updated: ${req.params.id}`);

    res.json({ message: "Product updated successfully", product });
  } catch (error) {
    console.error('❌ Error updating product:', error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

// DELETE PRODUCT
app.delete("/products/:id", checkDbConnection, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Delete main image
    await safeCloudinaryDestroy(product.mainImagePublicId);

    // Delete other photos
    for (const publicId of product.otherPhotosPublicIds) {
      await safeCloudinaryDestroy(publicId);
    }

    await Product.findByIdAndDelete(req.params.id);
    console.log(`✅ Product deleted: ${req.params.id}`);

    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error('❌ Error deleting product:', error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

// --- Global Error Handling ---
app.use((error, req, res, next) => {
  console.error('💥 Error:', error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({ error: error.message || 'Something went wrong!' });
});

// --- 404 Handler ---
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// --- SERVER START & DB CONNECTION ---
const startServer = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log('📍 MongoDB URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@'));
    
    // Connect to MongoDB FIRST with options
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log('✅ Connected to MongoDB successfully!');
    console.log('📊 Database:', mongoose.connection.db.databaseName);
    
    // THEN start the server
    const server = app.listen(PORT, () => {
      console.log(`\n🚀 SmartHome Server Running!`);
      console.log(`🌐 Server listening on port ${PORT}`);
      console.log(`🔗 Server URL: http://localhost:${PORT}`);
      console.log(`\n📋 Available Endpoints:`);
      console.log(`   GET    /              - Health check`);
      console.log(`   GET    /products      - Get all products`);
      console.log(`   POST   /products/upload - Create product`);
      console.log(`   GET    /products/:id  - Get single product`);
      console.log(`   PUT    /products/:id  - Update product`);
      console.log(`   DELETE /products/:id  - Delete product`);
      console.log('\n✅ Server is ready to accept requests!\n');
    });

    // --- MONGOOSE CONNECTION EVENT HANDLERS ---
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected successfully!');
    });

    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    // --- GRACEFUL SHUTDOWN ---
    const shutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');
      
      try {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
      } catch (err) {
        console.error('❌ Error closing MongoDB connection:', err);
      }
      
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
      
      // Force close after 10s
      setTimeout(() => {
        console.error('⚠️  Forcing shutdown');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    console.error('📋 Full error:', err);
    console.error('\n🔍 Troubleshooting:');
    console.error('   1. Check MongoDB Atlas Network Access (add 0.0.0.0/0)');
    console.error('   2. Verify MongoDB credentials');
    console.error('   3. Check if MongoDB cluster is running');
    console.error('   4. Verify connection string format\n');
    process.exit(1);
  }
};

// Start the server
startServer();