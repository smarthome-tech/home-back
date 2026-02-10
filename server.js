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

// Products Schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  mainImage: { type: String, required: true },
  mainImagePublicId: { type: String, required: true },
  otherPhotos: [{ type: String }],
  otherPhotosPublicIds: [{ type: String }],

  // Rich text description (supports HTML formatting)
  description: { type: String, required: false },

  classifications: { type: String, required: false, trim: true },

  // Status tracking fields (ALL OPTIONAL)
  status: {
    type: String,
    enum: ['available', 'restoring', 'on_the_way', 'out_of_stock', 'discontinued'],
    default: 'available',
    required: false
  },
  statusNote: { type: String, trim: true, required: false },
  expectedArrival: { type: Date, required: false },

  uploadDate: { type: Date, default: Date.now },
}, { timestamps: true });

// Site Settings Schema - Single language (Georgian)
const siteSettingsSchema = new mongoose.Schema({
  // Landing page text
  landingTitle: { type: String, default: '' },
  landingDescription: { type: String, default: '' },

  // About us text
  aboutText: { type: String, default: '' },

  // Landing banner image
  landingBanner: { type: String, default: '' },
  landingBannerPublicId: { type: String, default: '' },

  // Logo image
  logo: { type: String, default: '' },
  logoPublicId: { type: String, default: '' },

  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// --- MODELS ---
const Product = mongoose.model('Product', productSchema);
const SiteSettings = mongoose.model('SiteSettings', siteSettingsSchema);

// --- EXPRESS APP SETUP ---
const app = express();

// --- MIDDLEWARE ---
app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
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
    const {
      name,
      price,
      description,
      classifications,
      status,
      statusNote,
      expectedArrival
    } = req.body;

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

    const productData = {
      name: name.trim(),
      price: parseFloat(price),
      mainImage: mainImageFile.path,
      mainImagePublicId: mainImageFile.filename,
      otherPhotos: otherPhotosFiles.map(file => file.path),
      otherPhotosPublicIds: otherPhotosFiles.map(file => file.filename),
      description: description || '',
      classifications: classifications ? classifications.trim() : '',
    };

    // Only add status fields if they are provided
    if (status) productData.status = status;
    if (statusNote) productData.statusNote = statusNote.trim();
    if (expectedArrival) productData.expectedArrival = new Date(expectedArrival);

    const newProduct = new Product(productData);

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
    const { status } = req.query;

    // Filter by status if provided
    const filter = status ? { status } : {};

    const products = await Product.find(filter).sort({ uploadDate: -1 });
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
    const {
      name,
      price,
      description,
      classifications,
      status,
      statusNote,
      expectedArrival
    } = req.body;

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
    if (description !== undefined) product.description = description;
    if (classifications !== undefined) product.classifications = classifications.trim();

    // Update status fields
    if (status !== undefined) product.status = status;
    if (statusNote !== undefined) product.statusNote = statusNote.trim();
    if (expectedArrival !== undefined) {
      product.expectedArrival = expectedArrival ? new Date(expectedArrival) : null;
    }

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

// UPDATE PRODUCT STATUS ONLY (Quick status change endpoint)
app.patch("/products/:id/status", checkDbConnection, async (req, res) => {
  try {
    const { status, statusNote, expectedArrival } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Validate status
    const validStatuses = ['available', 'restoring', 'on_the_way', 'out_of_stock', 'discontinued'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        validStatuses
      });
    }

    if (status !== undefined) product.status = status;
    if (statusNote !== undefined) product.statusNote = statusNote.trim();
    if (expectedArrival !== undefined) {
      product.expectedArrival = expectedArrival ? new Date(expectedArrival) : null;
    }

    await product.save();
    console.log(`✅ Product status updated: ${req.params.id} -> ${status}`);

    res.json({ message: "Product status updated successfully", product });
  } catch (error) {
    console.error('❌ Error updating product status:', error);
    res.status(500).json({ error: "Failed to update product status" });
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

// GET PRODUCTS BY STATUS
app.get("/products/status/:status", checkDbConnection, async (req, res) => {
  try {
    const { status } = req.params;

    const validStatuses = ['available', 'restoring', 'on_the_way', 'out_of_stock', 'discontinued'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        validStatuses
      });
    }

    const products = await Product.find({ status }).sort({ uploadDate: -1 });
    res.json({ products, count: products.length });
  } catch (error) {
    console.error('❌ Error fetching products by status:', error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ========== SITE SETTINGS ROUTES ==========

// GET SITE SETTINGS
app.get("/settings", checkDbConnection, async (req, res) => {
  try {
    let settings = await SiteSettings.findOne();

    // Create default settings if none exist
    if (!settings) {
      settings = new SiteSettings();
      await settings.save();
      console.log('✅ Created default site settings');
    }

    res.json({ settings });
  } catch (error) {
    console.error('❌ Error fetching site settings:', error);
    res.status(500).json({ error: "Failed to fetch site settings" });
  }
});

// UPDATE ALL SITE SETTINGS (with optional image uploads)
app.put("/settings", checkDbConnection, uploadImage.fields([
  { name: 'landingBanner', maxCount: 1 },
  { name: 'logo', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      landingTitle,
      landingDescription,
      aboutText
    } = req.body;

    let settings = await SiteSettings.findOne();

    // Create settings if doesn't exist
    if (!settings) {
      settings = new SiteSettings();
    }

    // Update text fields
    if (landingTitle !== undefined) settings.landingTitle = landingTitle;
    if (landingDescription !== undefined) settings.landingDescription = landingDescription;
    if (aboutText !== undefined) settings.aboutText = aboutText;

    // Update landing banner if uploaded
    if (req.files && req.files.landingBanner) {
      await safeCloudinaryDestroy(settings.landingBannerPublicId);
      const bannerFile = req.files.landingBanner[0];
      settings.landingBanner = bannerFile.path;
      settings.landingBannerPublicId = bannerFile.filename;
    }

    // Update logo if uploaded
    if (req.files && req.files.logo) {
      await safeCloudinaryDestroy(settings.logoPublicId);
      const logoFile = req.files.logo[0];
      settings.logo = logoFile.path;
      settings.logoPublicId = logoFile.filename;
    }

    settings.updatedAt = new Date();
    await settings.save();

    console.log('✅ Site settings updated');
    res.json({ message: "Site settings updated successfully", settings });

  } catch (error) {
    console.error('❌ Error updating site settings:', error);
    res.status(500).json({ error: "Failed to update site settings", details: error.message });
  }
});

// UPDATE ONLY LANDING TEXT (no images)
app.patch("/settings/landing", checkDbConnection, async (req, res) => {
  try {
    const { landingTitle, landingDescription } = req.body;

    let settings = await SiteSettings.findOne();
    if (!settings) {
      settings = new SiteSettings();
    }

    if (landingTitle !== undefined) settings.landingTitle = landingTitle;
    if (landingDescription !== undefined) settings.landingDescription = landingDescription;

    settings.updatedAt = new Date();
    await settings.save();

    console.log('✅ Landing text updated');
    res.json({ message: "Landing text updated successfully", settings });

  } catch (error) {
    console.error('❌ Error updating landing text:', error);
    res.status(500).json({ error: "Failed to update landing text" });
  }
});

// UPDATE ONLY ABOUT TEXT (no images)
app.patch("/settings/about", checkDbConnection, async (req, res) => {
  try {
    const { aboutText } = req.body;

    let settings = await SiteSettings.findOne();
    if (!settings) {
      settings = new SiteSettings();
    }

    if (aboutText !== undefined) settings.aboutText = aboutText;

    settings.updatedAt = new Date();
    await settings.save();

    console.log('✅ About text updated');
    res.json({ message: "About text updated successfully", settings });

  } catch (error) {
    console.error('❌ Error updating about text:', error);
    res.status(500).json({ error: "Failed to update about text" });
  }
});

// UPDATE ONLY LANDING BANNER (image only)
app.patch("/settings/banner", checkDbConnection, uploadImage.single('landingBanner'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Landing banner image is required" });
    }

    let settings = await SiteSettings.findOne();
    if (!settings) {
      settings = new SiteSettings();
    }

    // Delete old banner
    await safeCloudinaryDestroy(settings.landingBannerPublicId);

    settings.landingBanner = req.file.path;
    settings.landingBannerPublicId = req.file.filename;
    settings.updatedAt = new Date();

    await settings.save();

    console.log('✅ Landing banner updated');
    res.json({ message: "Landing banner updated successfully", settings });

  } catch (error) {
    console.error('❌ Error updating landing banner:', error);
    res.status(500).json({ error: "Failed to update landing banner" });
  }
});

// UPDATE ONLY LOGO (image only)
app.patch("/settings/logo", checkDbConnection, uploadImage.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Logo image is required" });
    }

    let settings = await SiteSettings.findOne();
    if (!settings) {
      settings = new SiteSettings();
    }

    // Delete old logo
    await safeCloudinaryDestroy(settings.logoPublicId);

    settings.logo = req.file.path;
    settings.logoPublicId = req.file.filename;
    settings.updatedAt = new Date();

    await settings.save();

    console.log('✅ Logo updated');
    res.json({ message: "Logo updated successfully", settings });

  } catch (error) {
    console.error('❌ Error updating logo:', error);
    res.status(500).json({ error: "Failed to update logo" });
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

    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ Connected to MongoDB successfully!');
    console.log('📊 Database:', mongoose.connection.db.databaseName);

    const server = app.listen(PORT, () => {
      console.log(`\n🚀 SmartHome Server Running!`);
      console.log(`🌐 Server listening on port ${PORT}`);
      console.log(`🔗 Server URL: http://localhost:${PORT}`);
      console.log(`\n📋 Available Endpoints:`);
      console.log(`   GET    /                        - Health check`);
      console.log(`\n   PRODUCTS:`);
      console.log(`   GET    /products                - Get all products`);
      console.log(`   POST   /products/upload         - Create product`);
      console.log(`   GET    /products/:id            - Get single product`);
      console.log(`   PUT    /products/:id            - Update product`);
      console.log(`   PATCH  /products/:id/status     - Update product status only`);
      console.log(`   DELETE /products/:id            - Delete product`);
      console.log(`   GET    /products/status/:status - Get products by status`);
      console.log(`\n   SITE SETTINGS:`);
      console.log(`   GET    /settings                - Get site settings`);
      console.log(`   PUT    /settings                - Update all settings (with images)`);
      console.log(`   PATCH  /settings/landing        - Update landing text only`);
      console.log(`   PATCH  /settings/about          - Update about text only`);
      console.log(`   PATCH  /settings/banner         - Update landing banner image only`);
      console.log(`   PATCH  /settings/logo           - Update logo image only`);
      console.log('\n📦 Available Statuses:');
      console.log(`   - available    : In stock and ready`);
      console.log(`   - restoring    : Being restocked/restored`);
      console.log(`   - on_the_way   : Product is in transit`);
      console.log(`   - out_of_stock : Temporarily unavailable`);
      console.log(`   - discontinued : No longer available`);
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

startServer();